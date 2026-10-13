/**
 * 虚拟设备 —— 模拟器里的一个节点。
 *
 * 它只做三件事：持有 HLC、持有操作日志、按需产生操作。
 * 网络行为完全不在这里（那是 {@link SyncSimulator} 的职责），
 * 这样同一套设备逻辑既能跑在模拟网络里，也能跑在真实网络上。
 */

import { HybridLogicalClock } from "../clock.js";
import { createMonotonicUlidFactory, type Ulid, type UlidFactory } from "../id.js";
import { createMemoryOpLog, mergeOps, type JsonValue, type Op, type OpLog } from "../op.js";
import { createRandom, createRandomBytes, deriveSeed } from "./random.js";

export interface VirtualDeviceOptions {
  /** 种子基数。同一 `id` + 同一基数 → 完全相同的 id 序列。 */
  readonly seedBase: number;
  /** 初始墙钟（虚拟毫秒）。 */
  readonly startWall: number;
  /** 相对基准的时钟偏移，用于模拟设备间时钟漂移。 */
  readonly clockSkew?: number;
  /** 本地产生操作后的回调，由模拟器用来触发传播。 */
  readonly onLocalOp?: (op: Op) => void;
}

export class VirtualDevice {
  readonly id: string;
  readonly clock: HybridLogicalClock;
  readonly log: OpLog;

  readonly #newId: UlidFactory;
  readonly #onLocalOp: ((op: Op) => void) | undefined;
  #wall: number;

  constructor(id: string, options: VirtualDeviceOptions) {
    this.id = id;
    this.#wall = options.startWall + (options.clockSkew ?? 0);
    this.#onLocalOp = options.onLocalOp;

    // 每台设备一条独立的确定性随机流，保证结果不受其他设备的调度影响
    const seed = deriveSeed(options.seedBase, id);
    this.#newId = createMonotonicUlidFactory(createRandomBytes(createRandom(seed)));

    // 物理时钟指向 `#wall`，因此可以通过 setWall / advanceWall 注入偏移与回拨
    this.clock = new HybridLogicalClock(id, () => this.#wall);
    this.log = createMemoryOpLog();
  }

  /** 当前墙钟（虚拟毫秒）。 */
  get wall(): number {
    return this.#wall;
  }

  /** 直接设置墙钟。用于注入时钟偏移，或模拟时钟回拨。 */
  setWall(wall: number): void {
    this.#wall = wall;
  }

  advanceWall(delta: number): void {
    this.#wall += delta;
  }

  /** 生成一个全新的实体 id。 */
  newEntityId(): Ulid {
    return this.#newId(this.#wall);
  }

  /**
   * 产生一个本地操作：先推进 HLC（本机事件），再生成操作 id。
   * 顺序很重要 —— 操作 id 的时间戳与 HLC 都取自同一个 `#wall`。
   */
  write(entityId: Ulid, type: string, payload: JsonValue = null, schemaVersion = 1): Op {
    const hlc = this.clock.tick();
    const op: Op = {
      opId: this.#newId(this.#wall),
      hlc,
      entityId,
      type,
      payload,
      schemaVersion,
    };
    this.log.append(op);
    this.#onLocalOp?.(op);
    return op;
  }

  /**
   * 接收远端操作：先 `observe` 它们的 HLC（推进本地时钟、保持因果序），再合并。
   *
   * 顺序不能颠倒：先合并的话，合并过程中若产生新操作（例如冲突合并策略写入
   * 一条补充操作），会用尚未推进的 HLC，产出一个早于所观察事件的时间戳。
   */
  receive(ops: readonly Op[]): number {
    for (const op of ops) {
      this.clock.observe(op.hlc);
    }
    return mergeOps(this.log, ops);
  }
}
