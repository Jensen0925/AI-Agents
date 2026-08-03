import Link from "next/link";
import { ArrowLeft, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ForbiddenPage() {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6"><div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600"><ShieldX className="h-6 w-6" /></div><h1 className="mt-5 text-xl font-semibold text-slate-950">没有访问权限</h1><p className="mt-2 text-sm leading-6 text-slate-500">当前账号没有访问这个页面的权限，请联系管理员调整角色。</p><Button asChild className="mt-6"><Link href="/dashboard/users"><ArrowLeft className="h-4 w-4" />返回工作台</Link></Button></div></main>;
}
