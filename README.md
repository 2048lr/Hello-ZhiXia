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
├── README.md       # 项目说明
├── .gitignore      # 版本控制忽略规则
└── .gitattributes  # 换行符与文本/二进制处理规则
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

> ⚠️ 项目处于**架构设计阶段**，尚无可用代码。

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
