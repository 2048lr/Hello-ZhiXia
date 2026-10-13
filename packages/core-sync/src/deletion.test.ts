import { describe, expect, it } from "vitest";

import {
  confirmPurge,
  forcePurge,
  isTombstoneAtRisk,
  isTombstonePrunable,
  purgeProgress,
  TOMBSTONE_RETENTION_MS,
  type PurgeRequest,
  type Tombstone,
} from "./deletion.js";
import { ulid } from "./id.js";

const NOW = 1_700_000_000_000;

function tombstone(deletedAtWall: number, pinned?: boolean): Tombstone {
  const base: Tombstone = {
    entityId: ulid(deletedAtWall),
    deletedAt: { wall: deletedAtWall, counter: 0, deviceId: "A" },
    deletedBy: "A",
  };
  return pinned === true ? { ...base, pinned: true } : base;
}

describe("墓碑保留期", () => {
  it("保留期未到不可裁剪", () => {
    const fresh = tombstone(NOW - 1_000);
    expect(isTombstonePrunable(fresh, NOW)).toBe(false);
  });

  it("保留期已过可以裁剪", () => {
    const old = tombstone(NOW - TOMBSTONE_RETENTION_MS - 1);
    expect(isTombstonePrunable(old, NOW)).toBe(true);
  });

  it("pinned 的墓碑永不裁剪（彻底删除流程进行中必须保留）", () => {
    const old = tombstone(NOW - TOMBSTONE_RETENTION_MS * 10, true);
    expect(isTombstonePrunable(old, NOW)).toBe(false);
  });

  it("超过保留期的墓碑标记为有风险（离线过久的设备可能复活数据）", () => {
    expect(isTombstoneAtRisk(tombstone(NOW - 1_000), NOW)).toBe(false);
    expect(isTombstoneAtRisk(tombstone(NOW - TOMBSTONE_RETENTION_MS - 1), NOW)).toBe(true);
  });
});

describe("彻底删除流程", () => {
  function request(targets: readonly string[], confirmed: readonly string[] = []): PurgeRequest {
    return {
      purgeId: ulid(NOW),
      requestedAt: { wall: NOW, counter: 0, deviceId: "A" },
      targets,
      confirmed,
    };
  }

  it("区分已确认与未确认设备", () => {
    const progress = purgeProgress(request(["A", "B", "C"], ["A", "C"]));

    expect(progress.confirmed).toEqual(["A", "C"]);
    expect(progress.pending).toEqual(["B"]);
    expect(progress.canComplete).toBe(false);
  });

  it("全部确认后才能完成", () => {
    expect(purgeProgress(request(["A", "B"], ["A", "B"])).canComplete).toBe(true);
  });

  it("重复确认是幂等的", () => {
    const once = confirmPurge(request(["A", "B"]), "A");
    const twice = confirmPurge(once, "A");

    expect(once.confirmed).toEqual(["A"]);
    expect(twice.confirmed).toEqual(["A"]);
    expect(twice).toBe(once);
  });

  it("拒绝非目标设备的确认", () => {
    expect(() => confirmPurge(request(["A"]), "Z")).toThrow();
  });

  it("强制清除会移出未确认设备，并如实报告被撤销的设备", () => {
    const result = forcePurge(request(["A", "B", "C"], ["A"]));

    expect(result.revokedDevices).toEqual(["B", "C"]);
    expect(result.request.targets).toEqual(["A"]);
    expect(purgeProgress(result.request).canComplete).toBe(true);
  });

  it("全部已确认时强制清除不撤销任何设备", () => {
    const result = forcePurge(request(["A", "B"], ["A", "B"]));

    expect(result.revokedDevices).toEqual([]);
    expect(result.request.targets).toEqual(["A", "B"]);
  });
});
