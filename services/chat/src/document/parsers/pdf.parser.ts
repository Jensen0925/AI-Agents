import { readFile } from "node:fs/promises";

interface PdfParseResult {
  text: string;
}

type PdfParser = (input: Buffer) => Promise<PdfParseResult>;

const pdfParse = require("pdf-parse") as PdfParser;

/** 提取 PDF 中可选择的文本；扫描图片型 PDF 需要另行接入 OCR。 */
export async function extractPdfText(filePath: string): Promise<string> {
  const result = await pdfParse(await readFile(filePath));
  return result.text;
}
