// 在导入应用模块之前加载项目根目录的 .env。
// tsx 不会自动加载 .env（drizzle-kit 会），而本服务以 Nest 启动，且
// 配置校验（OPENAI_API_KEY 等）需要在进程早期就拿到变量，因此必须在本文件
// 作为 main.ts 的第一个 import 时就把变量注入 process.env。
// 使用 Node 22 内置 API，无需额外依赖；不会覆盖已存在的真实环境变量。
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // 缺少 .env 时忽略，交由各配置校验给出明确报错
  }
}
