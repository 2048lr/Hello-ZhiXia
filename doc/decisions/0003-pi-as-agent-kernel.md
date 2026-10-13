# ADR-0003：选用 pi 作为 agent 内核

- **Status**: Accepted
- **Date**: 2026-10-13
- **Supersedes**: —

## Context

需要一个 agent 内核，提供：多 provider 的 LLM 调用、工具调用循环、会话持久化、跨进程状态传输。

候选：

1. **pi**（`earendil-works/pi`，原 `badlogic/pi-mono`，站点 pi.dev）
2. **自建** agent loop
3. 其他 agent 框架（LangChain / 各厂商 SDK 等）

关键约束是**许可证必须与闭源专有分发兼容**。本项目仓库为「保留所有权利（All Rights Reserved）」，若依赖传染性许可证（GPL / AGPL）将产生直接冲突。

## Decision

采用 **pi** 作为 agent 内核，具体复用以下包：

| 包 | 用途 |
| --- | --- |
| `@earendil-works/pi-ai` | 统一多 provider LLM API |
| `@earendil-works/pi-agent-core` | agent 运行时、工具调用、状态管理 |
| `@earendil-works/pi-durable` | 事务化会话/任务持久化 |
| `@earendil-works/chord` | 跨进程状态复制与 RPC（仅用于实时会话流） |

**本项目不做的事**：不重新实现 agent loop、不重新实现多 provider 适配、不重新实现工具调用协议。

## Consequences

**正面**

- **MIT 许可证**（全部包 v1.2.0 均为 MIT，Copyright (c) 2025 Mario Zechner）——与闭源专有分发**无冲突**，这是选型的决定性因素
- TypeScript 实现，与三端技术栈一致，无跨语言桥接
- 提供 RPC 模式（JSONL over stdin/stdout）与 TypeScript SDK，既支持同进程集成也支持子进程集成
- `chord` 提供现成的 WebSocket 状态复制，为协调层省下大量工作
- 明确支持 MCP，工具生态可直接复用
- 支持 llama.cpp 本地模型，为将来的离线能力留了口子

**负面**

- **pi 没有内置权限系统**。官方原文：不限制文件系统、进程、网络、凭据访问，以启动进程的用户权限运行。面向普通用户的日常助手必须自己补这一层，且这是安全关键路径
- **pi-durable 标注 Experimental**，API 不保证兼容。必须在其上包一层自有抽象，否则升级会波及全项目
- **pi-durable 的存储是单写者的**（官方原文：一个进程同时独占一个 storage，没有跨进程锁）。多设备同步必须由本项目自己协调
- Node.js ≥ 22.19 的硬要求，直接影响 Android 端的实现路径
- pi 是 CLI-first 设计的，面向「编码 agent」场景；用作日常助手属于换域使用，部分默认行为需要改造

## Alternatives considered

**自建 agent loop** — 完全可控、无依赖风险。被否决：工作量巨大（多 provider 适配、流式、工具协议、重试、压缩），且这些工作不构成产品的差异化价值。

**其他 agent 框架** — 未深入评估。pi 的 MIT 许可、TypeScript 实现、以及 chord/durable 这两个正好切中本项目需求的包，构成了足够强的正向理由；若后续发现 pi 在某方面不可替代地不足，应新增 ADR 记录迁移决策。

## 相关

- pi 仓库：https://github.com/badlogic/pi-mono （重定向至 `earendil-works/pi`）
- 官网：https://pi.dev
- 权限缺口的应对见 [open-questions #7、#8](../open-questions.md)
- 单写者约束的应对见 [ADR-0005](./0005-crdt-sync-basis.md) 与 [data-model.md](../data-model.md)
