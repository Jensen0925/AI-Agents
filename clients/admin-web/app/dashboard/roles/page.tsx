"use client";

import { ResourceTable, type ResourceRow } from "@/components/resource-table";

const demoRows: ResourceRow[] = [{ id: "demo-role", code: "super_admin", name: "超级管理员", builtIn: true }];

export default function RolesPage() {
  return <ResourceTable title="角色管理" description="用角色聚合权限，控制团队成员可以访问和操作的范围。" endpoint="/roles" demoRows={demoRows} columns={[{ key: "name", label: "角色" }, { key: "code", label: "编码" }, { key: "description", label: "说明" }, { key: "builtIn", label: "类型", render: (row) => <span className="text-slate-500">{row.builtIn ? "内置" : "自定义"}</span> }]} />;
}
