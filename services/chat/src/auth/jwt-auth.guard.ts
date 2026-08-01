import { createHmac, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

interface JwtHeader {
  alg?: string;
  typ?: string;
}

interface JwtPayload {
  sub?: string;
  userId?: string;
  exp?: number;
  nbf?: number;
}

export interface AuthenticatedUser {
  userId: string;
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string | string[];
  };
  user?: AuthenticatedUser;
}

function parseJsonPart<T>(part: string): T {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
  } catch {
    throw new UnauthorizedException("Invalid JWT payload");
  }
}

function verifyToken(token: string, secret: string): JwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new UnauthorizedException("Invalid bearer token");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonPart<JwtHeader>(encodedHeader);
  if (header.alg !== "HS256") {
    throw new UnauthorizedException("Unsupported JWT algorithm");
  }

  const expected = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actual = Buffer.from(encodedSignature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new UnauthorizedException("Invalid bearer token signature");
  }

  return parseJsonPart<JwtPayload>(encodedPayload);
}
/**
 *测试token生成命令：
TOKEN=$(bun -e '
import { createHmac } from "node:crypto";

const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET is missing");

const encode = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const now = Math.floor(Date.now() / 1000);
const header = encode({ alg: "HS256", typ: "JWT" });
const payload = encode({
  sub: "test-user-001",
  iat: now,
  exp: now + 3600
});
const signature = createHmac("sha256", secret)
  .update(`${header}.${payload}`)
  .digest("base64url");

console.log(`${header}.${payload}.${signature}`);
')

echo "$TOKEN"
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const header = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      throw new UnauthorizedException("Bearer token is required");
    }

    const secret = process.env["JWT_SECRET"];
    if (!secret) {
      throw new UnauthorizedException("JWT_SECRET is not configured");
    }

    const payload = verifyToken(token, secret);
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp === "number" && payload.exp <= now) {
      throw new UnauthorizedException("Bearer token has expired");
    }
    if (typeof payload.nbf === "number" && payload.nbf > now) {
      throw new UnauthorizedException("Bearer token is not active yet");
    }

    const userId = payload.sub ?? payload.userId;
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new UnauthorizedException("JWT subject is required");
    }

    request.user = { userId: userId.trim() };
    return true;
  }
}
