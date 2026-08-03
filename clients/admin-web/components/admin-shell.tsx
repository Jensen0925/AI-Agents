"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, KeyRound, LogOut, Menu, MessageSquareText, ShieldCheck, UserRound, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { clearSession, getCurrentUser, isDemoSession, type SessionUser } from "@/lib/auth";

const navItems = [
  { href: "/dashboard", label: "工作台", icon: BarChart3, permission: "dashboard:read" },
  { href: "/dashboard/users", label: "用户管理", icon: Users, permission: "users:read" },
  { href: "/dashboard/roles", label: "角色管理", icon: ShieldCheck, permission: "roles:read" },
  { href: "/dashboard/permissions", label: "权限列表", icon: KeyRound, permission: "permissions:read" },
  { href: "/dashboard/profile", label: "个人信息", icon: UserRound, permission: "profile:read" },
];

function initials(name: string) { return name.trim().slice(0, 2).toUpperCase(); }

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const current = getCurrentUser();
    if (!current) router.replace("/login");
    else setUser(current);
    setHydrated(true);
  }, [router]);

  async function logout() {
    if (!isDemoSession()) {
      try {
        const raw = window.localStorage.getItem("cloudsage.session");
        const refreshToken = raw ? (JSON.parse(raw) as { refreshToken?: string }).refreshToken : undefined;
        if (refreshToken) await api.post("/auth/logout", { refreshToken });
      } catch {
        // 令牌失效时仍清理本地会话。
      }
    }
    clearSession();
    router.replace("/login");
  }

  const canSeeAll = hydrated && (isDemoSession() || user?.roles.includes("super_admin"));
  const visibleItems = navItems.filter((item) => canSeeAll || user?.permissions.includes(item.permission));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5"><Link href="/dashboard" className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-700 text-sm font-bold text-white">C</span><span><span className="block text-sm font-bold tracking-tight text-slate-950">CloudSage</span><span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">Admin Console</span></span></Link></div>
        <div className="border-t border-slate-100 px-3 py-4"><p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">Workspace</p><nav className="space-y-1" aria-label="主导航">{visibleItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${pathname === href ? "bg-blue-50 text-blue-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}`}><Icon className="h-4 w-4" /><span>{label}</span></Link>)}</nav></div>
        <div className="mt-auto border-t border-slate-100 px-3 py-3"><div className="flex items-center gap-3 rounded-md px-3 py-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{initials(user?.name ?? "管")}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-slate-800">{user?.name ?? "系统管理员"}</span><span className="block truncate text-xs text-slate-400">{user?.email ?? "admin@cloudsage.local"}</span></span></div></div>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-slate-950/20 lg:hidden" onClick={() => setMobileOpen(false)}><aside className="h-full w-72 border-r border-slate-200 bg-white p-4" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between"><Link href="/dashboard" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}><span className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-700 text-sm font-bold text-white">C</span><span className="text-sm font-bold text-slate-950">CloudSage</span></Link><button type="button" onClick={() => setMobileOpen(false)} aria-label="关闭菜单"><X className="h-5 w-5 text-slate-500" /></button></div><nav className="mt-8 space-y-1">{visibleItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium ${pathname === href ? "bg-blue-50 text-blue-800" : "text-slate-600"}`}><Icon className="h-4 w-4" />{label}</Link>)}</nav></aside></div>}
      <div className="min-h-screen lg:pl-60"><header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6"><div className="flex items-center gap-3"><button type="button" className="rounded-md p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu className="h-5 w-5" /></button><div><p className="text-xs font-medium text-slate-400">CloudSage Admin</p><h1 className="text-sm font-semibold text-slate-900">{pathname === "/dashboard" ? "工作台" : pathname.includes("users") ? "用户管理" : pathname.includes("roles") ? "角色管理" : pathname.includes("permissions") ? "权限列表" : pathname.includes("chat") ? "AI 工作区" : "个人信息"}</h1></div></div><div className="flex items-center gap-3"><Link href="/chat" className="hidden items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 sm:flex"><MessageSquareText className="h-4 w-4" />AI 工作区</Link><button type="button" onClick={() => void logout()} className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="退出登录"><LogOut className="h-4 w-4" /></button></div></header><main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main></div>
    </div>
  );
}
