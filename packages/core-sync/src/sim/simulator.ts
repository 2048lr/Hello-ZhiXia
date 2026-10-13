/**
 * 确定性多节点同步模拟器。
 *
 * 存在的理由（open-questions #9，已升为 P0）：ADR-0010 选择了
 * 「各端先跑通、互联最后做」的节奏，其最大代价就是**同步问题的反馈周期很长**。
 * 网络分区、时钟偏移、消息乱序、丢包这几类 bug 靠真机手测几乎不可能复现 ——
 * 它们表现为「偶尔顺序错乱」，而偶发不可复现正是最难排查的形态。
 *
 * 这个模拟器把上述条件变成可注入、可重复的参数：**同一个种子必然得到同一份 trace**。
 *
 * ## 设计要点
 *
 * | 要点 | 做法 |
 * | --- | --- |
 * | 时间 | 整数虚拟毫秒，由 `run()` 推进；不读墙钟 |
 * | 随机 | 按种子驱动的 mulberry32；不调用 `Math.random()` |
 * | 调度 | 消息按 `(dueAt, seq)` 排序投递，结果与插入顺序无关 |
 * | 传播 | 本地写入时向所有对端 push；另有周期性 anti-entropy 对账修复丢包与分区 |
 * | 对账 | 交换**完整 opId 摘要**（O(n) 但无条件正确），见 `opsMissingFrom` |
 *
 * ## 刻意没做的事
 *
 * 网络层只模拟「送达 / 丢弃 / 延迟 / 乱序」，不模拟带宽、分片、加密与握手。
 * 那些属于协调层的实现细节，用真机或集成测试验证更合适。
 */

import { knownOpIds, opsMissingFrom, type Op } from "../op.js";
import { VirtualDevice } from "./device.js";
import { createRandom } from "./random.js";

export interface SimulatorOptions {
  /** 随机种子。相同种子 → 完全相同的执行过程。 */
  readonly seed?: number;
  /** 消息投递延迟下限（虚拟毫秒）。 */
  readonly minLatency?: number;
  /** 消息投递延迟上限（虚拟毫秒）。 */
  readonly maxLatency?: number;
  /** 丢包率 `[0, 1]`。 */
  readonly lossRate?: number;
  /** 触发额外延迟（即乱序）的概率 `[0, 1]`。 */
  readonly reorderRate?: number;
  /** 乱序时叠加的最大额外延迟（虚拟毫秒）。 */
  readonly reorderDelay?: number;
  /** anti-entropy 对账间隔（虚拟毫秒）。设为 0 关闭周期性对账。 */
  readonly antiEntropyInterval?: number;
  /** 虚拟时钟起点。 */
  readonly startWall?: number;
}

type Payload =
  | { readonly kind: "push"; readonly ops: readonly Op[] }
  | { readonly kind: "digest"; readonly known: readonly string[] }
  | { readonly kind: "reply"; readonly ops: readonly Op[]; readonly known: readonly string[] };

interface Envelope {
  readonly seq: number;
  readonly dueAt: number;
  readonly from: string;
  readonly to: string;
  readonly payload: Payload;
}

export interface TraceEntry {
  readonly at: number;
  readonly event: string;
  readonly from: string;
  /** 非点对点事件（如分区、愈合）为 `null`。 */
  readonly to: string | null;
  readonly detail: string | null;
}

export interface SimulatorStats {
  readonly sent: number;
  readonly delivered: number;
  readonly droppedByPartition: number;
  readonly droppedByLoss: number;
  /** 当前在途（已发送、尚未投递）的消息数。 */
  readonly inFlight: number;
}

export interface SettleOptions {
  /** 最多推进多少虚拟毫秒。 */
  readonly maxMs?: number;
  /** 连续多少步保持收敛才认为稳定。 */
  readonly stableSteps?: number;
}

export interface SettleResult {
  readonly converged: boolean;
  readonly elapsed: number;
  readonly at: number;
}

export class SyncSimulator {
  readonly #devices = new Map<string, VirtualDevice>();
  readonly #random: () => number;
  readonly #seed: number;

