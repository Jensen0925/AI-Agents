import { randomBytes } from "node:crypto";

/** 密码最小长度：与 OWASP 对「无 MFA 的单一因素口令」的建议下限对齐。 */
export const MIN_PASSWORD_LENGTH = 12;

/** 密码最大长度：防止超长输入让 argon2 占用过多 CPU（DoS 面）。 */
export const MAX_PASSWORD_LENGTH = 200;

/**
 * 常见弱口令。这里只拦截「最容易被撞库命中」的一小撮，不做复杂度强制——
 * 复杂度规则会诱导用户写出 `Passw0rd!` 这类可预测口令，长度才是更有效的约束。
 */
const WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "passw0rd",
  "123456",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty",
  "qwerty123",
  "admin",
  "admin123",
  "administrator",
  "letmein",
  "welcome",
  "iloveyou",
  "changeme",
  "change-me",
  "cloudsage",
  "cloudsage@123",
  "secret",
  "test1234",
]);

export interface PasswordPolicyResult {
  ok: boolean;
  reason?: string;
}

/**
 * 校验口令强度。
 *
 * 调用方（users.service / seed）负责把 `reason` 转成 400 响应或直接抛错。
 * 单独抽出来是为了让 seed 与应用走同一套规则，避免两处判断漂移。
 */
export function checkPasswordPolicy(password: string): PasswordPolicyResult {
  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, reason: "password must be a non-empty string" };
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      reason: `password must not exceed ${MAX_PASSWORD_LENGTH} characters`,
    };
  }
  if (WEAK_PASSWORDS.has(password.trim().toLowerCase())) {
    return { ok: false, reason: "password is too common" };
  }
  return { ok: true };
}

/**
 * 生成随机初始口令。
 *
 * 用 base64url 而不是「大小写数字符号各取一位」：后者的组合空间其实更小，
 * 且随机性依赖实现质量。24 字节 ≈ 192 bit，足够强。
 */
export function createRandomPassword(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}
