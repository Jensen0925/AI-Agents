export type UserStatus = "ACTIVE" | "DISABLED";
export interface UserRow { id: string; name: string; email: string; status: UserStatus; createdAt: string; roles: Array<{ role: { id: string; code: string; name: string } }>; }
export interface PermissionRow { id: string; code: string; name: string; module: string; description?: string | null; }
export interface RoleRow { id: string; code: string; name: string; description?: string | null; builtIn: boolean; permissions: Array<{ permission: PermissionRow }>; _count?: { users: number }; }

export const MOCK_USERS: UserRow[] = [
  { id: "u-001", name: "林晓雅", email: "lin.xiaoya@cloudsage.local", status: "ACTIVE", createdAt: "2026-07-18T08:30:00.000Z", roles: [{ role: { id: "r-admin", code: "super_admin", name: "超级管理员" } }] },
  { id: "u-002", name: "周远航", email: "zhou.yuanhang@cloudsage.local", status: "ACTIVE", createdAt: "2026-07-22T10:15:00.000Z", roles: [{ role: { id: "r-analyst", code: "analyst", name: "需求分析师" } }] },
  { id: "u-003", name: "Mia Chen", email: "mia.chen@cloudsage.local", status: "DISABLED", createdAt: "2026-07-24T03:45:00.000Z", roles: [{ role: { id: "r-viewer", code: "viewer", name: "只读成员" } }] },
  { id: "u-004", name: "韩子墨", email: "han.zimo@cloudsage.local", status: "ACTIVE", createdAt: "2026-07-27T09:05:00.000Z", roles: [{ role: { id: "r-analyst", code: "analyst", name: "需求分析师" } }] },
];

export const MOCK_PERMISSIONS: PermissionRow[] = [
  { id: "p-1", code: "dashboard:read", name: "查看工作台", module: "工作台", description: "访问管理工作台概览" },
  { id: "p-2", code: "users:read", name: "查看用户", module: "用户管理", description: "查看用户列表与详情" },
  { id: "p-3", code: "users:create", name: "创建用户", module: "用户管理", description: "新增用户账号" },
  { id: "p-4", code: "users:update", name: "编辑用户", module: "用户管理", description: "更新用户信息与状态" },
  { id: "p-5", code: "users:delete", name: "删除用户", module: "用户管理", description: "删除用户账号" },
  { id: "p-6", code: "roles:read", name: "查看角色", module: "角色管理", description: "查看角色及其权限" },
  { id: "p-7", code: "roles:create", name: "创建角色", module: "角色管理", description: "创建自定义角色" },
  { id: "p-8", code: "roles:update", name: "编辑角色", module: "角色管理", description: "维护角色权限" },
  { id: "p-9", code: "roles:delete", name: "删除角色", module: "角色管理", description: "删除自定义角色" },
  { id: "p-10", code: "permissions:read", name: "查看权限", module: "权限管理", description: "查看系统权限目录" },
  { id: "p-11", code: "profile:read", name: "查看个人信息", module: "个人中心", description: "查看自己的账号信息" },
  { id: "p-12", code: "profile:update", name: "编辑个人信息", module: "个人中心", description: "更新自己的显示名称" },
];

export const MOCK_ROLES: RoleRow[] = [
  { id: "r-admin", code: "super_admin", name: "超级管理员", description: "拥有系统全部管理权限", builtIn: true, permissions: MOCK_PERMISSIONS.map((permission) => ({ permission })), _count: { users: 1 } },
  { id: "r-analyst", code: "analyst", name: "需求分析师", description: "负责需求工作流与文档分析", builtIn: false, permissions: MOCK_PERMISSIONS.filter((item) => item.code.startsWith("dashboard") || item.code.startsWith("users") || item.code === "profile:read").map((permission) => ({ permission })), _count: { users: 2 } },
  { id: "r-viewer", code: "viewer", name: "只读成员", description: "仅查看工作区信息", builtIn: false, permissions: MOCK_PERMISSIONS.filter((item) => item.code.endsWith(":read")).map((permission) => ({ permission })), _count: { users: 1 } },
];
