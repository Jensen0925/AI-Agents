import { describe, expect, it } from "bun:test"
import { getDocumentPreviewKind } from "./document-preview"

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
