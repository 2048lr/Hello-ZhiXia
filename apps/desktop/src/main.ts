/**
 * @hzx/app-desktop —— Electron 桌面应用（Windows / Linux）。
 *
 * **目前是空骨架，尚未实现。**
 *
 * 选型理由（ADR-0003 / 推荐栈）：pi 是 Node.js + TypeScript 实现，
 * 放在 Electron 主进程里可以直接 `import`，省掉 sidecar 进程与 RPC 桥接。
 * 代价是约 150MB 的包体。
 *
 * 另一条可行路径是 Tauri + Node sidecar（走 pi 的 RPC 模式），包体更小，
 * 但要自己打包并管理 Node 运行时。若包体成为问题，可重新评估。
 */
export {};
