import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

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

const connectionString = process.env["DATABASE_URL"];
if (!connectionString) throw new Error("DATABASE_URL is required");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function seed(): Promise<void> {
  const permissions = await Promise.all(
    PERMISSION_DEFINITIONS.map((permission) =>
      prisma.permission.upsert({
        where: { code: permission.code },
        create: permission,
        update: { name: permission.name, module: permission.module },
      }),
    ),
  );

  const superAdminRole = await prisma.role.upsert({
    where: { code: "super_admin" },
    create: {
      code: "super_admin",
      name: "超级管理员",
      description: "拥有系统全部管理权限",
      builtIn: true,
    },
    update: { name: "超级管理员", builtIn: true },
  });

  await prisma.rolePermission.createMany({
    data: permissions.map((permission) => ({
      roleId: superAdminRole.id,
      permissionId: permission.id,
    })),
    skipDuplicates: true,
  });

  const email = process.env["ADMIN_EMAIL"] ?? "admin@cloudsage.local";
  const password = process.env["ADMIN_PASSWORD"] ?? "Cloudsage@123";
  const passwordHash = await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
  const admin = await prisma.user.upsert({
    where: { email },
    create: { email, name: "系统管理员", passwordHash },
    update: { name: "系统管理员" },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: admin.id, roleId: superAdminRole.id },
    },
    create: { userId: admin.id, roleId: superAdminRole.id },
    update: {},
  });

  console.info(`[seed] 管理员 ${email} 与 ${permissions.length} 项权限已就绪`);
}

await seed()
  .finally(async () => prisma.$disconnect());
