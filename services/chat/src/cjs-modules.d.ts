// 为缺少类型声明的 CommonJS 依赖提供最小 ambient 声明，
// 避免在 esModuleInterop 严格模式下对动态 import() 报 TS7016。
declare module "word-extractor";
declare module "pdf-parse";
