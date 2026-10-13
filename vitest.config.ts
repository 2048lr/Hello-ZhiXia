import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * 测试直接跑源码，不要求先执行 build。
 * 因此把 workspace 包名映射回各自的 src。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@hzx/core-sync": fileURLToPath(new URL("./packages/core-sync/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    environment: "node",
  },
});
