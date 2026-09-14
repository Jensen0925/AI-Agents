import {
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  permissions,
  refreshTokens,
  rolePermissions,
  roles,
  userRoles,
  users,
  UserStatus,
} from "../database/schema";
import {
  createRefreshToken,
  hashRefreshToken,
  refreshTokenTtlMs,
  signAccessToken,
} from "./token";
import { verifyPassword } from "./password";
import { LoginThrottle } from "./login-throttle";

/**
 * 时序抹平用的占位哈希（argon2id，参数与 hashPassword 默认值一致）。
 *
 * 用户不存在时也要跑一次等价的哈希校验，否则「用户不存在」会明显快于
 * 「密码错误」，攻击者可据此枚举有效邮箱。
 */
const TIMING_EQUALIZER_HASH =
  "$argon2id$v=19$m=65536,t=3,p=4$E/2CTxXh/jSAtRjWXl+Rlw$7AhTAgdDPJ95zJ7MgDkM04mAywbvis7IIR55ZapyEvo";

/** 节流键前缀：邮箱维度防定向撞库，IP 维度防「换邮箱遍历」的分布式尝试。 */
const EMAIL_KEY_PREFIX = "email:";
const IP_KEY_PREFIX = "ip:";

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string;
    roles: string[];
    permissions: string[];
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly loginThrottle: LoginThrottle,
  ) {}

  private async findUserWithAccess(userId: string) {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) return null;

    const access = await this.database.db
      .select({ roleCode: roles.code, permissionCode: permissions.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));
    return {
      user,
      roles: [...new Set(access.map((item) => item.roleCode))],
      permissions: [...new Set(access.flatMap((item) => item.permissionCode ? [item.permissionCode] : []))],
    };
  }

  private async issueTokens(userId: string): Promise<AuthResponse> {
    const access = await this.findUserWithAccess(userId);
    if (!access || access.user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User is not active");
    }
    const refreshToken = createRefreshToken();
    await this.database.db.insert(refreshTokens).values({
      id: crypto.randomUUID(),
      userId: access.user.id,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshTokenTtlMs()),
    });
    const accessToken = signAccessToken({
      userId: access.user.id,
      email: access.user.email,
      name: access.user.name,
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: Number(process.env["JWT_EXPIRES_IN_SECONDS"] ?? 900),
      user: {
        id: access.user.id,
        email: access.user.email,
        name: access.user.name,
        roles: access.roles,
        permissions: access.permissions,
      },
    };
  }

  /**
   * 登录。
   *
   * `clientIp` 可选：传入后会与邮箱一起作为节流维度。所有失败路径都返回同一条
   * 文案，并且都执行一次等价的 argon2 校验，避免通过响应差异枚举有效邮箱。
   */
  async login(
    email: string,
    password: string,
    clientIp?: string,
  ): Promise<AuthResponse> {
    const throttleKeys = this.throttleKeys(email, clientIp);
    const retryAfterMs = this.loginThrottle.retryAfterMs(throttleKeys);
    if (retryAfterMs > 0) {
      // Nest 未内置 429 异常类，直接指定状态码。
      throw new HttpException(
        `登录尝试过于频繁，请 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || user.status !== UserStatus.ACTIVE) {
      // 用户不存在/已停用时也跑一次哈希校验再统一报错：
      // 既抹平耗时，也保证两条路径的行为一致。
      await verifyPassword(password, TIMING_EQUALIZER_HASH);
      this.loginThrottle.recordFailure(throttleKeys);
      throw new UnauthorizedException("邮箱或密码错误");
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      this.loginThrottle.recordFailure(throttleKeys);
      throw new UnauthorizedException("邮箱或密码错误");
    }

    this.loginThrottle.clear(throttleKeys);
    await this.database.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return this.issueTokens(user.id);
  }

  private throttleKeys(email: string, clientIp?: string): string[] {
    const keys = [`${EMAIL_KEY_PREFIX}${email}`];
    if (clientIp) keys.push(`${IP_KEY_PREFIX}${clientIp}`);
    return keys;
  }

  /**
   * 轮换 refresh token。
   *
   * 撤销旧 token 用**单条带条件的 UPDATE ... RETURNING** 完成，并同时校验
   * 过期时间：拆成「先 select 判断未撤销、再 update 撤销」会留下竞态窗口，
   * 两个并发请求可以都通过校验、各自签出一份新令牌。
   *
   * 同时加入复用检测：命中一个「已撤销」的 token 意味着它可能已泄漏并被
   * 第二方使用，此时撤销该用户的全部 refresh token，强制重新登录。
   */
  async refresh(refreshToken: string): Promise<AuthResponse> {
    const tokenHash = hashRefreshToken(refreshToken);

    const rotated = await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          sql`${refreshTokens.expiresAt} > now()`,
        ),
      )
      .returning({ userId: refreshTokens.userId });

    const rotatedRow = rotated[0];
    if (rotatedRow) {
      return this.issueTokens(rotatedRow.userId);
    }

    // 没轮换成功：要么 token 根本不存在（正常报错），要么是一个已撤销的
    // token 被重复使用。后者按「疑似泄漏」处理。
    const [revoked] = await this.database.db
      .select({ id: refreshTokens.id, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (revoked) {
      await this.revokeAllForUser(revoked.userId);
    }

    throw new UnauthorizedException("刷新令牌无效或已过期");
  }

  /** 撤销某用户的全部 refresh token（密码泄露、令牌复用等场景）。 */
  private async revokeAllForUser(userId: string): Promise<void> {
    await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async logout(refreshToken: string): Promise<void> {
    await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)), isNull(refreshTokens.revokedAt)));
  }
}
