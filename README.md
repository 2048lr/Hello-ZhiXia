# Hello-ZhiXia

> **知夏生活（HZX）**

---

## 项目简介

Hello-ZhiXia（知夏生活，简称 **HZX**）是一个**跨平台、多设备自动同步、无中心数据服务器**的个人 agent 兼日常助手。

- **跨平台** — Windows、Linux、Android 三端，同一套数据与能力
- **多设备同步** — 任一端的改动自动出现在其他端，各端持有完整的结构化数据副本
- **无中心** — 用户数据不经过服务方；见面点只能看到密文与连接元数据
- **日常助手** — 日程、提醒、闹钟、笔记、文件、知识库、自动化

## 目录结构

```
Hello-ZhiXia/
├── package.json           # pnpm workspace 根
├── pnpm-workspace.yaml
├── tsconfig.base.json     # 三端共享的 TS 配置
├── packages/
│   ├── core-sync/         # 数据层契约：ULID / HLC / 操作日志 / 墓碑 / schema 版本化
│   ├── core-agent/        # pi 封装：工具注册、权限门、会话管理
│   ├── core-mesh/         # 协调层：设备身份、发现、传输、写权租约
│   ├── platform-adapters/ # 平台适配接口（文件 / 通知 / 闹钟 / 钥匙串）
│   └── ui-shared/         # 三端共享的 UI 与状态绑定
├── apps/
│   ├── desktop/           # Electron 桌面应用（Windows / Linux）
│   └── android/           # Android 瘦客户端（技术选型待定）
└── services/
    └── rendezvous/        # 自建 rendezvous / relay
```

## 快速开始

```bash
git clone https://github.com/xaxovo/Hello-ZhiXia.git
cd Hello-ZhiXia
```

**技术栈**

| 层 | 选型 |
| --- | --- |
| Agent 内核 | [pi](https://pi.dev)（MIT 许可）：`pi-agent-core` · `pi-ai` · `pi-durable` |
| 实时会话流 | `@earendil-works/chord` |
| 数据同步 | 操作日志（op log）+ CRDT（Yjs / Automerge） |
| 桌面壳 | Electron（Windows / Linux） |
| 移动端 | Android 瘦客户端——持有完整数据副本，不执行 agent |
| 运行时 | Node.js ≥ 22.19 · TypeScript |

### 开发

```bash
pnpm install        # 安装依赖
pnpm typecheck      # 类型检查（含测试文件）
pnpm test           # 运行单元测试
pnpm build          # 构建全部包
```

> ⚠️ 项目处于**早期阶段**：`@hzx/core-sync`（数据层契约）已实现并有测试覆盖；
> 其余包都是空骨架，只写了职责说明与受哪些决策约束。

**Windows 开发者注意**：monorepo 的 `node_modules` 层级很深，请先执行
`git config --global core.longpaths true`，否则可能撞上 260 字符路径限制。

## 贡献指南

1. Fork 本仓库
2. 新建分支：`git checkout -b feature/your-feature`
3. 提交改动：`git commit -m "feat: your feature"`
4. 推送分支：`git push origin feature/your-feature`
5. 发起 Pull Request

## 许可证

本项目**未授予开源许可证**，保留所有权利（All Rights Reserved）。

未经作者书面许可，不得使用、复制、修改或分发本项目的任何部分。

---

**别名**：知夏生活（HZX）
