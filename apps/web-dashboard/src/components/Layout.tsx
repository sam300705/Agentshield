import { NavLink, Outlet } from "react-router-dom";

const navigation = [
  { label: "Dashboard", to: "/" },
  { label: "Scans", to: "/scans" },
  { label: "Approvals", to: "/approvals" },
  { label: "Audit Trail", to: "/audit" },
];

function linkClassName({ isActive }: { isActive: boolean }) {
  return [
    "block rounded px-3 py-2 text-sm font-medium",
    isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
  ].join(" ");
}

export function Layout() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="border-b border-slate-200 px-5 py-5">
          <p className="text-sm font-semibold tracking-wide text-slate-950">AgentShield</p>
          <p className="mt-1 text-xs text-slate-500">Policy-as-Code Guardrails</p>
        </div>
        <nav className="space-y-1 px-3 py-4">
          {navigation.map((item) => (
            <NavLink className={linkClassName} end={item.to === "/"} key={item.to} to={item.to}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
          <div className="flex min-h-16 items-center justify-between px-5 lg:px-8">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Security Platform
              </p>
              <h1 className="text-lg font-semibold text-slate-950">AgentShield Console</h1>
            </div>
            <div className="rounded border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">
              API: localhost:3001
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-slate-200 px-3 py-2 lg:hidden">
            {navigation.map((item) => (
              <NavLink className={linkClassName} end={item.to === "/"} key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="px-5 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
