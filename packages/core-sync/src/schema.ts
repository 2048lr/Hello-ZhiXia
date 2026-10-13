/**
 * Schema 版本化与迁移。见 data-model.md 第五节。
 *
 * 三条硬性约定：
 *
 * 1. 迁移必须是**纯函数**：相同输入在任何设备上都必须产出相同结果。
 *    否则各设备迁移后的数据会分叉，且难以察觉。
 * 2. 新设备必须能解析**任意历史版本**的数据 —— 因此迁移链必须从旧版本一路可达。
 * 3. 迁移函数一旦发布**不可修改**，只能追加新版本。修改已发布的迁移
 *    会让「已迁移过的设备」和「尚未迁移的设备」得到不同结果。
 */

import type { JsonValue } from "./op.js";

export interface Migration {
  /** 源版本。 */
  readonly from: number;
  /** 目标版本，必须等于 `from + 1`。 */
  readonly to: number;
  readonly migrate: (value: JsonValue) => JsonValue;
}

export class MigrationRegistry {
  readonly #byFrom = new Map<number, Migration>();

  register(migration: Migration): this {
    if (migration.to !== migration.from + 1) {
      throw new Error(
        `迁移必须逐版本递增，收到 ${migration.from} → ${migration.to}。` +
          `跨版本迁移会让不同的升级路径产生不同结果。`,
      );
    }
    if (this.#byFrom.has(migration.from)) {
      throw new Error(
        `版本 ${migration.from} 的迁移已注册。已发布的迁移函数不可修改，请追加新版本。`,
      );
    }
    this.#byFrom.set(migration.from, migration);
    return this;
  }

  latestVersion(): number {
    let latest = 0;
    for (const migration of this.#byFrom.values()) {
      latest = Math.max(latest, migration.to);
    }
    return latest;
  }

  /**
   * 把数据从 `fromVersion` 迁移到最新版本。
   *
   * 当数据的版本**高于**本端已知的最新版本时抛错：这说明本端应用版本过旧，
   * 直接按旧 schema 解释新数据会静默损坏数据（见 ADR-0009 的版本偏斜问题）。
   */
  migrate(value: JsonValue, fromVersion: number): JsonValue {
    const latest = this.latestVersion();
    if (fromVersion > latest) {
      throw new Error(
        `数据的 schema 版本 ${fromVersion} 高于本端已知的最新版本 ${latest}，请先升级应用`,
      );
    }

    let current = value;
    let version = fromVersion;
    while (version < latest) {
      const migration = this.#byFrom.get(version);
      if (migration === undefined) {
        throw new Error(`缺少版本 ${version} → ${version + 1} 的迁移函数，迁移链不完整`);
      }
      current = migration.migrate(current);
      version = migration.to;
    }
    return current;
  }
}
