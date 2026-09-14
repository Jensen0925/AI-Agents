import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface AccessTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  iat: number;
  exp: number;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * 密钥最小长度。
 *
 * HS256 的密钥一旦过短就可能被离线爆破，攻击者随后能伪造任意用户的
 * access token（包括 super_admin）。32 字符与 256 bit 对称密钥强度相当。
 */
const MIN_SECRET_LENGTH = 32;

/**
 * 已知的占位/弱值。命中即拒绝启动——「配置了但等于没配」比没配置更危险，
 * 因为它不会触发任何告警。
 */
const PLACEHOLDER_SECRETS = new Set([
  "secret",
  "jwt_secret",
  "jwtsecret",
  "change-me",
  "changeme",
  "replace-with-a-long-local-secret",
  "cloudsage-local-access-secret-change-me",
  "your-secret-key",
  "password",
]);

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);

  const normalized = value.trim();
  if (normalized.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} must be at least ${MIN_SECRET_LENGTH} characters (got ${normalized.length})`,
    );
  }
  if (PLACEHOLDER_SECRETS.has(normalized.toLowerCase())) {
    throw new Error(
      `${name} is a well-known placeholder value; generate a random secret instead`,
    );
  }
  return value;
}

/**
 * 启动时校验密钥配置。
 *
 * 让「密钥缺失/过短/是占位值」在进程启动阶段就暴露，而不是等到用户第一次
 * 登录时才变成一个语义不明的 500。
 */
export function assertAuthSecretsConfigured(): void {
  secret("JWT_SECRET");
}

export function signAccessToken(input: {
  userId: string;
  email: string;
  name: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = Number(process.env["JWT_EXPIRES_IN_SECONDS"] ?? 900);
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: input.userId,
    email: input.email,
    name: input.name,
    iat: now,
    exp: now + (Number.isFinite(expiresIn) ? expiresIn : 900),
  });
  const body = `${header}.${payload}`;
  const signature = createHmac("sha256", secret("JWT_SECRET"))
    .update(body)
    .digest("base64url");
  return `${body}.${signature}`;
}

export function verifyAccessToken(
  token: string,
  jwtSecret = secret("JWT_SECRET"),
): AccessTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid bearer token");
  const [headerPart, payloadPart, signaturePart] = parts;
  const header = JSON.parse(
    Buffer.from(headerPart, "base64url").toString("utf8"),
  ) as { alg?: string };
  if (header.alg !== "HS256") throw new Error("Unsupported JWT algorithm");
  const expected = createHmac("sha256", jwtSecret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  const actual = Buffer.from(signaturePart, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("Invalid bearer token signature");
  }
  const payload = JSON.parse(
    Buffer.from(payloadPart, "base64url").toString("utf8"),
  ) as AccessTokenPayload;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new Error("Bearer token has expired");
  }
  return payload;
}

export function createRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenTtlMs(): number {
  const days = Number(process.env["REFRESH_TOKEN_DAYS"] ?? 30);
  return (Number.isFinite(days) ? days : 30) * 24 * 60 * 60 * 1000;
}
