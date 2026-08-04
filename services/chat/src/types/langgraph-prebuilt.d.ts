/**
 * Nest 服务仍使用 CommonJS + Node moduleResolution；LangGraph 的 package
 * exports 子路径在该解析模式下无法自动读取类型。运行时仍由 Bun 解析
 * @langchain/langgraph/prebuilt，这里只补充 TypeScript 的类型转发声明。
 */
declare module "@langchain/langgraph/prebuilt" {
  export { ToolNode } from "@langchain/langgraph/dist/prebuilt";
}
