"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Edit3, LoaderCircle, MoreHorizontal, Plus, UserMinus, UserPlus, Users as UsersIcon } from "lucide-react";
import { PageHeader, Pagination, SearchBar, StatusMessage, EmptyState } from "@/components/admin-primitives";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle, DrawerClose } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, apiErrorMessage } from "@/lib/api";
import { isDemoSession } from "@/lib/auth";
import { MOCK_ROLES, MOCK_USERS, type RoleRow, type UserRow, type UserStatus } from "@/lib/mock-data";

const PAGE_SIZE = 8;
const dateFormatter = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" });

export default function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>(MOCK_USERS);
  const [roles, setRoles] = useState<RoleRow[]>(MOCK_ROLES);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isDemoSession()) return;
    void Promise.all([api.get("/users", { params: { pageSize: 100 } }), api.get<RoleRow[]>("/roles")]).then(([usersResponse, rolesResponse]) => {
      setUsers(usersResponse.data.items as UserRow[]); setRoles(rolesResponse.data); 
    }).catch((reason) => setError(apiErrorMessage(reason)));
  }, []);

  const filtered = useMemo(() => users.filter((user) => `${user.name} ${user.email} ${user.roles.map(({ role }) => role.name).join(" ")}`.toLowerCase().includes(query.toLowerCase().trim())), [users, query]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const allVisibleSelected = pageItems.length > 0 && pageItems.every((user) => selected.includes(user.id));

  function notify(text: string) { setMessage(text); setError(""); window.setTimeout(() => setMessage(""), 3200); }
  function toggleAll(checked: boolean) { setSelected(checked ? [...new Set([...selected, ...pageItems.map((user) => user.id)])] : selected.filter((id) => !pageItems.some((user) => user.id === id))); }
  function toggleOne(id: string, checked: boolean) { setSelected(checked ? [...new Set([...selected, id])] : selected.filter((item) => item !== id)); }
  function openCreate() { setEditing(null); setDrawerOpen(true); }
  function openEdit(user: UserRow) { setEditing(user); setDrawerOpen(true); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const data = { name: String(form.get("name") ?? ""), email: String(form.get("email") ?? ""), password: String(form.get("password") ?? "") || undefined, roleIds: [String(form.get("roleId") ?? "")] };
    try {
      if (!isDemoSession()) {
        const response = editing ? await api.patch<UserRow>(`/users/${editing.id}`, data) : await api.post<UserRow>("/users", data);
        setUsers((items) => editing ? items.map((item) => item.id === editing.id ? response.data : item) : [response.data, ...items]);
      } else {
        const role = roles.find((item) => item.id === data.roleIds[0]) ?? roles[0];
        const item: UserRow = { id: editing?.id ?? `demo-${Date.now()}`, name: data.name, email: data.email, status: editing?.status ?? "ACTIVE", createdAt: editing?.createdAt ?? new Date().toISOString(), roles: [{ role: { id: role.id, code: role.code, name: role.name } }] };
        setUsers((items) => editing ? items.map((current) => current.id === editing.id ? item : current) : [item, ...items]);
      }
      setDrawerOpen(false); notify(editing ? "用户信息已更新" : "用户已创建");
    } catch (reason) { setError(apiErrorMessage(reason)); }
    finally { setLoading(false); }
  }
  async function bulkDisable() {
    if (!selected.length) return;
    try {
      if (!isDemoSession()) await Promise.all(selected.map((id) => api.patch(`/users/${id}`, { status: "DISABLED" })));
      setUsers((items) => items.map((item) => selected.includes(item.id) ? { ...item, status: "DISABLED" } : item)); setSelected([]); notify(`${selected.length} 个用户已停用`);
    } catch (reason) { setError(apiErrorMessage(reason)); }
  }

  return <div>
    <PageHeader eyebrow="Access / members" title="用户管理" description="管理组织成员、账号状态与角色归属。变更会实时影响下次访问鉴权。" action={<Button onClick={openCreate}><Plus className="h-4 w-4" />新建用户</Button>} />
    {message && <StatusMessage message={message} />}{error && <StatusMessage message={error} tone="error" />}
    <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><UsersIcon className="h-4 w-4 text-slate-400" /><span className="text-sm font-semibold text-slate-800">全部用户</span><Badge variant="muted">{filtered.length}</Badge></div><SearchBar value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="搜索姓名或邮箱..." /></div>
      {selected.length > 0 && <div className="flex items-center justify-between border-b border-blue-100 bg-blue-50 px-4 py-2.5"><span className="text-sm font-medium text-blue-800">已选择 {selected.length} 个用户</span><Button variant="outline" size="sm" onClick={bulkDisable}><UserMinus className="h-4 w-4" />批量停用</Button></div>}
      <Table><TableHeader><TableRow><TableHead className="w-12"><Checkbox checked={allVisibleSelected} onCheckedChange={(checked) => toggleAll(checked === true)} aria-label="选择当前页全部用户" /></TableHead><TableHead>成员</TableHead><TableHead>角色</TableHead><TableHead>状态</TableHead><TableHead>加入时间</TableHead><TableHead className="w-20 text-right">操作</TableHead></TableRow></TableHeader><TableBody>{pageItems.map((user) => <TableRow key={user.id} data-state={selected.includes(user.id) ? "selected" : undefined}><TableCell><Checkbox checked={selected.includes(user.id)} onCheckedChange={(checked) => toggleOne(user.id, checked === true)} aria-label={`选择${user.name}`} /></TableCell><TableCell><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{user.name.slice(0, 2)}</div><div><p className="font-medium text-slate-800">{user.name}</p><p className="text-xs text-slate-400">{user.email}</p></div></div></TableCell><TableCell><div className="flex flex-wrap gap-1.5">{user.roles.map(({ role }) => <Badge key={role.id} variant="muted">{role.name}</Badge>)}</div></TableCell><TableCell><Badge variant={user.status === "ACTIVE" ? "success" : "danger"}>{user.status === "ACTIVE" ? "正常" : "已停用"}</Badge></TableCell><TableCell className="text-slate-500">{dateFormatter.format(new Date(user.createdAt))}</TableCell><TableCell><div className="flex justify-end gap-1"><Button size="icon" variant="ghost" onClick={() => openEdit(user)} aria-label={`编辑${user.name}`} title="编辑"><Edit3 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" aria-label="更多操作" title="更多操作"><MoreHorizontal className="h-4 w-4" /></Button></div></TableCell></TableRow>)}</TableBody></Table>
      {pageItems.length === 0 && <EmptyState title="没有匹配的用户" description="换一个关键词试试，或创建一个新的用户账号。" />}
      <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onChange={setPage} />
    </section>
    <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}><DrawerContent><DrawerHeader><DrawerTitle>{editing ? "编辑用户" : "新建用户"}</DrawerTitle><DrawerDescription>{editing ? "更新账号信息和角色归属。" : "创建一个可以访问 Cloudsage 的成员账号。"}</DrawerDescription></DrawerHeader><form className="flex flex-1 flex-col" onSubmit={submit}><div className="flex-1 space-y-5 overflow-y-auto px-6 py-6"><div className="space-y-2"><Label htmlFor="user-name">姓名</Label><Input id="user-name" name="name" defaultValue={editing?.name} placeholder="例如：林晓雅" required /></div><div className="space-y-2"><Label htmlFor="user-email">邮箱</Label><Input id="user-email" name="email" type="email" defaultValue={editing?.email} placeholder="name@company.com" required /></div>{!editing && <div className="space-y-2"><Label htmlFor="user-password">初始密码</Label><Input id="user-password" name="password" type="password" placeholder="至少 8 位字符" minLength={8} required /></div>}<div className="space-y-2"><Label htmlFor="user-role">角色</Label><select id="user-role" name="roleId" defaultValue={editing?.roles[0]?.role.id ?? roles[0]?.id} className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100">{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></div></div><DrawerFooter><DrawerClose asChild><Button type="button" variant="secondary">取消</Button></DrawerClose><Button type="submit" disabled={loading}>{loading && <LoaderCircle className="h-4 w-4 animate-spin" />}{editing ? "保存修改" : "创建用户"}</Button></DrawerFooter></form></DrawerContent></Drawer>
  </div>;
}
