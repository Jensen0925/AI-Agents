"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getCurrentUser, isDemoSession } from "@/lib/auth";
import { logoutSession } from "@/lib/logout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { ChevronDown, KeyRound, LogOut, Menu, MessageSquareText, ShieldCheck, UserRound, Users, X } from "lucide-react";

const navItems = [
  { href: "/dashboard/users", label: "用户管理", permission: "users:read", icon: Users },
  { href: "/dashboard/roles", label: "角色管理", permission: "roles:read", icon: ShieldCheck },
  { href: "/dashboard/permissions", label: "权限列表", permission: "permissions:read", icon: KeyRound },
  { href: "/dashboard/profile", label: "个人信息", permission: "profile:read", icon: UserRound },
];

function initials(name: string) { return name.trim().slice(0, 2).toUpperCase(); }

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const user = getCurrentUser();
  const permissions = user?.permissions ?? [];
  const visibleItems = isDemoSession() || user?.roles.includes("super_admin") ? navItems : navItems.filter((item) => permissions.includes(item.permission));
  const canViewWorkspace = isDemoSession() || user?.roles.includes("super_admin") || permissions.includes("dashboard:read");
  return <nav className="space-y-1 px-3" aria-label="主导航">
    <p className="px-3 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Workspace</p>
    {canViewWorkspace && <Link href="/chat" onClick={onNavigate} className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors", pathname === "/chat" || pathname === "/dashboard" ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}><MessageSquareText className="h-4 w-4" /> <span>AI 工作区</span></Link>}
    {visibleItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={onNavigate} className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors", pathname === href ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground")}><Icon className="h-4 w-4" /> <span>{label}</span></Link>)}
  </nav>;
}

function Sidebar({ mobile = false, onClose }: { mobile?: boolean; onClose?: () => void }) {
  return <aside className={cn("flex h-full flex-col bg-sidebar", !mobile && "fixed inset-y-0 left-0 z-30 w-60 border-r border-sidebar-border")}>
    <div className="flex h-16 items-center justify-between px-5">
      <Link href="/dashboard/users" className="flex items-center gap-2.5" onClick={onClose}>
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">C</span>
        <span><span className="block text-sm font-bold tracking-tight text-sidebar-foreground">CloudSage</span><span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Admin Console</span></span>
      </Link>
      {mobile && <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭菜单"><X className="h-4 w-4" /></Button>}
    </div>
    <Separator />
    <div className="flex-1 overflow-y-auto py-3"><Navigation onNavigate={onClose} /></div>
    <div className="border-t border-sidebar-border px-3 py-3"><Link href="/dashboard/profile" onClick={onClose} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/60"><Avatar className="h-8 w-8"><AvatarFallback>{initials(getCurrentUser()?.name ?? "管").slice(0, 2)}</AvatarFallback></Avatar><span className="min-w-0 flex-1"><span className="block truncate font-medium text-sidebar-foreground">{getCurrentUser()?.name ?? "系统管理员"}</span><span className="block truncate text-xs text-muted-foreground">{getCurrentUser()?.email ?? "admin@cloudsage.local"}</span></span></Link></div>
  </aside>;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = getCurrentUser();
  const title = pathname === "/chat" || pathname === "/dashboard" ? "AI 工作区" : pathname.includes("users") ? "用户管理" : pathname.includes("roles") ? "角色管理" : pathname.includes("permissions") ? "权限列表" : "个人信息";
  async function logout() { await logoutSession(); router.replace("/login"); }
  return <div className="min-h-screen bg-background">
    <Sidebar />
    <Drawer open={mobileOpen} onOpenChange={setMobileOpen}><DrawerContent className="max-w-[300px] sm:max-w-[320px]"><DrawerHeader className="sr-only"><DrawerTitle>导航菜单</DrawerTitle><DrawerDescription>Cloudsage 管理后台导航</DrawerDescription></DrawerHeader><Sidebar mobile onClose={() => setMobileOpen(false)} /></DrawerContent></Drawer>
    <div className="min-h-screen lg:pl-60">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3"><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="打开菜单"><Menu className="h-5 w-5" /></Button><div><p className="text-xs font-medium text-muted-foreground">Cloudsage Admin</p><h2 className="text-sm font-semibold text-foreground">{title}</h2></div></div>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-full bg-emerald-500/12 px-3 py-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />系统运行正常</div><ThemeToggle className="h-9 w-9" /><Button variant="ghost" size="icon" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut className="h-4 w-4" /></Button><Avatar className="h-8 w-8"><AvatarFallback>{initials(user?.name ?? "管")}</AvatarFallback></Avatar><ChevronDown className="hidden h-4 w-4 text-muted-foreground sm:block" /></div>
      </header>
      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  </div>;
}
