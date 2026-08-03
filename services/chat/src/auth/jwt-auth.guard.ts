import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { verifyAccessToken } from "./token";
import { PrismaService } from "../prisma/prisma.service";

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
  constructor(private readonly prisma: PrismaService) {}

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

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: { role: { include: { permissions: { include: { permission: true } } } } },
        },
      },
    });
    if (!user || user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException("User is not active");
    }

    request.user = {
      userId: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map(({ role }) => role.code),
      permissions: user.roles.flatMap(({ role }) =>
        role.permissions.map(({ permission }) => permission.code),
      ),
    };
    return true;
  }
}
