import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  MAX_SCOPE_DOCUMENTS,
  parseScope,
} from "../src/document/search.service";

describe("retrieval scope parsing", () => {
  it("treats missing scope as undefined so callers keep the default behavior", () => {
    expect(parseScope(undefined)).toBeUndefined();
    expect(parseScope(null)).toBeUndefined();
  });

  it("accepts the three supported modes", () => {
    expect(parseScope({ mode: "all" })).toEqual({ mode: "all" });
    expect(parseScope({ mode: "category", value: "hr" })).toEqual({
      mode: "category",
      value: "hr",
    });
    expect(parseScope({ mode: "documents", ids: ["d1", " d2 "] })).toEqual({
      mode: "documents",
      ids: ["d1", "d2"],
    });
  });

  it("drops empty document ids instead of failing the whole request", () => {
    expect(parseScope({ mode: "documents", ids: ["", "  ", "d1"] })).toEqual({
      mode: "documents",
      ids: ["d1"],
    });
    expect(parseScope({ mode: "documents", ids: [] })).toEqual({
      mode: "documents",
      ids: [],
    });
  });

  it("rejects malformed scope with 400 rather than letting SQL construction throw", () => {
    const invalid: unknown[] = [
      "all",
      42,
      [],
      {},
      { mode: "unknown" },
      { mode: "category" },
      { mode: "category", value: "  " },
      { mode: "documents" },
      { mode: "documents", ids: "d1" },
      { mode: "documents", ids: Array.from({ length: MAX_SCOPE_DOCUMENTS + 1 }, (_, index) => `d${index}`) },
    ];

    for (const value of invalid) {
      expect(() => parseScope(value)).toThrow(BadRequestException);
    }
  });
});
