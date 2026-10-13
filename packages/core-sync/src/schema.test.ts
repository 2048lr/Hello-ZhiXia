import { describe, expect, it } from "vitest";

import type { JsonValue } from "./op.js";
import { MigrationRegistry, type Migration } from "./schema.js";

/** 构造一个「给对象加一个字段」的迁移，用于测试链式执行。 */
function addField(field: string, value: JsonValue): Migration["migrate"] {
  return (input) => {
    const record = input as Record<string, JsonValue>;
    return { ...record, [field]: value };
  };
}

describe("MigrationRegistry", () => {
  it("拒绝跨版本迁移（会让不同升级路径产生不同结果）", () => {
    const registry = new MigrationRegistry();
    expect(() => registry.register({ from: 0, to: 2, migrate: (v) => v })).toThrow(/逐版本递增/);
  });

  it("拒绝重复注册（已发布的迁移函数不可修改）", () => {
    const registry = new MigrationRegistry();
    registry.register({ from: 0, to: 1, migrate: (v) => v });
    expect(() => registry.register({ from: 0, to: 1, migrate: (v) => v })).toThrow(/不可修改/);
  });

  it("latestVersion 取所有迁移目标版本的最大值", () => {
    const registry = new MigrationRegistry();
    expect(registry.latestVersion()).toBe(0);

    registry.register({ from: 0, to: 1, migrate: (v) => v });
    registry.register({ from: 1, to: 2, migrate: (v) => v });

    expect(registry.latestVersion()).toBe(2);
  });

  it("从任意历史版本链式迁移到最新", () => {
    const registry = new MigrationRegistry()
      .register({ from: 0, to: 1, migrate: addField("name", "anon") })
      .register({ from: 1, to: 2, migrate: addField("tags", []) });

    expect(registry.migrate({}, 0)).toEqual({ name: "anon", tags: [] });
    expect(registry.migrate({ name: "x" }, 1)).toEqual({ name: "x", tags: [] });
    expect(registry.migrate({ done: true }, 2)).toEqual({ done: true });
  });

  it("数据版本高于本端已知版本时报错，而不是按旧 schema 静默解释", () => {
    const registry = new MigrationRegistry().register({ from: 0, to: 1, migrate: (v) => v });
    expect(() => registry.migrate({}, 5)).toThrow(/请先升级应用/);
  });

  it("迁移链不完整时报错", () => {
    const registry = new MigrationRegistry().register({ from: 1, to: 2, migrate: (v) => v });
    expect(() => registry.migrate({}, 0)).toThrow(/迁移链不完整/);
  });

  it("迁移是纯函数：相同输入结果一致，且不修改输入", () => {
    const registry = new MigrationRegistry().register({
      from: 0,
      to: 1,
      migrate: (input) => {
        const record = input as Record<string, JsonValue>;
        return { ...record, count: ((record["count"] as number | undefined) ?? 0) + 1 };
      },
    });

    const input: JsonValue = { count: 1 };
    expect(registry.migrate(input, 0)).toEqual({ count: 2 });
    expect(registry.migrate(input, 0)).toEqual({ count: 2 });
    expect(input).toEqual({ count: 1 });
  });
});
