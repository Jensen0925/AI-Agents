"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Edit3, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader, SearchBar, StatusMessage, EmptyState } from "@/components/admin-primitives";
import { PermissionTree } from "@/components/permission-tree";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
  const [roleToDelete, setRoleToDelete] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);

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
        const item: RoleRow = { id: editing?.id ?? `demo-role-${Date.now()}`, code: data.code, name: data.name, description: data.description, builtIn: editing?.builtIn ?? false, permissions: permissions.filter((entry) => selectedPermissionIds.includes(entry.id)).map((permission) => ({ permission })), _count: editing?._count ?? { users: 0 } };
        setRoles((items) => editing ? items.map((current) => current.id === editing.id ? item : current) : [item, ...items]);
      }
      setDrawerOpen(false); notify(editing ? "角色已更新" : "角色已创建");
    } catch (reason) { setError(apiErrorMessage(reason)); } finally { setLoading(false); }
  }
  function requestRemove(role: RoleRow) { if (role.builtIn) return; setError(""); setRoleToDelete(role); }
  async function remove(role: RoleRow) {
    try { setDeleting(true); if (!isDemoSession()) await api.delete(`/roles/${role.id}`); setRoles((items) => items.filter((item) => item.id !== role.id)); setRoleToDelete(null); notify("角色已删除"); } catch (reason) { setError(apiErrorMessage(reason)); } finally { setDeleting(false); }
  }

  return <div>
    <PageHeader eyebrow="Access / roles" title="角色管理" description="用角色聚合权限，控制团队成员可以访问和操作的范围。" action={<Button onClick={openCreate}><Plus className="size-4" />新建角色</Button>} />
    {message && <StatusMessage message={message} />}
    {error && <StatusMessage message={error} tone="error" />}
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-muted-foreground" /><span className="text-sm font-semibold text-foreground">角色目录</span><Badge variant="muted">{filtered.length}</Badge></div><SearchBar value={query} onChange={setQuery} placeholder="搜索角色名称或编码..." /></div>
      <Table>
        <TableHeader><TableRow><TableHead>角色</TableHead><TableHead>权限</TableHead><TableHead>成员数</TableHead><TableHead>类型</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader>
        <TableBody>
          {filtered.length === 0 ? <TableRow><TableCell colSpan={5}><EmptyState title="没有匹配的角色" description="换一个关键词试试，或创建一个新的角色。" /></TableCell></TableRow> :
          filtered.map((role) => <TableRow key={role.id}>
            <TableCell><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary"><ShieldCheck className="size-4" /></div><div><p className="font-medium text-foreground">{role.name}</p><p className="text-xs text-muted-foreground">{role.code}</p></div></div></TableCell>
            <TableCell><div className="flex items-center gap-2"><KeyRound className="size-4 text-muted-foreground" /><span>{role.permissions.length} 项权限</span></div></TableCell>
            <TableCell>{role._count?.users ?? 0} 人</TableCell>
            <TableCell><Badge variant={role.builtIn ? "default" : "muted"}>{role.builtIn ? "系统内置" : "自定义"}</Badge></TableCell>
            <TableCell><div className="flex justify-end gap-1">
              <Button size="icon" variant="ghost" onClick={() => openEdit(role)} aria-label={`编辑${role.name}`} title="编辑"><Edit3 className="size-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => requestRemove(role)} disabled={role.builtIn} aria-label={`删除${role.name}`} title={role.builtIn ? "系统内置角色不可删除" : "删除"}><Trash2 className="size-4" /></Button>
            </div></TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </section>

    <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
      <DrawerContent>
        <DrawerHeader><DrawerTitle>{editing ? "编辑角色" : "新建角色"}</DrawerTitle><DrawerDescription>{editing ? "更新角色名称、说明与权限范围。" : "创建一个用于聚合权限的角色。"}</DrawerDescription></DrawerHeader>
        <form className="flex flex-1 flex-col" onSubmit={submit}>
          <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
            <div className="space-y-2"><Label htmlFor="role-code">编码</Label><Input id="role-code" name="code" defaultValue={editing?.code} placeholder="例如：editor" required /></div>
            <div className="space-y-2"><Label htmlFor="role-name">名称</Label><Input id="role-name" name="name" defaultValue={editing?.name} placeholder="例如：内容编辑" required /></div>
            <div className="space-y-2"><Label htmlFor="role-description">说明</Label><Textarea id="role-description" name="description" defaultValue={editing?.description ?? ""} placeholder="这个角色负责什么" /></div>
            <div className="space-y-2"><Label>权限范围</Label><PermissionTree permissions={permissions} selected={selectedPermissionIds} onChange={setSelectedPermissionIds} /></div>
          </div>
          <DrawerFooter>
            <DrawerClose asChild><Button type="button" variant="secondary">取消</Button></DrawerClose>
            <Button type="submit" disabled={loading}>{loading && <LoaderCircle className="size-4 animate-spin" />}{editing ? "保存修改" : "创建角色"}</Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>

    <ConfirmDialog
      open={roleToDelete !== null}
      onOpenChange={(open) => { if (!open && !deleting) setRoleToDelete(null); }}
      title="删除角色"
      description={<>确定要删除角色“{roleToDelete?.name}”吗？<br />该角色下的成员会失去对应权限，此操作无法撤销。</>}
      confirmText="删除角色"
      loading={deleting}
      error={error}
      onConfirm={() => { if (roleToDelete) void remove(roleToDelete); }}
    />
  </div>;
}