  readonly #minLatency: number;
  readonly #maxLatency: number;
  readonly #lossRate: number;
  readonly #reorderRate: number;
  readonly #reorderDelay: number;
  readonly #antiEntropyInterval: number;
  readonly #startWall: number;

  #now: number;
  #seq = 0;
  #pending: Envelope[] = [];
  #traceEntries: TraceEntry[] = [];
  /** `undefined` 表示没有分区（全网互通）。 */
  #groups: Map<string, number> | undefined;
  #antiEntropyAt = new Map<string, number>();
  #peerCursor = new Map<string, number>();
  /** 只响应、不主动发起对账的设备（例如后台受限的移动端）。 */
  #respondOnly = new Set<string>();

  #sent = 0;
  #delivered = 0;
  #droppedByPartition = 0;
  #droppedByLoss = 0;

  constructor(options: SimulatorOptions = {}) {
    this.#seed = options.seed ?? 1;
    this.#random = createRandom(this.#seed);

    this.#minLatency = options.minLatency ?? 5;
    this.#maxLatency = options.maxLatency ?? 15;
    this.#lossRate = options.lossRate ?? 0;
    this.#reorderRate = options.reorderRate ?? 0;
    this.#reorderDelay = options.reorderDelay ?? 40;
    this.#antiEntropyInterval = options.antiEntropyInterval ?? 100;
    this.#startWall = options.startWall ?? 1_700_000_000_000;
    this.#now = this.#startWall;

    if (this.#minLatency > this.#maxLatency) {
      throw new RangeError("minLatency 不能大于 maxLatency");
    }
    if (this.#lossRate < 0 || this.#lossRate > 1) {
      throw new RangeError("lossRate 必须在 [0, 1] 内");
    }
    if (this.#reorderRate < 0 || this.#reorderRate > 1) {
      throw new RangeError("reorderRate 必须在 [0, 1] 内");
    }
  }

  /** 当前虚拟时间。 */
  get now(): number {
    return this.#now;
  }

  get seed(): number {
    return this.#seed;
  }

  addDevice(id: string, options: { clockSkew?: number; antiEntropy?: boolean } = {}): VirtualDevice {
    if (this.#devices.has(id)) {
      throw new Error(`设备 ${id} 已存在`);
    }

    const device = new VirtualDevice(id, {
      seedBase: this.#seed,
      startWall: this.#startWall,
      clockSkew: options.clockSkew ?? 0,
      onLocalOp: (op) => {
        this.#broadcast(id, op);
      },
    });

    this.#devices.set(id, device);
    this.#antiEntropyAt.set(id, this.#now + this.#antiEntropyInterval);

    // 只响应、不主动发起对账的设备。这不是假设出来的场景：
    // ADR-0006 里 Android 是瘦客户端，后台受限、不应期待它周期性主动联网。
    if (options.antiEntropy === false) {
      this.#respondOnly.add(id);
    }

    return device;
  }

  device(id: string): VirtualDevice {
    const found = this.#devices.get(id);
    if (found === undefined) throw new Error(`设备 ${id} 不存在`);
    return found;
  }

