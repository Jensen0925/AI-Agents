/**
 * services/chat 的 package.json 声明为 "type": "module"，但 tsconfig.build.json
 * 为了让 Nest 的 CommonJS 产物正常运行输出的是 CommonJS。若 dist/ 下没有自己的
 * package.json 声明 type=commonjs，Node 会按 ESM 解析产物并直接抛错。
 *
 * dist 目录可能被清理，因此 build 与 dev 前都要保证这个标记文件存在。
 */
import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
writeFileSync("dist/package.json", '{"type":"commonjs"}\n');
