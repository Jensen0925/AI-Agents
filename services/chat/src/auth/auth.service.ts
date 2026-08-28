import {
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
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
  constructor(private readonly database: DatabaseService) {}

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

  async login(email: string, password: string): Promise<AuthResponse> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("邮箱或密码错误");
    }
    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException("邮箱或密码错误");
    await this.database.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
    return this.issueTokens(user.id);
  }

  async refresh(refreshToken: string): Promise<AuthResponse> {
    const [stored] = await this.database.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)))
      .limit(1);
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= Date.now()
    ) {
      throw new UnauthorizedException("刷新令牌无效或已过期");
    }
    await this.database.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, stored.id));
    return this.issueTokens(stored.userId);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.database.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, hashRefreshToken(refreshToken)), isNull(refreshTokens.revokedAt)));
  }
}
