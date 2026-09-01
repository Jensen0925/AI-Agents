export type DocumentPreviewKind = "pdf" | "text" | "unsupported"

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
])

export function getDocumentPreviewKind(
  mimeType?: string,
  filename?: string,
): DocumentPreviewKind {
  const normalizedMimeType = mimeType?.toLowerCase().split(";")[0].trim() ?? ""
  const normalizedFilename = filename?.toLowerCase() ?? ""

  if (
    normalizedMimeType === "application/pdf" ||
    normalizedFilename.endsWith(".pdf")
  ) {
    return "pdf"
  }

  if (
    TEXT_MIME_TYPES.has(normalizedMimeType) ||
    /\.(md|markdown|txt)$/.test(normalizedFilename)
  ) {
    return "text"
  }

  return "unsupported"
}

/** 预览里还原服务端分块视角时使用的目标长度。 */
export const DEFAULT_CHUNK_SIZE = 600

/**
 * 按段落（空行）边界把原文切分为近似等长的片段。
 *
 * 服务端并未把分块结果单独暴露成接口，这里是客户端的近似还原，仅用于人工核对
 * 切片效果，不能保证与建库时的真实分块逐字一致。优先在空行处断开，其次按单行，
 * 最后才硬切，尽量保持片段的语义完整。
 */
export function splitIntoChunks(
  content: string,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): string[] {
  const size = Math.max(1, Math.floor(chunkSize))
  const normalized = content.replace(/\r\n/g, "\n").trim()
  if (!normalized) return []

  const blocks = normalized
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let current = ""

  function flush() {
    if (current.trim()) chunks.push(current.trim())
    current = ""
  }

  for (const block of blocks) {
    if (current && current.length + block.length + 2 > size) flush()

    if (block.length > size) {
      flush()
      for (const line of block.split("\n")) {
        if (line.length > size) {
          // 单行本身就超长（例如无换行的长表格），只能按长度硬切。
          flush()
          for (let index = 0; index < line.length; index += size) {
            chunks.push(line.slice(index, index + size).trim())
          }
        } else if (current && current.length + line.length + 1 > size) {
          flush()
          current = line
        } else {
          current = current ? `${current}\n${line}` : line
        }
      }
      continue
    }

    current = current ? `${current}\n\n${block}` : block
  }

  flush()
  return chunks.filter(Boolean)
}
