export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold text-rose-600">403</p>
        <h1 className="mt-2 text-xl font-semibold text-slate-900">暂无访问权限</h1>
        <p className="mt-2 text-sm text-slate-500">当前账号没有执行此操作所需的权限。</p>
        <a href="/dashboard" className="mt-6 inline-flex rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800">返回工作台</a>
      </section>
    </main>
  );
}
