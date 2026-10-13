# ADR-0002：目标平台为 Windows / Linux / Android，不支持 iOS

- **Status**: Accepted
- **Date**: 2026-10-13
- **Supersedes**: —

## Context

需求方明确「预计在 Windows、安卓、Linux 三端进行使用」，未提及 macOS 与 iOS。

技术侧的关键事实来自 pi 官方文档：

| 平台 | pi 的运行路径 |
| --- | --- |
| Windows / Linux / macOS | 原生支持，安装器或 npm |
| Android | 通过 **Termux**，官方提供 `termux.md` 文档；但仅是 CLI，文本输入与文件工具可用，剪贴板图片粘贴不支持 |
| iOS | **无任何路径**。官方未提供任何 iOS 方案 |

iOS 无法运行 pi 的根本原因不是工程投入不足，而是系统限制：iOS 不允许分发可执行任意代码的运行时环境，没有 Termux 的等价物。

## Decision

**支持 Windows、Linux、Android 三端；明确不支持 iOS，且不为其保留架构妥协。**

iOS 不列入非目标清单之外，即不为此预留抽象层——不为了"将来可能支持 iOS"而增加当前设计的复杂度。

## Consequences

**正面**

- 不需要为「移动端如何承载 agent」设计折中方案（例如远程算力代理），移动端定位可以纯粹地定为瘦客户端
- 覆盖率上没有模糊地带，文档与测试目标明确
- 避免了一类常见的架构腐蚀：为了一个永远不会实现的目标平台引入间接层

**负面**

- **失去 iPhone 用户群**。在部分市场这会是显著的产品缺口
- 如果将来 iOS 成为硬需求，只能做「远端算力 + iOS 瘦客户端」，届时应新增 ADR，而不是修改本篇
- Android 端必须自己解决 Node 运行时问题（见 [ADR-0006](./0006-android-thin-client.md)）

## Alternatives considered

**支持 iOS（瘦客户端连计算节点）** — 技术上可行：iOS 只做 UI 与通知，agent 跑在 Windows/Linux 节点上。被否决，因为需求方未将 iOS 列入范围，而为此付出的架构复杂度（连接管理、离线降级、通知转发）在当前阶段没有对应收益。

**支持 macOS** — 技术上门槛最低（pi 原生支持）。需求方未提及，暂不列入；若后续需要，只需新增一个平台适配层实现，不影响任何已有决策。

## 备注

Android 通过 Termux 运行 pi 是被验证过的路径，但它要求用户手动安装 Termux、执行命令——这与「安装即用」的目标冲突（见 [ADR-0006](./0006-android-thin-client.md)）。
