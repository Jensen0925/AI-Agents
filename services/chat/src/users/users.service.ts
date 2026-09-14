import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  roles,
  userRoles,
  users,
  UserStatus,
} from "../database/schema";
import { hashPassword } from "../auth/password";
import { checkPasswordPolicy } from "../auth/password-policy";
import { isUniqueViolation } from "../database/pg-errors";

/** 拥有全部权限的内置角色编码；与 seed.ts 保持一致。 */
const SUPER_ADMIN_ROLE_CODE = "super_admin";

interface UserInput {
  email?: string;
  name?: string;
  password?: string;
  status?: UserStatus;
  roleIds?: string[];
}

@Injectable()
export class UsersService {
  constructor(private readonly database: DatabaseService) {}

  private present<T extends { passwordHash: string }>(user: T) {
    const { passwordHash: _passwordHash, ...safe } = user;
    return safe;
  }

  async list(query = "", page = 1, pageSize = 10) {
    const normalizedPage = Math.max(1, Number(page) || 1);
    const normalizedSize = Math.min(100, Math.max(1, Number(pageSize) || 10));
    const normalizedQuery = query.trim();
    const where = normalizedQuery
      ? or(ilike(users.name, `%${normalizedQuery}%`), ilike(users.email, `%${normalizedQuery}%`))
      : undefined;
    const [total, userRows] = await Promise.all([
      this.database.db.select({ count: count() }).from(users).where(where),
      this.database.db.select().from(users).where(where)
        .orderBy(desc(users.createdAt))
        .limit(normalizedSize)
        .offset((normalizedPage - 1) * normalizedSize),
    ]);
    const totalCount = total[0]?.count ?? 0;
    const enriched = await this.withRoles(userRows);
    return {
      items: enriched.map((user) => this.present(user)),
      total: totalCount,
      page: normalizedPage,
      pageSize: normalizedSize,
      totalPages: Math.max(1, Math.ceil(totalCount / normalizedSize)),
    };
  }

  async findById(id: string) {
    const [user] = await this.database.db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!user) throw new NotFoundException("用户不存在");
    const [enriched] = await this.withRoles([user]);
    return this.present(enriched!);
  }

  async create(input: UserInput) {
    if (!input.email || !input.name || !input.password) {
      throw new ConflictException("email、name、password 均为必填");
    }
    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) {
      throw new BadRequestException(`密码不符合要求：${policy.reason}`);
    }

    const passwordHash = await hashPassword(input.password);
    try {
      // 用户与角色必须一起提交：否则 roleIds 含非法 ID 时外键报错，
      // 会留下一个已入库但没有任何角色的「幽灵用户」。
      const userId = await this.database.db.transaction(async (transaction) => {
        const [created] = await transaction
          .insert(users)
          .values({
            id: crypto.randomUUID(),
            email: input.email!.trim().toLowerCase(),
            name: input.name!.trim(),
            passwordHash,
            status: input.status ?? UserStatus.ACTIVE,
            updatedAt: new Date(),
          })
          .returning();
        if (!created) throw new Error("Unable to create user");

        if (input.roleIds?.length) {
          await transaction
            .insert(userRoles)
            .values(input.roleIds.map((roleId) => ({ userId: created.id, roleId })));
        }
        return created.id;
      });

      return this.findById(userId);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("邮箱已存在");
      }
      throw error;
    }
  }

  async update(id: string, input: UserInput, actorId?: string) {
    await this.findById(id);
    if (input.password) {
      const policy = checkPasswordPolicy(input.password);
      if (!policy.ok) {
        throw new BadRequestException(`密码不符合要求：${policy.reason}`);
      }
    }

    // 停用自己 = 立即失去当前权限；停用最后一个超管 = 系统永久失去管理入口。
    if (input.status === UserStatus.DISABLED) {
      if (actorId && actorId === id) {
        throw new BadRequestException("不能停用当前登录的账号");
      }
      await this.assertNotLastSuperAdmin(id, "停用");
    }

    // 先算好哈希：argon2 是 CPU 密集操作，不应放在事务里占着连接。
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : undefined;
    const updates = {
      ...(input.email === undefined ? {} : { email: input.email.trim().toLowerCase() }),
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(passwordHash ? { passwordHash } : {}),
      updatedAt: new Date(),
    };

    try {
      // 字段更新与角色替换必须原子：否则角色替换失败会留下「字段已改、角色没动」
      // 的不一致状态。
      await this.database.db.transaction(async (transaction) => {
        await transaction.update(users).set(updates).where(eq(users.id, id));
        if (input.roleIds) {
          await transaction.delete(userRoles).where(eq(userRoles.userId, id));
          if (input.roleIds.length) {
            await transaction
              .insert(userRoles)
              .values(input.roleIds.map((roleId) => ({ userId: id, roleId })));
          }
        }
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("邮箱已存在");
      }
      throw error;
    }

    return this.findById(id);
  }

  async remove(id: string, actorId?: string) {
    const target = await this.findById(id);

    // 自锁保护：删除自己会立刻丢失当前会话的权限，且若自己是唯一超管，
    // 系统将再无人可以恢复权限。
    if (actorId && actorId === id) {
      throw new BadRequestException("不能删除当前登录的账号");
    }
    await this.assertNotLastSuperAdmin(target.id, "删除");

    await this.database.db.delete(users).where(eq(users.id, id));
    return { ok: true };
  }

  async updateProfile(id: string, input: { name?: string }) {
    const [user] = await this.database.db.update(users).set({ name: input.name?.trim(), updatedAt: new Date() }).where(eq(users.id, id)).returning();
    const [enriched] = await this.withRoles([user!]);
    return this.present(enriched!);
  }

  /**
   * 校验目标用户是否为「最后一个可用的 super_admin」。
   *
   * roles 有 builtIn 保护，但用户此前没有任何同类约束：删掉/停用唯一的超管
   * 会让系统永久失去权限管理入口。
   */
  private async assertNotLastSuperAdmin(userId: string, action: string) {
    const [row] = await this.database.db
      .select({ isSuperAdmin: sql<boolean>`count(*) > 0` })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, SUPER_ADMIN_ROLE_CODE)));
    if (!row?.isSuperAdmin) return;

    const [remaining] = await this.database.db
      .select({ count: count() })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(roles.code, SUPER_ADMIN_ROLE_CODE),
          eq(users.status, UserStatus.ACTIVE),
          ne(users.id, userId),
        ),
      );

    if ((remaining?.count ?? 0) === 0) {
      throw new BadRequestException(
        `无法${action}最后一个启用状态的超级管理员`,
      );
    }
  }

  private async withRoles(userRows: typeof users.$inferSelect[]) {
    if (userRows.length === 0) return [];
    const roleRows = await this.database.db
      .select({ userId: userRoles.userId, role: roles })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(or(...userRows.map((user) => eq(userRoles.userId, user.id))));
    return userRows.map((user) => ({
      ...user,
      roles: roleRows.filter((row) => row.userId === user.id).map(({ role }) => ({ role })),
    }));
  }
}
