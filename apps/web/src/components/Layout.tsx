import { Link, Outlet } from "@tanstack/react-router";
import { authDisabled, signOut } from "../lib/auth";
import { label } from "../lib/format";
import { useMeta, useSignalSummary } from "../lib/queries";
import { Loading, ErrorBox } from "./ui";

const NAV = [
  { to: "/", label: "Overview" },
  { to: "/signals", label: "M&A signals" },
  { to: "/lp", label: "LP commitments" },
  { to: "/pipeline", label: "Pipeline" },
  { to: "/accounts", label: "Accounts" },
  { to: "/team", label: "Team" },
] as const;

export function Layout() {
  const meta = useMeta();
  const signals = useSignalSummary();
  if (meta.isLoading) return <Loading />;
  if (meta.error) return <div className="p-8"><ErrorBox error={meta.error} /></div>;
  const me = meta.data!.me;
  return (
    <div className="min-h-screen md:flex">
      <aside className="flex items-center gap-4 border-b border-line bg-card px-4 py-3 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:flex-col md:items-stretch md:border-b-0 md:border-r md:px-3 md:py-5">
        <Link to="/" className="flex items-center gap-2 px-2">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="text-sm font-semibold tracking-tight">Grodivo <span className="font-normal text-ink-3">Sales</span></span>
        </Link>
        <nav className="flex gap-1 overflow-x-auto md:mt-6 md:flex-col">
          {[...NAV, ...(me.role === "admin" ? [{ to: "/admin", label: "Admin" } as const] : [])].map((n) => (
            <Link key={n.to} to={n.to} activeOptions={{ exact: n.to === "/" }}
              className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm text-ink-2 hover:bg-muted-bg hover:text-ink"
              activeProps={{ className: "bg-muted-bg font-medium !text-ink" }}>
              {n.label}
              {n.to === "/signals" && signals.data && Number(signals.data.new) > 0 && (
                <span className="ml-1.5 rounded bg-[var(--seq-strong)] px-1.5 text-[11px] font-medium text-white tabular">{signals.data.new}</span>
              )}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:gap-1 md:border-t md:border-line md:px-2 md:pt-4">
          <div className="hidden text-xs md:block">
            <div className="truncate font-medium text-ink">{me.name}</div>
            <div className="text-ink-3">{label(me.role)}</div>
          </div>
          {!authDisabled && (
            <button onClick={() => signOut()} className="text-left text-xs text-ink-3 hover:text-ink md:mt-2">Sign out</button>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-7xl"><Outlet /></div>
      </main>
    </div>
  );
}
