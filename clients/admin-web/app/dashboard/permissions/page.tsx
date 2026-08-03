"use client";

import { ResourceTable, type ResourceRow } from "@/components/resource-table";

const demoRows: ResourceRow[] = [{ id: "demo-permission", code: "dashboard:read", name: "查看工作台", module: "工作台" }];

export default function PermissionsPage() {
  return <ResourceTable title="权限列表" description="查看系统权限枚举及其所属模块，角色分配由服务端统一校验。" endpoint="/permissions" demoRows={demoRows} columns={[{ key: "module", label: "模块" }, { key: "name", label: "权限名称" }, { key: "code", label: "权限编码" }, { key: "description", label: "说明" }]} />;
}
