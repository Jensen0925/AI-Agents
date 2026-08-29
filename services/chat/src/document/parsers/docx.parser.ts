import mammoth from "mammoth";

interface ExtractedWordDocument {
  getBody(): string;
}

interface WordExtractorInstance {
  extract(input: string): Promise<ExtractedWordDocument>;
}

type WordExtractorConstructor = new () => WordExtractorInstance;

/** 使用 Mammoth 提取 DOCX 正文，不保留 Word 排版信息。 */
export async function extractDocxText(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

/** 保留既有 application/msword 上传类型对旧版 DOC 文件的兼容。 */
export async function extractLegacyDocText(filePath: string): Promise<string> {
  const module = await import("word-extractor");
  const WordExtractor = (module.default ?? module) as WordExtractorConstructor;
  const extractor = new WordExtractor();
  return (await extractor.extract(filePath)).getBody();
}
