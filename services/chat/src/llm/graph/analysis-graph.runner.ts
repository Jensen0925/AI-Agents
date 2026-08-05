/**
 * LangGraph 运行入口的窄适配层。
 *
 * 业务服务通过本文件调用分析图，测试可以只替换这个运行器，而不会把
 * requirement-analysis-graph 的完整导出集合替换掉，避免 Bun 测试之间的
 * mock.module 全局污染。
 */
export { runAnalysisGraph } from "./requirement-analysis-graph";
