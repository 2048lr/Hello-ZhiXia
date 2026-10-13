import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/** 把仓库内的相对路径解析成绝对路径。 */
function src(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

/**
 * 测试直接跑源码，不要求先执行 build。
 * 因此把**每一个** workspace 包名映射回各自的 src。
 *
 * 注意顺序：`@hzx/core-sync/sim` 必须排在 `@hzx/core-sync` 之前。
 * 别名按前缀匹配，若父包名在前，`@hzx/core-sync/sim` 会被它先截走，
 * 子路径导出就永远解析不到。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@hzx/core-sync/sim": src("./packages/core-sync/src/sim/index.ts"),
      "@hzx/core-sync": src("./packages/core-sync/src/index.ts"),
      "@hzx/core-agent": src("./packages/core-agent/src/index.ts"),
      "@hzx/core-mesh": src("./packages/core-mesh/src/index.ts"),
      "@hzx/platform-adapters": src("./packages/platform-adapters/src/index.ts"),
      "@hzx/ui-shared": src("./packages/ui-shared/src/index.ts"),
    },
  },
  test: {
    // 三个 workspace 目录都要扫。只写 packages/* 会让 services/ 与 apps/
    // 下的测试永远不会被执行 —— 它们既不报错、也不出现在结果里，
    // 静默地不跑比跑失败更危险。
    include: [
      "packages/*/src/**/*.test.ts",
      "services/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
    ],
    environment: "node",
  },
});
