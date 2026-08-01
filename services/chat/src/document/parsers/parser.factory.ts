import { UnsupportedMediaTypeException } from "@nestjs/common";
import { extractDocxText, extractLegacyDocText } from "./docx.parser";
import { extractPdfText } from "./pdf.parser";
import { extractTextFile } from "./text.parser";

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
]);

const DOCX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** 根据数据库记录的 MIME 类型选择解析器，调用方无需感知文件格式。 */
export function extractText(
  filePath: string,
  mimeType: string,
): Promise<string> {
  const normalizedMimeType = mimeType.split(";", 1)[0]?.trim().toLowerCase();

  if (normalizedMimeType && TEXT_MIME_TYPES.has(normalizedMimeType)) {
    return extractTextFile(filePath);
  }
  if (normalizedMimeType === "application/pdf") {
    return extractPdfText(filePath);
  }
  if (normalizedMimeType === DOCX_MIME_TYPE) {
    return extractDocxText(filePath);
  }
  if (normalizedMimeType === "application/msword") {
    return extractLegacyDocText(filePath);
  }

  throw new UnsupportedMediaTypeException(
    `Unsupported document MIME type: ${mimeType}`,
  );
}
