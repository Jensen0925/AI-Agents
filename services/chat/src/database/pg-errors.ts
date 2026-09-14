/** PostgreSQL 唯一约束冲突。 */
export const UNIQUE_VIOLATION = "23505";

/**
 * 从错误链里读取 PostgreSQL 错误码。
 *
 * drizzle 会把驱动抛出的错误包进 `DrizzleQueryError` 再抛出来，原始 pg 错误
 * （`code` / `detail` / `constraint` 都在它上面）挂在 `cause` 上。因此只检查顶层
 * `error.code` 永远匹配不到 23505：唯一约束冲突会绕过业务分支，直接变成 500
 * 并把数据库原始报错回传给客户端。
 *
 * 这里沿 `cause` 链向下找第一个字符串错误码，最多下探 5 层以防御异常的自引用。
 */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current === null || typeof current !== "object") return undefined;
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/** 判断错误是否为唯一约束冲突（含 drizzle 包装后的形态）。 */
export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === UNIQUE_VIOLATION;
}
