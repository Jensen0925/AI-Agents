/**
 * Nest 服务构建产物为 CommonJS，使用 node10 解析（`tsconfig.build.json` 的
 * `moduleResolution: "Node"`）读不到 LangGraph package `exports` 里的
 * `./prebuilt` 子路径。运行时由 Node.js 正常解析该子路径，这里只补充
 * TypeScript 的类型转发声明。
 *
 * 注意：转发的成员必须与实际用到的具名导出保持同步，否则会被本声明遮蔽而报
 * TS2305。转发源用 `dist/prebuilt` 这个物理路径，node10 与 bundler 两种解析
 * 模式下都能命中。
 */
declare module "@langchain/langgraph/prebuilt" {
  export { ToolNode, createReactAgent } from "@langchain/langgraph/dist/prebuilt";
}
