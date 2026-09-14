import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * chat-web 的测试配置。
 *
 * 显式对齐 tsconfig 的 `@/* -> ./*` 映射，让测试与构建解析同一套路径别名。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  esbuild: {
    // 组件测试通过 renderToStaticMarkup 在 node 环境渲染，无需 jsdom。
    jsx: "automatic",
  },
  test: {
    environment: "node",
  },
});
