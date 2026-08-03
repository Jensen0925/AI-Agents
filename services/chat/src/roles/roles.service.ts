import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

interface RoleInput {
  code?: string;
  name?: string;
  description?: string;
  permissionIds?: string[];
}

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly include = {
    permissions: { include: { permission: true } },
    _count: { select: { users: true } },
  } as const;

  list() {
    return this.prisma.role.findMany({ include: this.include, orderBy: { createdAt: "asc" } });
  }

  async findById(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id }, include: this.include });
    if (!role) throw new NotFoundException("角色不存在");
    return role;
  }

  async create(input: RoleInput) {
    if (!input.code || !input.name) throw new ConflictException("code、name 均为必填");
    try {
      return await this.prisma.role.create({
        data: {
          code: input.code.trim(),
          name: input.name.trim(),
          description: input.description?.trim(),
          permissions: input.permissionIds?.length ? { create: input.permissionIds.map((permissionId) => ({ permission: { connect: { id: permissionId } } })) } : undefined,
        },
        include: this.include,
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new ConflictException("角色编码已存在");
      throw error;
    }
  }

  async update(id: string, input: RoleInput) {
    await this.findById(id);
    return this.prisma.role.update({
      where: { id },
      data: {
        code: input.code?.trim(),
        name: input.name?.trim(),
        description: input.description?.trim(),
        permissions: input.permissionIds
          ? { deleteMany: {}, create: input.permissionIds.map((permissionId) => ({ permission: { connect: { id: permissionId } } })) }
          : undefined,
      },
      include: this.include,
    });
  }

  async remove(id: string) {
    const role = await this.findById(id);
    if (role.builtIn) throw new ConflictException("内置角色不可删除");
    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }
}
