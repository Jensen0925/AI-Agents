import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 脚本自身所在目录。
 *
 * `services/chat` 的 package.json 声明了 `"type": "module"`，脚本由 tsx 以 ESM
 * 执行，因此 Node 不注入 `__dirname`/`__filename`。历史脚本全部写了
 * `resolve(__dirname, "..")`，结果是启动即抛
 * `ReferenceError: __dirname is not defined in ES module scope`——
 * `pnpm eval`、评测与演示脚本一个都跑不起来。统一从这里取路径。
 */
export const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

/** 后端包根目录：`services/chat`。 */
export const CHAT_ROOT = resolve(SCRIPT_DIR, "..");
