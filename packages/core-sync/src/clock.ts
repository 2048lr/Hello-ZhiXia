/**
 * 混合逻辑时钟（Hybrid Logical Clock，HLC）。
 *
 * 见 data-model.md 第二节。多设备之间没有可信的统一时钟，因此**不能用裸墙钟排序**：
 * 设备时钟漂移会导致排序错乱、冲突判定出错。
 *
 * HLC 用三元组给出一个尊重因果关系的全序：
 *
 *   (wall, counter, deviceId)
 *
 * - `wall` 是物理毫秒，让时间戳「大致反映真实时间」，便于展示与超时判断
 * - `counter` 在同一毫秒内递增，保证本机事件严格递增
 * - `deviceId` 作为最终决胜，让不同设备的并发事件也有确定顺序
 *
 * **冲突判定一律使用三元组整体比较（{@link compareHlc}），不要只比 wall。**
 */

export interface HlcTimestamp {
  /** 物理毫秒。仅用于排序、展示与超时判断。 */
  readonly wall: number;
  /** 同一毫秒内的逻辑计数器。 */
  readonly counter: number;
  /** 产生该时间戳的设备。最终决胜，保证全序。 */
  readonly deviceId: string;
}

/**
 * 全序比较。返回值 < 0 表示 a 在前，> 0 表示 b 在前，0 表示同一时间戳。
 * 该比较是确定性的：任何设备对同一对时间戳都会得到相同结论。
 */
export function compareHlc(a: HlcTimestamp, b: HlcTimestamp): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.deviceId === b.deviceId) return 0;
  return a.deviceId < b.deviceId ? -1 : 1;
}

export function hlcEquals(a: HlcTimestamp, b: HlcTimestamp): boolean {
  return compareHlc(a, b) === 0;
}

/** 可注入的物理时钟，便于测试里构造时钟偏移与回拨。 */
export type PhysicalClock = () => number;

export class HybridLogicalClock {
  readonly #deviceId: string;
  readonly #now: PhysicalClock;

  /** -1 表示尚未产生任何事件。 */
  #wall = -1;
  #counter = 0;

  constructor(deviceId: string, now: PhysicalClock = Date.now) {
    if (deviceId.length === 0) {
      throw new TypeError("deviceId 不能为空：它承担全序决胜，必须是稳定的设备标识");
    }
    this.#deviceId = deviceId;
    this.#now = now;
  }

  get deviceId(): string {
    return this.#deviceId;
  }

  /** 最近一次产生或观察到的时间戳；尚未发生任何事件时为 undefined。 */
  peek(): HlcTimestamp | undefined {
    if (this.#wall < 0) return undefined;
    return { wall: this.#wall, counter: this.#counter, deviceId: this.#deviceId };
  }

  /**
   * 本机事件：产生一个严格大于此前的本机时间戳。
   *
   * 规则：`wall = max(物理时钟, 上次 wall)`；
   * 若 `wall` 未前进（同一毫秒或时钟回拨）则 `counter + 1`，否则 `counter = 0`。
   */
  tick(): HlcTimestamp {
    const physical = this.#now();
    if (physical > this.#wall) {
      this.#wall = physical;
      this.#counter = 0;
    } else {
      this.#counter += 1;
    }
    return { wall: this.#wall, counter: this.#counter, deviceId: this.#deviceId };
  }

  /**
   * 观察到远端事件：推进本地时钟，返回值**严格大于** remote 与本地此前的时间戳。
   *
   * 这是 HLC 的关键一步：如果只做「wall = max(...) 然后 counter + 1」，
   * 当本地 counter 小于远端 counter 时会产出一个**早于刚刚观察到的事件**的时间戳，
   * 因果序就被破坏了。因此必须把远端 counter 纳入计算：
   *
   * | 情况 | counter 取值 |
   * | --- | --- |
   * | 物理时钟领先 | 0 |
   * | 本地 wall 最大且与远端相同 | max(本地, 远端) + 1 |
   * | 仅本地 wall 最大 | 本地 + 1 |
   * | 仅远端 wall 最大 | 远端 + 1 |
   */
  observe(remote: HlcTimestamp): HlcTimestamp {
    const physical = this.#now();
    const maxWall = Math.max(physical, this.#wall, remote.wall);

    if (maxWall === this.#wall && maxWall === remote.wall) {
      this.#counter = Math.max(this.#counter, remote.counter) + 1;
    } else if (maxWall === this.#wall) {
      this.#counter += 1;
    } else if (maxWall === remote.wall) {
      this.#counter = remote.counter + 1;
    } else {
      this.#counter = 0;
    }

    this.#wall = maxWall;
    return { wall: this.#wall, counter: this.#counter, deviceId: this.#deviceId };
  }
}
