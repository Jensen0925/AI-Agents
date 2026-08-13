import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

/**
 * 文档块在原始文本中的位置。
 * `text.substring(startOffset, endOffset)` 始终可以还原 `content`。
 */
export interface Chunk {
  index: number;
  content: string;
  startOffset: number;
  endOffset: number;
}

export interface ChunkTextOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export const DEFAULT_CHUNK_SIZE = 500;
export const DEFAULT_CHUNK_OVERLAP = 50;

/**
 * 面向中文文档的递归优先级：先段落、再换行、再全角标点，最后才退化到字符级。
 */
export const DEFAULT_SEPARATORS = [
  "\n\n",
  "\n",
  "。",
  "！",
  "？",
  "；",
  "，",
  " ",
  "",
];

function assertChunkOptions(chunkSize: number, chunkOverlap: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new RangeError("chunkSize 必须是大于 0 的整数");
  }

  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
    throw new RangeError("chunkOverlap 必须是大于等于 0 的整数");
  }

  if (chunkOverlap >= chunkSize) {
    throw new RangeError("chunkOverlap 必须小于 chunkSize");
  }
}

/**
 * 使用 LangChain 的递归字符切分器切分文档，并补充可回溯到原始文本的字符偏移。
 *
 * splitText 只返回文本片段，不携带 offset。由于相邻 chunk 可能有重叠，定位后续
 * chunk 时从“上一个 chunk 结尾减去 overlap”的窗口开始搜索，避免重复文本场景中
 * 错误地定位到更早的一处内容。
 */
export async function chunkText(
  text: string,
  options: ChunkTextOptions = {},
): Promise<Chunk[]> {
  if (!text) {
    return [];
  }

  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const separators = options.separators ?? DEFAULT_SEPARATORS;
  assertChunkOptions(chunkSize, chunkOverlap);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators,
    keepSeparator: true,
  });
  const contents = await splitter.splitText(text);
  const chunks: Chunk[] = [];
  let previousEndOffset = 0;

  for (const [index, content] of contents.entries()) {
    const searchStart = Math.max(0, previousEndOffset - chunkOverlap);
    let startOffset = text.indexOf(content, searchStart);

    // 极少数由分隔符 trim 造成的场景下，退回到全局定位；仍保持 content 可还原。
    if (startOffset === -1) {
      startOffset = text.indexOf(content);
    }

    if (startOffset === -1) {
      throw new Error("无法将切分结果定位回原始文本");
    }

    const endOffset = startOffset + content.length;
    chunks.push({ index, content, startOffset, endOffset });
    previousEndOffset = endOffset;
  }

  return chunks;
}
