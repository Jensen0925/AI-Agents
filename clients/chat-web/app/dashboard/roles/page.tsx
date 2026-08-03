"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Edit3, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader, SearchBar, StatusMessage, EmptyState } from "@/components/admin-primitives";
import { PermissionTree } from "@/components/permission-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, apiErrorMessage } from "@/lib/api";
import { isDemoSession } from "@/lib/auth";
import { MOCK_PERMISSIONS, MOCK_ROLES, type PermissionRow, type RoleRow } from "@/lib/mock-data";

export default function RolesPage() {
  const [roles, setRoles] = useState<RoleRow[]>(MOCK_ROLES);
  const [permissions, setPermissions] = useState<PermissionRow[]>(MOCK_PERMISSIONS);
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemoSession()) return;
    void Promise.all([api.get<RoleRow[]>("/roles"), api.get<PermissionRow[]>("/permissions")]).then(([rolesResponse, permissionsResponse]) => { setRoles(rolesResponse.data); setPermissions(permissionsResponse.data); }).catch((reason) => setError(apiErrorMessage(reason)));
  }, []);
  const filtered = useMemo(() => roles.filter((role) => `${role.name} ${role.code} ${role.description ?? ""}`.toLowerCase().includes(query.toLowerCase().trim())), [roles, query]);
  function notify(text: string) { setMessage(text); window.setTimeout(() => setMessage(""), 3200); }
  function openCreate() { setEditing(null); setSelectedPermissionIds([]); setDrawerOpen(true); }
  function openEdit(role: RoleRow) { setEditing(role); setSelectedPermissionIds(role.permissions.map(({ permission }) => permission.id)); setDrawerOpen(true); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError(""); const form = new FormData(event.currentTarget); const data = { code: String(form.get("code") ?? ""), name: String(form.get("name") ?? ""), description: String(form.get("description") ?? ""), permissionIds: selectedPermissionIds };
    try {
      if (!isDemoSession()) {
        const response = editing ? await api.patch<RoleRow>(`/roles/${editing.id}`, data) : await api.post<RoleRow>("/roles", data);
        setRoles((items) => editing ? items.map((item) => item.id === editing.id ? response.data : item) : [response.data, ...items]);
      } else {
        const item: RoleRow = { id: editing?.id ?? `demo-role-${Date.now()}`, code: data.code, name: data.name, description: data.description, builtIn: editing?.builtIn ?? false, permissions: permissions.filter((item) => selectedPermissionIds.includes(item.id)).map((permission) => ({ permission })), _count: editing?._count ?? { users: 0 } };
        setRoles((items) => editing ? items.map((current) => current.id === editing.id ? item : current) : [item, ...items]);
      }
      setDrawerOpen(false); notify(editing ? "角色已更新" : "角色已创建");
    } catch (reason) { setError(apiErrorMessage(reason)); } finally { setLoading(false); }
  }
  async function remove(role: RoleRow) {
    if (role.builtIn) return; if (!window.confirm(`确定删除角色“${role.name}”吗？`)) return;
    try { if (!isDemoSession()) await api.delete(`/roles/${role.id}`); setRoles((items) => items.filter((item) => item.id !== role.id)); notify("角色已删除"); } catch (reason) { setError(apiErrorMessage(reason)); }
  }

  return <div><PageHeader eyebrow="Access / roles" title="角色管理" description="用角色聚合权限，控制团队成员可以访问和操作的范围。" action={<Button onClick={openCreate}><Plus className="h-4 w-4" />新建角色</Button>} />{message && <StatusMessage message={message} />}{error && <StatusMessage message={error} tone="error" />}<section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-400" /><span className="text-sm font-semibold text-slate-800">角色目录</span><Badge variant="muted">{filtered.length}</Badge></div><SearchBar value={query} onChange={setQuery} placeholder="搜索角色名称或编码..." /></div><Table><TableHeader><TableRow><TableHead>角色</TableHead><TableHead>权限</TableHead><TableHead>成员数</TableHead><TableHead>类型</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{filtered.map((role) => <TableRow key={role.id}><TableCell><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-50 text-blue-700"><ShieldCheck className="h-4 w-4" /></div><div><p className="font-medium text-slate-800">{role.name}</p><p className="text-xs text-slate-400">{role.code}</p></div></div></TableCell><TableCell><div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" /><span>{role.permissions.length} 项权限</span></div></TableCell><TableCell>{role._count?.users ?? 0} 人</TableCell><TableCell><Badge variant={role.builtIn ? "default" : "muted"}>{role.builtIn ? "系统内置" : "自定义"}</Badge></TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => openEdit(role)} aria-label={`编辑${role.name}`} title="编辑"><Edit3 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => void remove(role)} disabled={role.builtIn} aria-label={`删除${role.name}`} title={role.builtIn ? "内置角色不可删除" : "删除"}><Trash2 className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table>{filtered.length === 0 && <EmptyState title="没有匹配的角色" description="换一个关键词试试，或创建一个新的角色。" />}</section><Drawer open={drawerOpen} onOpenChange={setDrawerOpen}><DrawerContent><DrawerHeader><DrawerTitle>{editing ? "编辑角色" : "新建角色"}</DrawerTitle><DrawerDescription>填写基本信息，并通过权限树分配访问范围。</DrawerDescription></DrawerHeader><form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}><div className="flex-1 space-y-5 overflow-y-auto px-6 py-6"><div className="grid gap-5 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="role-code">角色编码</Label><Input id="role-code" name="code" defaultValue={editing?.code} placeholder="例如：analyst" required disabled={editing?.builtIn} /></div><div className="space-y-2"><Label htmlFor="role-name">角色名称</Label><Input id="role-name" name="name" defaultValue={editing?.name} placeholder="例如：需求分析师" required /></div></div><div className="space-y-2"><Label htmlFor="role-description">描述</Label><Textarea id="role-description" name="description" defaultValue={editing?.description ?? ""} placeholder="说明这个角色适合什么工作场景" rows={3} /></div><div className="space-y-2"><div className="flex items-center justify-between"><Label>分配权限</Label><span className="text-xs text-slate-500">已选 {selectedPermissionIds.length} 项</span></div><PermissionTree permissions={permissions} selected={selectedPermissionIds} onChange={setSelectedPermissionIds} /></div></div><DrawerFooter><DrawerClose asChild><Button type="button" variant="secondary">取消</Button></DrawerClose><Button type="submit" disabled={loading || editing?.builtIn}>{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}{editing ? "保存修改" : "创建角色"}</Button></DrawerFooter></form></DrawerContent></Drawer></div>;
}
