# ADR-0005：以 CRDT + 操作日志作为同步基座

- **Status**: Accepted
- **Date**: 2026-10-13
- **Supersedes**: —

## Context

P2P mesh 拓扑（[ADR-0001](./0001-local-first-p2p-mesh.md)）意味着：设备可能随时离线、网络可能分区、没有权威服务器来仲裁冲突。

按 CAP 定理，在分区容忍（P）必须保证、可用性（A）必须保证的前提下，**一致性（C）只能让步**——接受最终一致。

问题变成：用什么机制来表达「最终一致」。

同时有两个现成的候选需要评估：

1. **`@earendil-works/chord`（pi 生态内）** — 提供 `replicatedState`、快照 + 增量、WebSocket 链路
2. **成熟的 CRDT 库（Yjs / Automerge）** — 专为离线并发编辑设计

pi-durable 文档对 chord 的 watch 语义有明确描述：

> A slow watch keeps at most 100 undelivered frames. After that, the pending frames are replaced by one frame holding the whole newest view. A client that joins late or reconnects starts from the current view; **nothing is replayed.**

这意味着 chord 的设计目标是**实时观看**（一个正在运行的 agent 会话），不是**可靠同步**（离线数天后的数据合并）。

## Decision

**同步基座 = 本项目自建的操作日志（op log）+ 成熟 CRDT 库**，并按数据类型分层：

| 用途 | 技术 | 理由 |
| --- | --- | --- |
| 用户数据（笔记、日程、待办、会话记录） | 自建 op log + Yjs 或 Automerge | 需要离线并发合并，chord 不满足 |
| 实时会话流（正在执行的 agent） | **chord**（webSocketLink） | 恰好是它被设计出来的用途 |
| 派生数据（向量索引、摘要） | **不同步**，本地重建 | 可重建的东西同步它既贵又易错 |
| 二进制内容（附件） | 内容寻址 + 按需拉取 | 避免全量复制 |

具体的数据层约定见 [data-model.md](../data-model.md)。

## Consequences

**正面**

- 离线数周后重连仍能正确合并，这是 chord 的 watch 语义做不到的
- 操作日志天然提供审计能力（「这条数据是谁、什么时候、为什么改的」）
- 派生数据不同步，显著降低同步数据量与 embedding 成本
- 职责分离清晰：chord 管实时，CRDT 管持久，两者互不依赖

**负面**

- **要自己实现并维护一套同步协议**，这是本项目最大的复杂度来源
- CRDT 的元数据（墓碑、向量时钟、操作历史）会持续增长，需要压缩策略（快照 + 墓碑过期）
- 冲突语义需要逐数据类型定义，不能一概而论（见 [data-model.md](../data-model.md#七冲突解决规则)）
- 调试困难：最终一致的 bug 往往是「偶发、难以复现、无法观察」，测试策略成为必需而非可选（见 [open-questions #9](../open-questions.md)）
- 团队需要理解 CRDT 与逻辑时钟，有学习成本

## Alternatives considered

**直接用 chord 做全部同步** — 代码量最少，与 pi 生态一致。被否决：由文档原文可知它**不回放**、慢消费者会丢中间帧、重连从最新快照开始。用它做同步会在「设备离线一段时间」这个最常见的场景上直接丢数据。

**最后写入者胜（LWW）数据库同步** — 例如直接把 SQLite 文件同步。被否决：会静默丢数据，且无法表达并发意图。对日程这类数据，静默丢失比弹出冲突提示危险得多。

**中心服务器做权威状态** — 同步问题最简单（服务器说了算）。被否决：与 [ADR-0001](./0001-local-first-p2p-mesh.md) 的根本前提冲突。
