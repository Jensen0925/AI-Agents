import { describe, expect, it } from "vitest"
import { getDocumentPreviewKind, splitIntoChunks } from "./document-preview"

describe("document preview", () => {
  it("recognizes PDF files by MIME type or extension", () => {
    expect(getDocumentPreviewKind("application/pdf", "requirement.bin")).toBe("pdf")
    expect(getDocumentPreviewKind(undefined, "requirement.PDF")).toBe("pdf")
  })

  it("recognizes Markdown and plain text files", () => {
    expect(getDocumentPreviewKind("text/markdown", "requirement")).toBe("text")
    expect(getDocumentPreviewKind("text/plain; charset=utf-8", "notes")).toBe("text")
    expect(getDocumentPreviewKind(undefined, "README.md")).toBe("text")
    expect(getDocumentPreviewKind(undefined, "notes.txt")).toBe("text")
  })

  it("marks Word files as unsupported browser previews", () => {
    expect(
      getDocumentPreviewKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "requirement.docx",
      ),
    ).toBe("unsupported")
  })
})

describe("splitIntoChunks", () => {
  it("returns no chunks for blank content", () => {
    expect(splitIntoChunks("")).toEqual([])
    expect(splitIntoChunks("   \n\n  ")).toEqual([])
  })

  it("keeps short paragraphs together in a single chunk", () => {
    const chunks = splitIntoChunks("第一段。\n\n第二段。", 600)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain("第一段")
    expect(chunks[0]).toContain("第二段")
  })

  it("breaks on paragraph boundaries once the target size is exceeded", () => {
    const paragraph = "啊".repeat(300)
    const chunks = splitIntoChunks(`${paragraph}\n\n${paragraph}`, 400)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toBe(paragraph)
    expect(chunks[1]).toBe(paragraph)
  })

  it("hard-splits a single line that is longer than the target size", () => {
    const chunks = splitIntoChunks("字".repeat(1000), 400)
    expect(chunks).toHaveLength(3)
    expect(chunks.every((chunk) => chunk.length <= 400)).toBe(true)
  })

  it("normalizes CRLF line endings", () => {
    expect(splitIntoChunks("甲\r\n\r\n乙", 600)[0]).toBe("甲\n\n乙")
  })
})
