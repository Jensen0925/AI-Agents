import { DatabaseService } from "./database.service";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "./schema";
import { hashPassword } from "../auth/password";

export const PERMISSION_DEFINITIONS = [
  { code: "dashboard:read", name: "查看工作台", module: "工作台" },
  { code: "users:read", name: "查看用户", module: "用户管理" },
  { code: "users:create", name: "创建用户", module: "用户管理" },
  { code: "users:update", name: "编辑用户", module: "用户管理" },
  { code: "users:delete", name: "删除用户", module: "用户管理" },
  { code: "roles:read", name: "查看角色", module: "角色管理" },
  { code: "roles:create", name: "创建角色", module: "角色管理" },
  { code: "roles:update", name: "编辑角色", module: "角色管理" },
  { code: "roles:delete", name: "删除角色", module: "角色管理" },
  { code: "permissions:read", name: "查看权限", module: "权限管理" },
  { code: "profile:read", name: "查看个人信息", module: "个人中心" },
  { code: "profile:update", name: "编辑个人信息", module: "个人中心" },
] as const;

async function seed(): Promise<void> {
  const database = new DatabaseService();
  await database.connect();

  try {
    await database.db.transaction(async (transaction) => {
      const permissionRows = [];
      for (const permission of PERMISSION_DEFINITIONS) {
        const [row] = await transaction
          .insert(permissions)
          .values({ id: crypto.randomUUID(), ...permission })
          .onConflictDoUpdate({
            target: permissions.code,
            set: { name: permission.name, module: permission.module },
          })
          .returning();
        if (row) permissionRows.push(row);
      }

      const [superAdminRole] = await transaction
        .insert(roles)
        .values({
          id: crypto.randomUUID(),
          code: "super_admin",
          name: "超级管理员",
          description: "拥有系统全部管理权限",
          builtIn: true,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: roles.code,
          set: { name: "超级管理员", builtIn: true, updatedAt: new Date() },
        })
        .returning();
      if (!superAdminRole) throw new Error("Unable to initialize super_admin role");

      for (const permission of permissionRows) {
        await transaction
          .insert(rolePermissions)
          .values({ roleId: superAdminRole.id, permissionId: permission.id })
          .onConflictDoNothing();
      }

      const email = process.env["ADMIN_EMAIL"] ?? "admin@cloudsage.local";
      const password = process.env["ADMIN_PASSWORD"] ?? "Cloudsage@123";
      const [admin] = await transaction
        .insert(users)
        .values({
          id: crypto.randomUUID(),
          email,
          name: "系统管理员",
          passwordHash: await hashPassword(password),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: users.email,
          set: { name: "系统管理员", updatedAt: new Date() },
        })
        .returning();
      if (!admin) throw new Error("Unable to initialize admin user");

      await transaction
        .insert(userRoles)
        .values({ userId: admin.id, roleId: superAdminRole.id })
        .onConflictDoNothing();
    });
  } finally {
    await database.disconnect();
  }

  console.info(
    `[seed] 管理员 ${process.env["ADMIN_EMAIL"] ?? "admin@cloudsage.local"} 与 ${PERMISSION_DEFINITIONS.length} 项权限已就绪`,
  );
}

void seed().catch((error) => {
  console.error("[seed] 初始化失败", error);
  process.exitCode = 1;
});
