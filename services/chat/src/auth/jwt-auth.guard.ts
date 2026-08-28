import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { permissions, rolePermissions, roles, userRoles, users, UserStatus } from "../database/schema";
import { verifyAccessToken } from "./token";

export interface AuthenticatedUser {
  userId: string;
  email?: string;
  name?: string;
  roles?: string[];
  permissions?: string[];
}

export interface AuthenticatedRequest {
  headers: {
    authorization?: string | string[];
  };
  user?: AuthenticatedUser;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly database: DatabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    const header = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    const token = header?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException("Bearer token is required");

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (error) {
      throw new UnauthorizedException(
        error instanceof Error ? error.message : "Invalid bearer token",
      );
    }

    const [user] = await this.database.db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User is not active");
    }

    const access = await this.database.db
      .select({ roleCode: roles.code, permissionCode: permissions.code })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, user.id));
    request.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: [...new Set(access.map((item) => item.roleCode))],
      permissions: [...new Set(access.flatMap((item) => item.permissionCode ? [item.permissionCode] : []))],
    };
    return true;
  }
}
