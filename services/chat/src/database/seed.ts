import { DatabaseService } from "./database.service";
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from "./schema";
import { hashPassword } from "../auth/password";
import { createRandomPassword } from "../auth/password-policy";

// tsx 不会自动加载 .env（drizzle-kit 会），而本脚本直接以 tsx 运行，
// 因此在此显式加载项目根目录的 .env，确保 DATABASE_URL 等变量可用。
// 使用 Node 22 内置 API，无需额外依赖；不会覆盖已存在的真实环境变量。
if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch {
    // 缺少 .env 时忽略，交由下方 DATABASE_URL 校验给出明确报错
  }
}

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
  { code: "security:read", name: "查看安全状态", module: "安全治理" },
  { code: "security:manage", name: "管理安全开关", module: "安全治理" },
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
      // 不提供兜底口令：硬编码默认密码会让生产部署带着可预测的管理员凭据上线。
      // 未配置时随机生成并一次性打印，强制运维显式接管这个口令。
      const configuredPassword = process.env["ADMIN_PASSWORD"]?.trim();
      const generatedPassword = configuredPassword
        ? undefined
        : createRandomPassword();
      const password = configuredPassword ?? generatedPassword!;
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

      if (generatedPassword) {
        // 只打印一次；后续可登录后在个人中心修改，或显式设置 ADMIN_PASSWORD 重新 seed。
        console.warn(
          [
            "",
            "================ 初始管理员凭据（仅本次生成，请立即保存）================",
            `  邮箱：${email}`,
            `  密码：${generatedPassword}`,
            "  未配置 ADMIN_PASSWORD，本口令为随机生成，无法再次查看。",
            "===============================================================",
            "",
          ].join("\n"),
        );
      }

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