  devices(): readonly VirtualDevice[] {
    return [...this.#devices.values()];
  }

  /**
   * 建立分区：同一组内互通，组间完全不可达，未出现在任何组里的设备被完全隔离。
   * 传空数组即 `heal()`。
   */
  partition(groups: readonly (readonly string[])[]): void {
    const map = new Map<string, number>();
    groups.forEach((group, index) => {
      for (const id of group) map.set(id, index);
    });
    this.#groups = map;
    this.#trace("partition", "network", null, groups.map((g) => `[${g.join(",")}]`).join(" | "));
  }

  /** 解除分区，恢复全网互通。 */
  heal(): void {
    this.#groups = undefined;
    this.#trace("heal", "network", null, null);
  }

  /** 推进虚拟时间。时间按 1 毫秒步进，每步先触发到期定时器，再投递到期消息。 */
  run(ms: number): void {
    if (ms < 0) throw new RangeError("run 的毫秒数不能为负");
    const target = this.#now + ms;

    for (;;) {
      this.#fireAntiEntropy();
      this.#deliverDue();
      if (this.#now >= target) break;
      this.#now += 1;
    }
  }

  /**
   * 反复推进直到收敛且连续稳定若干步，或达到 `maxMs`。
   * 返回是否真的收敛 —— **不要让调用方忽略返回值**，超时未收敛本身就是重要信息。
   */
  settle(options: SettleOptions = {}): SettleResult {
    const maxMs = options.maxMs ?? 10_000;
    const stableSteps = options.stableSteps ?? 5;
    const start = this.#now;
    let stable = 0;

    while (this.#now - start < maxMs) {
      this.run(1);
      if (this.converged()) {
        stable += 1;
        if (stable >= stableSteps) break;
      } else {
        stable = 0;
      }
    }

    return { converged: this.converged(), elapsed: this.#now - start, at: this.#now };
  }

  /** 所有设备的操作集合是否完全相同。 */
  converged(): boolean {
    const list = [...this.#devices.values()];
    if (list.length <= 1) return true;

    const reference = new Set(list[0]!.log.all().map((op) => op.opId));
    for (let i = 1; i < list.length; i += 1) {
      const ops = list[i]!.log.all();
      if (ops.length !== reference.size) return false;
      for (const op of ops) {
        if (!reference.has(op.opId)) return false;
      }
    }
    return true;
  }

  /** 每台设备当前的操作条数。 */
  opCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const device of this.#devices.values()) {
      counts[device.id] = device.log.size;
    }
    return counts;
  }

  stats(): SimulatorStats {
    return {
      sent: this.#sent,
      delivered: this.#delivered,
      droppedByPartition: this.#droppedByPartition,
      droppedByLoss: this.#droppedByLoss,
      inFlight: this.#pending.length,
    };
  }

  /** 完整事件轨迹。相同种子 + 相同操作序列 → 完全相同的轨迹。 */
  trace(): readonly TraceEntry[] {
    return this.#traceEntries;
  }

  /** 轨迹的紧凑表示，便于在断言里比较两次运行是否一致。 */
  traceDigest(): string {
    return this.#traceEntries
      .map((e) => `${e.at}|${e.event}|${e.from}|${e.to ?? "-"}|${e.detail ?? "-"}`)
      .join("\n");
  }

  // ────────────────────────────── 内部实现 ──────────────────────────────

  #trace(event: string, from: string, to: string | null, detail: string | null): void {
    this.#traceEntries.push({ at: this.#now, event, from, to, detail });
  }

  #reachable(from: string, to: string): boolean {
    if (this.#groups === undefined) return true;
    const a = this.#groups.get(from);
    const b = this.#groups.get(to);
    return a !== undefined && b !== undefined && a === b;
  }

  #nextLatency(): number {
    const span = this.#maxLatency - this.#minLatency;
    let latency = this.#minLatency + Math.floor(this.#random() * (span + 1));
    if (this.#reorderRate > 0 && this.#random() < this.#reorderRate) {
      latency += 1 + Math.floor(this.#random() * this.#reorderDelay);
    }
    return latency;
  }

  #broadcast(from: string, op: Op): void {
    // Map 的迭代顺序是插入顺序，因此广播顺序是确定的
    for (const id of this.#devices.keys()) {
      if (id === from) continue;
      this.#send(from, id, { kind: "push", ops: [op] });
    }
  }

  #send(from: string, to: string, payload: Payload): void {
    if (!this.#reachable(from, to)) {
      this.#droppedByPartition += 1;
      this.#trace("drop:partition", from, to, payload.kind);
      return;
    }
    if (this.#lossRate > 0 && this.#random() < this.#lossRate) {
      this.#droppedByLoss += 1;
      this.#trace("drop:loss", from, to, payload.kind);
      return;
    }

