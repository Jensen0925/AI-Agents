import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  roles,
  userRoles,
  users,
  UserStatus,
} from "../database/schema";
import { hashPassword } from "../auth/password";

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
    try {
      const [user] = await this.database.db.insert(users).values({
        id: crypto.randomUUID(),
        email: input.email.trim().toLowerCase(),
        name: input.name.trim(),
        passwordHash: await hashPassword(input.password),
        status: input.status ?? UserStatus.ACTIVE,
        updatedAt: new Date(),
      }).returning();
      if (input.roleIds?.length) {
        await this.database.db.insert(userRoles).values(input.roleIds.map((roleId) => ({ userId: user!.id, roleId })));
      }
      const [enriched] = await this.withRoles([user!]);
      return this.present(enriched!);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new ConflictException("邮箱已存在");
      }
      throw error;
    }
  }

  async update(id: string, input: UserInput) {
    await this.findById(id);
    const updates = {
      ...(input.email === undefined ? {} : { email: input.email.trim().toLowerCase() }),
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      updatedAt: new Date(),
    };
    const [user] = await this.database.db.update(users).set(updates).where(eq(users.id, id)).returning();
    if (input.roleIds) {
      await this.database.db.transaction(async (transaction) => {
        await transaction.delete(userRoles).where(eq(userRoles.userId, id));
        if (input.roleIds!.length) {
          await transaction.insert(userRoles).values(input.roleIds!.map((roleId) => ({ userId: id, roleId })));
        }
      });
    }
    const [enriched] = await this.withRoles([user!]);
    return this.present(enriched!);
  }

  async remove(id: string) {
    await this.findById(id);
    await this.database.db.delete(users).where(eq(users.id, id));
    return { ok: true };
  }

  async updateProfile(id: string, input: { name?: string }) {
    const [user] = await this.database.db.update(users).set({ name: input.name?.trim(), updatedAt: new Date() }).where(eq(users.id, id)).returning();
    const [enriched] = await this.withRoles([user!]);
    return this.present(enriched!);
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
