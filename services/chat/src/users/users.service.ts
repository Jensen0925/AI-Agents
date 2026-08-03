import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { UserStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

interface UserInput {
  email?: string;
  name?: string;
  password?: string;
  status?: UserStatus;
  roleIds?: string[];
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    roles: { include: { role: true } },
  } as const;

  private present<T extends { passwordHash: string }>(user: T) {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async list(query = "", page = 1, pageSize = 10) {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
    const where = query.trim()
      ? { OR: [{ name: { contains: query.trim(), mode: "insensitive" as const } }, { email: { contains: query.trim(), mode: "insensitive" as const } }] }
      : {};
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: this.include,
        orderBy: { createdAt: "desc" },
        skip: (normalizedPage - 1) * normalizedSize,
        take: normalizedSize,
      }),
    ]);
    return {
      items: users.map((user) => this.present(user)),
      total,
      page: normalizedPage,
      pageSize: normalizedSize,
      totalPages: Math.max(1, Math.ceil(total / normalizedSize)),
    };
  }

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: this.include });
    if (!user) throw new NotFoundException("用户不存在");
    return this.present(user);
  }

  async create(input: UserInput) {
    if (!input.email || !input.name || !input.password) {
      throw new ConflictException("email、name、password 均为必填");
    }
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email.trim().toLowerCase(),
          name: input.name.trim(),
          passwordHash: await Bun.password.hash(input.password, { algorithm: "argon2id" }),
          status: input.status ?? UserStatus.ACTIVE,
          roles: input.roleIds?.length ? { create: input.roleIds.map((roleId) => ({ role: { connect: { id: roleId } } })) } : undefined,
        },
        include: this.include,
      });
      return this.present(user);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ConflictException("邮箱已存在");
      }
      throw error;
    }
  }

  async update(id: string, input: UserInput) {
    await this.findById(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: input.email?.trim().toLowerCase(),
        name: input.name?.trim(),
        status: input.status,
        passwordHash: input.password ? await Bun.password.hash(input.password, { algorithm: "argon2id" }) : undefined,
        roles: input.roleIds
          ? { deleteMany: {}, create: input.roleIds.map((roleId) => ({ role: { connect: { id: roleId } } })) }
          : undefined,
      },
      include: this.include,
    });
    return this.present(user);
  }

  async remove(id: string) {
    await this.findById(id);
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }

  async updateProfile(id: string, input: { name?: string }) {
    const user = await this.prisma.user.update({
      where: { id },
      data: { name: input.name?.trim() },
      include: this.include,
    });
    return this.present(user);
  }
}
