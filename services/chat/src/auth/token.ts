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

function secret(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
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
