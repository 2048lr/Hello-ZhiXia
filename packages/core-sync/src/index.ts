/**
 * @hzx/core-sync —— 数据层契约。
 *
 * 这个包是**三端共用**的（Windows / Linux / Android）。它只包含类型、纯函数与
 * 不依赖具体平台的实现，因此可以被任何一端的运行时直接引用。
 *
 * 分成五个部分，对应 data-model.md 的六条「第一天必须做对」的约定：
 *
 * | 模块 | 对应约定 |
 * | --- | --- |
 * | `id.ts` | 标识符：ULID |
 * | `clock.ts` | 逻辑时钟：HLC |
 * | `op.ts` | 写入方式：只追加操作日志 |
 * | `deletion.ts` | 删除：墓碑与两级删除语义 |
 * | `schema.ts` | Schema 版本化 |
 *
 * 第六条约定的「三端共用同一个数据层包」，就是这个包本身。
 */

export * from "./clock.js";
export * from "./deletion.js";
export * from "./id.js";
export * from "./op.js";
export * from "./schema.js";
