import { describe, expect, it } from "vitest";

import { assertUlid, createMonotonicUlidFactory, isValidUlid, ulid, ulidTime } from "./id.js";

describe("ulid", () => {
  it("生成 26 字符且可通过校验", () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isValidUlid(id)).toBe(true);
  });

  it("内嵌的时间戳可原样取回", () => {
    const now = 1_700_000_000_000;
    expect(ulidTime(ulid(now))).toBe(now);
  });

  it("时间戳前缀保证字典序等于时间序", () => {
    // Crockford Base32 的字符顺序与 ASCII 顺序一致，因此字符串比较即数值比较
    const early = ulid(1_000);
    const late = ulid(2_000);
    expect(early < late).toBe(true);
  });

  it("拒绝非法输入，包括 Crockford 排除的 I/L/O/U", () => {
    expect(isValidUlid("")).toBe(false);
    expect(isValidUlid("not-a-ulid")).toBe(false);
    expect(isValidUlid(null)).toBe(false);
    // 长度正确（26）但含被排除的字符 I
    expect(isValidUlid("01ARZ3NDEKTSV4RRFFQ69G5FAI")).toBe(false);
    expect(() => assertUlid("bad")).toThrow(TypeError);
  });

  it("同一毫秒内大量生成不重复", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      seen.add(ulid(1_700_000_000_000));
    }
    expect(seen.size).toBe(10_000);
  });
});

describe("createMonotonicUlidFactory", () => {
  it("同一毫秒内字典序严格递增", () => {
    const factory = createMonotonicUlidFactory(5_000);
    let previous = factory(5_000);
    for (let i = 0; i < 1_000; i += 1) {
      const current = factory(5_000);
      expect(previous < current).toBe(true);
      previous = current;
    }
  });

  it("时钟回拨时不倒退，且不把内嵌时间戳改小", () => {
    const factory = createMonotonicUlidFactory(9_000);
    const before = factory(9_000);
    const after = factory(1_000); // 墙钟回拨

    expect(before < after).toBe(true);
    expect(ulidTime(after)).toBe(9_000);
  });

  it("时间前进时重新随机", () => {
    const factory = createMonotonicUlidFactory(1_000);
    const a = factory(1_000);
    const b = factory(2_000);
    expect(ulidTime(a)).toBe(1_000);
    expect(ulidTime(b)).toBe(2_000);
    expect(a < b).toBe(true);
  });
});