    const latency = this.#nextLatency();
    this.#sent += 1;
    this.#pending.push({ seq: this.#seq, dueAt: this.#now + latency, from, to, payload });
    this.#seq += 1;
    this.#trace("send", from, to, `${payload.kind}+${latency}`);
  }

  #deliverDue(): void {
    if (this.#pending.length === 0) return;

    const due: Envelope[] = [];
    const later: Envelope[] = [];
    for (const envelope of this.#pending) {
      (envelope.dueAt <= this.#now ? due : later).push(envelope);
    }
    if (due.length === 0) return;

    this.#pending = later;
    due.sort((a, b) => a.dueAt - b.dueAt || a.seq - b.seq);
    for (const envelope of due) {
      this.#deliver(envelope);
    }
  }

  #deliver(envelope: Envelope): void {
    const target = this.#devices.get(envelope.to);
    if (target === undefined) return;

    this.#delivered += 1;

    switch (envelope.payload.kind) {
      case "push": {
        const added = target.receive(envelope.payload.ops);
        this.#trace("deliver:push", envelope.from, envelope.to, `+${added}`);
        break;
      }
      case "digest": {
        // 对端报出它拥有的集合。把我这边它没有的发回去，**并附上我的集合** ——
        // 这一条不能省：一轮对账必须是双向的，否则先发起方永远拿不到对端的数据，
        // 结果是「单向收敛」——只有发起方变全，接收方一无所获。
        const missing = opsMissingFrom(target.log.all(), new Set(envelope.payload.known));
        this.#trace("deliver:digest", envelope.from, envelope.to, `missing=${missing.length}`);
        // 即使 missing 为空也**必须回复**，而且要带上自己的集合。见下面
        // #fireAntiEntropy 处的说明：存在只响应、不主动发起对账的设备。
        this.#send(envelope.to, envelope.from, {
          kind: "reply",
          ops: missing,
          known: knownOpIds(target.log),
        });
        break;
      }
      case "reply": {
        const added = target.receive(envelope.payload.ops);
        const missing = opsMissingFrom(target.log.all(), new Set(envelope.payload.known));
        this.#trace(
          "deliver:reply",
          envelope.from,
          envelope.to,
          `+${added} missing=${missing.length}`,
        );
        // 只在确实还有对端缺的操作时才继续回复，否则会无限来回报文
        if (missing.length > 0) {
          this.#send(envelope.to, envelope.from, {
            kind: "reply",
            ops: missing,
            known: knownOpIds(target.log),
          });
        }
        break;
      }
    }
  }

  /**
   * 周期性对账：每台设备轮流选一个对端，报出自己的完整 opId 集合。
   *
   * **为什么应答必须带上自己的集合**：对端收到摘要后，除了把「发起方缺的操作」
   * 发回去，还必须附上自己的集合。否则当一台设备**只响应、不主动发起**时
   * （`antiEntropy: false`，对应 ADR-0006 的 Android 瘦客户端），
   * 会出现这样的死角：发起方拥有对方缺的数据 → 发起方的 missing 为空 →
   * 应答方什么也不发；而应答方自己又从不开口 → 它永远拿不到数据。
   *
   * 顺带说明：只要**所有**设备都会主动发起对账，单向应答也能收敛 ——
   * 方向性由发起方轮转保证。双向应答去掉的是「依赖对端也主动发起」这个隐含前提。
   */
  #fireAntiEntropy(): void {
    if (this.#antiEntropyInterval <= 0) return;

    for (const device of this.#devices.values()) {
      if (this.#respondOnly.has(device.id)) continue;

      const next = this.#antiEntropyAt.get(device.id);
      if (next === undefined || this.#now < next) continue;
      this.#antiEntropyAt.set(device.id, this.#now + this.#antiEntropyInterval);

      const peers = [...this.#devices.keys()].filter((id) => id !== device.id);
      if (peers.length === 0) continue;

      // 轮转选对端而不是随机选：减少随机性对收敛时间的影响，结果更容易解释
      const cursor = this.#peerCursor.get(device.id) ?? 0;
      const peer = peers[cursor % peers.length]!;
      this.#peerCursor.set(device.id, cursor + 1);

      this.#trace("timer:anti-entropy", device.id, peer, null);
      this.#send(device.id, peer, { kind: "digest", known: knownOpIds(device.log) });
    }
  }
}

export function createSimulator(options: SimulatorOptions = {}): SyncSimulator {
  return new SyncSimulator(options);
}
