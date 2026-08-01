import { readFile } from "node:fs/promises";

/** 读取 UTF-8 编码的 TXT 或 Markdown 文件，并移除可能存在的 BOM。 */
export async function extractTextFile(filePath: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  return content.replace(/^\uFEFF/, "");
}
