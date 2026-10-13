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
 * 墓碑是否已可以从快照中裁剪掉。
 *
 * 注意这是**保守**判断：只要保留期未到就不裁剪。
 * 裁剪早于「设备可能离线的最长时间」会导致数据复活。
 */
export function isTombstonePrunable(tombstone: Tombstone, nowWall: number): boolean {
  if (tombstone.pinned === true) return false;
  return nowWall - tombstone.deletedAt.wall >= TOMBSTONE_RETENTION_MS;
}

/**
 * 墓碑是否「可能失效」——即存在某个离线过久的设备，重连后可能复活该数据。
 * 用于 UI 如实提示用户，而不是隐瞒。
 */
export function isTombstoneAtRisk(tombstone: Tombstone, nowWall: number): boolean {
  return nowWall - tombstone.deletedAt.wall > TOMBSTONE_RETENTION_MS;
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
