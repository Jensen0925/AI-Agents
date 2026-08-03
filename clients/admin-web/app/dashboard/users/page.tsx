"use client";

import { ResourceTable, type ResourceRow } from "@/components/resource-table";

const demoRows: ResourceRow[] = [{ id: "demo-admin", name: "系统管理员", email: "admin@cloudsage.local", status: "ACTIVE", createdAt: "-" }];

export default function UsersPage() {
  return <ResourceTable title="用户管理" description="管理成员账号、状态与角色归属。" endpoint="/users" demoRows={demoRows} columns={[{ key: "name", label: "成员" }, { key: "email", label: "邮箱" }, { key: "status", label: "状态", render: (row) => <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">{String(row.status) === "ACTIVE" ? "正常" : String(row.status)}</span> }, { key: "createdAt", label: "加入时间" }]} />;
}
