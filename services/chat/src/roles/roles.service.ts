import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { count, eq, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { isUniqueViolation } from "../database/pg-errors";
import { permissions, rolePermissions, roles, userRoles } from "../database/schema";

interface RoleInput {
  code?: string;
  name?: string;
  description?: string;
  permissionIds?: string[];
}

@Injectable()
export class RolesService {
  constructor(private readonly database: DatabaseService) {}

  async list() {
    const allRoles = await this.database.db.select().from(roles).orderBy(roles.createdAt);
    return this.withRelations(allRoles);
  }

  async findById(id: string) {
    const [role] = await this.database.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw new NotFoundException("角色不存在");
    return (await this.withRelations([role]))[0];
  }

  async create(input: RoleInput) {
    if (!input.code || !input.name) throw new ConflictException("code、name 均为必填");
    try {
      // 角色与权限必须一起提交：否则 permissionIds 含非法 ID 时外键报错，
      // 会留下一个已入库但没有任何权限的角色。
      const roleId = await this.database.db.transaction(async (transaction) => {
        const [role] = await transaction.insert(roles).values({ id: crypto.randomUUID(), code: input.code!.trim(), name: input.name!.trim(), description: input.description?.trim(), updatedAt: new Date() }).returning();
        if (!role) throw new Error("Unable to create role");
        if (input.permissionIds?.length) {
          await transaction.insert(rolePermissions).values(input.permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })));
        }
        return role.id;
      });
      return await this.findById(roleId);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("角色编码已存在");
      throw error;
    }
  }

  async update(id: string, input: RoleInput) {
    await this.findById(id);
    // 字段更新与权限替换必须原子：否则权限替换失败会留下「字段已改、权限没动」的不一致状态。
    await this.database.db.transaction(async (transaction) => {
      await transaction.update(roles).set({ code: input.code?.trim(), name: input.name?.trim(), description: input.description?.trim(), updatedAt: new Date() }).where(eq(roles.id, id));
      if (input.permissionIds) {
        await transaction.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
        if (input.permissionIds.length) {
          await transaction.insert(rolePermissions).values(input.permissionIds.map((permissionId) => ({ roleId: id, permissionId })));
        }
      }
    }).catch((error: unknown) => {
      if (isUniqueViolation(error)) throw new ConflictException("角色编码已存在");
      throw error;
    });
    // 重新读取，避免把事务前的快照当作更新结果返回。
    return await this.findById(id);
  }

  async remove(id: string) {
    const role = await this.findById(id);
    if (role.builtIn) throw new ConflictException("内置角色不可删除");
    await this.database.db.delete(roles).where(eq(roles.id, id));
    return { ok: true };
  }

  private async withRelations(roleRows: typeof roles.$inferSelect[]) {
    if (roleRows.length === 0) return [];
    const roleIds = roleRows.map((role) => eq(rolePermissions.roleId, role.id));
    const permissionRows = await this.database.db.select({ roleId: rolePermissions.roleId, permission: permissions }).from(rolePermissions).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(or(...roleIds));
    const userCounts = await this.database.db.select({ roleId: userRoles.roleId, count: count() }).from(userRoles).groupBy(userRoles.roleId);
    return roleRows.map((role) => ({ ...role, permissions: permissionRows.filter((row) => row.roleId === role.id).map(({ permission }) => ({ permission })), _count: { users: userCounts.find((row) => row.roleId === role.id)?.count ?? 0 } }));
  }
}
