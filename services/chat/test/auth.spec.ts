import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpException } from "@nestjs/common";
import { AuthService } from "../src/auth/auth.service";
import { LoginThrottle } from "../src/auth/login-throttle";
import { hashPassword } from "../src/auth/password";
import {
  checkPasswordPolicy,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from "../src/auth/password-policy";
import {
  assertAuthSecretsConfigured,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "../src/auth/token";
import { createDatabaseMock } from "./drizzle-test-utils";

const STRONG_SECRET = "unit-test-secret-with-at-least-32-characters";

afterEach(() => {
  delete process.env["JWT_SECRET"];
});

describe("JWT secret 强度校验", () => {
  it("拒绝缺失、过短与占位值", () => {
    expect(() => assertAuthSecretsConfigured()).toThrow(/not configured/);

    process.env["JWT_SECRET"] = "too-short";
    expect(() => assertAuthSecretsConfigured()).toThrow(/at least 32 characters/);

    // 占位值即使足够长也必须拒绝：「配置了但等于没配」不会触发任何告警。
    process.env["JWT_SECRET"] = "cloudsage-local-access-secret-change-me";
    expect(() => assertAuthSecretsConfigured()).toThrow(/placeholder/);
  });

  it("接受足够长的随机密钥", () => {
    process.env["JWT_SECRET"] = STRONG_SECRET;
    expect(() => assertAuthSecretsConfigured()).not.toThrow();
  });

  it("签名可被校验，且篡改载荷后验签失败", () => {
    process.env["JWT_SECRET"] = STRONG_SECRET;
    const token = signAccessToken({
      userId: "user-1",
      email: "user@example.com",
      name: "User",
    });

    expect(verifyAccessToken(token).sub).toBe("user-1");

    const [header, payload, signature] = token.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ sub: "attacker", iat: 0, exp: 4_102_444_800 }),
    ).toString("base64url");
    expect(() =>
      verifyAccessToken(`${header}.${tampered}.${signature}`),
    ).toThrow(/signature/);
  });

  it("拒绝非 HS256 的算法声明（防算法混淆）", () => {
    process.env["JWT_SECRET"] = STRONG_SECRET;
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: "attacker", iat: 0, exp: 4_102_444_800 }),
    ).toString("base64url");

    expect(() => verifyAccessToken(`${header}.${payload}.`)).toThrow(
      /Unsupported JWT algorithm/,
    );
  });
});

describe("密码策略", () => {
  it("按长度与常见弱口令拒绝", () => {
    expect(checkPasswordPolicy("").ok).toBe(false);
    expect(checkPasswordPolicy("a".repeat(MIN_PASSWORD_LENGTH - 1)).ok).toBe(false);
    expect(checkPasswordPolicy("Cloudsage@123").ok).toBe(false);
    expect(checkPasswordPolicy("A".repeat(MAX_PASSWORD_LENGTH + 1)).ok).toBe(false);
  });

  it("接受足够长的口令", () => {
    expect(checkPasswordPolicy("correct-horse-battery-staple").ok).toBe(true);
  });
});

describe("LoginThrottle", () => {
  it("达到上限后锁定，并在锁定窗口结束后恢复", () => {
    let now = 0;
    const throttle = new LoginThrottle(
      { maxAttempts: 3, windowMs: 1_000, lockoutMs: 5_000 },
      () => now,
    );
    const keys = ["email:a@b.c"];

    expect(throttle.retryAfterMs(keys)).toBe(0);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      throttle.recordFailure(keys);
    }
    expect(throttle.retryAfterMs(keys)).toBe(5_000);

    now += 4_999;
    expect(throttle.retryAfterMs(keys)).toBeGreaterThan(0);

    now += 1;
    expect(throttle.retryAfterMs(keys)).toBe(0);
  });

  it("登录成功会清空该 key 的历史失败计数", () => {
    const throttle = new LoginThrottle({ maxAttempts: 2 }, () => 0);
    const keys = ["email:a@b.c"];
    throttle.recordFailure(keys);
    throttle.clear(keys);
    throttle.recordFailure(keys);

    expect(throttle.retryAfterMs(keys)).toBe(0);
  });

  it("不同 key 之间互不影响", () => {
    const throttle = new LoginThrottle({ maxAttempts: 1 }, () => 0);
    throttle.recordFailure(["ip:1.2.3.4"]);

    expect(throttle.retryAfterMs(["ip:1.2.3.4"])).toBeGreaterThan(0);
    expect(throttle.retryAfterMs(["ip:5.6.7.8"])).toBe(0);
  });
});

