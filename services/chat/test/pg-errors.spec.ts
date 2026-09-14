import { describe, expect, it } from "vitest";
import {
  isUniqueViolation,
  pgErrorCode,
  UNIQUE_VIOLATION,
} from "../src/database/pg-errors";

/**
 * drizzle 会把驱动错误包进 DrizzleQueryError，原始 pg 错误挂在 `cause` 上。
 * 这里用真实的错误形状锁定解包逻辑：生产上的唯一约束分支全靠它才会命中。
 */
describe("pgErrorCode", () => {
  it("读取顶层错误码", () => {
    expect(pgErrorCode({ code: UNIQUE_VIOLATION })).toBe(UNIQUE_VIOLATION);
  });

  it("沿 cause 链向下解包 drizzle 包装后的错误", () => {
    const wrapped = new Error("Failed query: insert into users ...", {
      cause: Object.assign(new Error("duplicate key value"), {
        code: UNIQUE_VIOLATION,
      }),
    });

    expect((wrapped as { code?: unknown }).code).toBeUndefined();
    expect(pgErrorCode(wrapped)).toBe(UNIQUE_VIOLATION);
    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("多层嵌套也能拿到错误码", () => {
    const deep = { cause: { cause: { code: "23503" } } };
    expect(pgErrorCode(deep)).toBe("23503");
  });

  it("非唯一约束、无错误码与自引用都不会误判", () => {
    expect(pgErrorCode({ code: "23503" })).toBe("23503");
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
    expect(isUniqueViolation(new Error("boom"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);

    const selfReferencing: { cause?: unknown; code?: unknown } = {};
    selfReferencing.cause = selfReferencing;
    expect(pgErrorCode(selfReferencing)).toBeUndefined();
  });
});
