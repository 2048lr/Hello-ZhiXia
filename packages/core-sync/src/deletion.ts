/**
 * 删除语义 —— 两级模型，见 ADR-0014。
 *
 * 在无中心的全量复制系统里，「删除」是一个分布式问题：
 * 物理删除会让**离线设备重连后把数据复活**，所以删除必须写墓碑。
 * 但墓碑不能永久保留，否则元数据无限增长（与 ADR-0013 的体积预算冲突）。
 *
 * 于是分成两级，并把**能兑现的承诺**与**不能兑现的承诺**明确区分开：
 *
 * | 主张 | 能否 100% 兑现 |
 * | --- | --- |
 * | 服务方任何时候都无法读取你的数据 | ✅ 可以（只转发密文） |
 * | 删除后数据在所有地方彻底消失 | ❌ 取决于设备是否在线 |
 *
 * ## 裁剪的时钟语义（重要）
 *
 * 判断「墓碑能不能丢掉」时**不能**用本机墙钟。裁剪的安全性取决于
 * **最落后的那台设备**，而不是本机：某台设备时钟快了 180 天，就会把刚创建的
 * 墓碑判定为可裁剪；一旦裁剪掉，那台真正离线很久的设备重连后就会把数据复活。
 *
 * 因此本模块要求调用方提供 {@link PruneWatermark}（裁剪安全水位）——
 * 由**每台配对设备各自报告**的最新 HLC 取最小值得到。这是分布式下唯一正确的答案：
 * 只要有设备没上报，水位就不完整，裁剪一律被拒。
 */

import type { HlcTimestamp } from "./clock.js";
import type { Ulid } from "./id.js";

/** 墓碑保留期（天）。见 ADR-0014：远大于「设备正常离线」的典型时长。 */
export const TOMBSTONE_RETENTION_DAYS = 180;

export const TOMBSTONE_RETENTION_MS = TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface Tombstone {
  readonly entityId: Ulid;
  readonly deletedAt: HlcTimestamp;
  /** 执行删除的设备。 */
  readonly deletedBy: string;
  /**
   * 是否豁免快照裁剪。
   * 彻底删除流程进行中的墓碑必须 pin 住，否则裁剪后无法向离线设备传播删除意图。
   */
  readonly pinned?: boolean;
}

/**
 * 裁剪安全水位 —— 一个**所有配对设备都已越过**的时间点。
 *
 * 用 {@link pruneWatermark} 从各设备上报的 HLC 构造，不要手工拼：
 * `complete` 与 `reported` 必须如实反映「还有几台设备没确认」。
 */
export interface PruneWatermark {
  /**
   * 已上报设备中最小的 HLC wall。
   * **只有在 {@link PruneWatermark.complete} 为 true 时它才是一个可信的水位。**
   */
  readonly wall: number;
  /** 已上报过 HLC 的设备数。 */
  readonly reported: number;
  /** 配对列表中的设备总数。 */
  readonly expected: number;
  /** `reported === expected`。为 false 表示水位不可信，任何裁剪都必须被拒绝。 */
  readonly complete: boolean;
}

/**
 * 由「每台配对设备的最新已知 HLC」构造裁剪安全水位。
 *
 * **尚未上报过的设备必须显式出现在 map 里、值为 `undefined`**，不能省略。
 * 省略会被当成「这台设备根本不在配对列表里」，于是 `expected` 被算小、
 * 水位被错误地判定为完整 —— 而新配对或长期离线的设备恰恰是最可能
 * 让数据复活的那一台。
 *
 * @param latestByDevice 设备 id → 该设备的最新已知 HLC（尚未上报则为 `undefined`）
 */
export function pruneWatermark(
  latestByDevice: ReadonlyMap<string, HlcTimestamp | undefined>,
): PruneWatermark {
  let wall = Number.POSITIVE_INFINITY;
  let reported = 0;

  for (const timestamp of latestByDevice.values()) {
    if (timestamp === undefined) continue;
    reported += 1;
    if (timestamp.wall < wall) wall = timestamp.wall;
  }

  const expected = latestByDevice.size;
  return {
    // 一台都没上报时给 -Infinity：与任何 deletedAt 的差值都是 -Infinity，
    // 于是任何「年龄 ≥ 保留期」的判定自然为 false，不需要额外的特判分支。
    wall: reported === 0 ? Number.NEGATIVE_INFINITY : wall,
    reported,
    expected,
    // 空配对列表不算「完整」：没有任何设备可以确认，就不该放行裁剪。
    complete: expected > 0 && reported === expected,
  };
}

