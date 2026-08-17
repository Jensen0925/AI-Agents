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