describe("AuthService", () => {
  // issueTokens 会真实签名，需要合法的密钥；afterEach 会在每个用例后清掉。
  beforeEach(() => {
    process.env["JWT_SECRET"] = STRONG_SECRET;
  });

  const accessRows = [
    { roleCode: "super_admin", permissionCode: "users:read" },
  ];

  function buildService(options: {
    select?: unknown[];
    returning?: unknown[];
    throttle?: LoginThrottle;
  } = {}) {
    const database = createDatabaseMock({
      select: options.select ?? [],
      returning: options.returning ?? [],
    });
    const service = new AuthService(
      database,
      options.throttle ?? new LoginThrottle({ maxAttempts: 100 }),
    );
    return { database, service };
  }

  function userRow(passwordHash: string) {
    return {
      id: "user-1",
      email: "user@example.com",
      name: "User",
      passwordHash,
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  it("用户不存在时也走等价哈希校验，并返回与密码错误相同的文案", async () => {
    const { service } = buildService({ select: [[]] });

    await expect(
      service.login("ghost@example.com", "whatever-password"),
    ).rejects.toThrow("邮箱或密码错误");
    await expect(
      service.login("ghost@example.com", "whatever-password"),
    ).rejects.not.toThrow(/不存在/);
  });

  it("密码错误时统一报错，账号被停用同样不暴露状态", async () => {
    const passwordHash = await hashPassword("correct-password-long-enough");
    const { service } = buildService({
      select: [[userRow(passwordHash)], []],
    });

    await expect(
      service.login("user@example.com", "wrong-password-long-enough"),
    ).rejects.toThrow("邮箱或密码错误");
  });

  it("失败次数超限后返回 429 而不是继续校验密码", async () => {
    const throttle = new LoginThrottle({ maxAttempts: 1, lockoutMs: 60_000 });
    const { service } = buildService({ select: [[]], throttle });

    await expect(
      service.login("ghost@example.com", "whatever-password"),
    ).rejects.toThrow("邮箱或密码错误");

    const error = await service
      .login("ghost@example.com", "whatever-password")
      .catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
  });

  it("refresh 原子轮换：条件 UPDATE 命中时直接签发新令牌", async () => {
    const { service } = buildService({
      // 第一次 update(...).returning() 命中未撤销的 token
      returning: [[{ userId: "user-1" }]],
      select: [[userRow("hash")], accessRows],
    });

    const result = await service.refresh("a-refresh-token");

    expect(result.user.id).toBe("user-1");
    expect(result.refreshToken).toBeTruthy();
  });

  it("检测到已撤销令牌被复用会撤销该用户全部会话", async () => {
    const { database, service } = buildService({
      // 轮换失败（返回 0 行），随后 select 查到这个 token 存在且已撤销
      returning: [[], []],
      select: [[{ id: "rt-1", userId: "user-1" }]],
    });

    await expect(service.refresh("stolen-refresh-token")).rejects.toThrow(
      "刷新令牌无效或已过期",
    );

    // 一次是失败的轮换，一次是 revokeAllForUser。
    expect(database.db.update).toHaveBeenCalledTimes(2);
  });

  it("对完全未知的 refresh token 只报错，不做无意义的批量撤销", async () => {
    const { database, service } = buildService({
      returning: [[]],
      select: [[]],
    });

    await expect(service.refresh("unknown-token")).rejects.toThrow(
      "刷新令牌无效或已过期",
    );
    expect(database.db.update).toHaveBeenCalledTimes(1);
  });

  it("logout 只撤销匹配的 token（按 hash 精确匹配）", async () => {
    const { service } = buildService({ returning: [[]] });
    await expect(service.logout("some-token")).resolves.toBeUndefined();
    expect(hashRefreshToken("some-token")).toHaveLength(64);
  });
});