/**
 * 墓碑相对水位的年龄。
 * 水位不可信（不完整）时返回 `-Infinity`，即「永远不到期」。
 */
function tombstoneAge(tombstone: Tombstone, watermark: PruneWatermark): number {
  if (!watermark.complete) return Number.NEGATIVE_INFINITY;
  return watermark.wall - tombstone.deletedAt.wall;
}

/**
 * 墓碑是否已可以从快照中裁剪掉。
 *
 * 三个条件缺一不可：
 *
 * 1. 未被 pin（彻底删除流程进行中不能丢）
 * 2. 水位**完整** —— 只要有一台配对设备没上报，就一律不裁剪
 * 3. 年龄 ≥ 保留期
 *
 * 注意这是**保守**判断：裁剪早于「设备可能离线的最长时间」会导致数据复活，
 * 因此宁可多留。
 */
export function isTombstonePrunable(tombstone: Tombstone, watermark: PruneWatermark): boolean {
  if (tombstone.pinned === true) return false;
  return tombstoneAge(tombstone, watermark) >= TOMBSTONE_RETENTION_MS;
}

/**
 * 墓碑是否「可能失效」—— 即无法排除某台设备重连后复活该数据。
 *
 * 判据不是墓碑的年龄，而是**水位是否完整**：只要存在没能确认的设备，
 * 就永远无法保证该数据不会复活。
 *
 * 但也不必对每一个新建的墓碑都报警（那只会淹没真正的问题），
 * 因此只在它「本该可以裁剪、却因为水位不完整而裁不掉」时才提示 ——
 * 这正是「存在某台设备离线过久」的可观测信号。UI 应当如实呈现，
 * 而不是把「已请求删除」显示成「已彻底消失」。
 *
 * 与 {@link isTombstonePrunable} **恰好互斥**：可裁剪要求水位完整，
 * 处于风险要求水位不完整，二者不可能同时成立。
 */
export function isTombstoneAtRisk(tombstone: Tombstone, watermark: PruneWatermark): boolean {
  if (watermark.complete) return false;
  // pinned 的墓碑正在主动传播删除意图，属于「处理中」，不是「无法确认」。
  if (tombstone.pinned === true) return false;
  return watermark.wall - tombstone.deletedAt.wall >= TOMBSTONE_RETENTION_MS;
}

/** 彻底删除请求（第二级删除）。 */
export interface PurgeRequest {
  readonly purgeId: Ulid;
  readonly requestedAt: HlcTimestamp;
  /** 配对列表中所有已知设备。 */
  readonly targets: readonly string[];
  /** 已确认执行的设备。 */
  readonly confirmed: readonly string[];
}

export interface PurgeProgress {
  readonly confirmed: readonly string[];
  /** 尚未确认的设备。非空表示**无法立即宣称数据已彻底消失**。 */
  readonly pending: readonly string[];
  readonly canComplete: boolean;
}

export function purgeProgress(request: PurgeRequest): PurgeProgress {
  const confirmedSet = new Set(request.confirmed);
  const confirmed = request.targets.filter((deviceId) => confirmedSet.has(deviceId));
  const pending = request.targets.filter((deviceId) => !confirmedSet.has(deviceId));
  return { confirmed, pending, canComplete: pending.length === 0 };
}

/** 记录一台设备的确认。重复确认是幂等的。 */
export function confirmPurge(request: PurgeRequest, deviceId: string): PurgeRequest {
  if (!request.targets.includes(deviceId)) {
    throw new Error(`设备 ${deviceId} 不在彻底删除的目标列表中`);
  }
  if (request.confirmed.includes(deviceId)) return request;
  return { ...request, confirmed: [...request.confirmed, deviceId] };
}

export interface ForcePurgeResult {
  readonly request: PurgeRequest;
  /**
   * 因长期离线而被移出配对列表的设备。
   * **它们上面的数据无法从物理上删除** —— 这一事实必须如实告知用户，不能用文案掩盖。
   */
  readonly revokedDevices: readonly string[];
}

/**
 * 强制清除：不再等待离线设备，把它们从配对列表移除。
 * 这些设备将来必须重新配对才能加入。
 */
export function forcePurge(request: PurgeRequest): ForcePurgeResult {
  const { confirmed, pending } = purgeProgress(request);
  return {
    request: { ...request, targets: confirmed, confirmed },
    revokedDevices: pending,
  };
}
