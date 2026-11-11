import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Fragment, useState } from "react";
import { Badge, Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, StatTile, cx } from "../components/ui";
import { api } from "../lib/api";
import { date, label, num, usd } from "../lib/format";
import { qs, useSave } from "../lib/queries";
import type { LpGp, LpSignal, LpSummary } from "../lib/types";

const GROUPS = ["private_equity", "venture", "private_credit", "infrastructure"] as const;
const month = (m: string | null) => (m ? new Date(m.slice(0, 10) + "T00:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "");

function GpDetail({ gp }: { gp: string }) {
  const q = useQuery({ queryKey: ["lp-gp", gp], queryFn: () => api<LpSignal[]>(`/lp/gps/${encodeURIComponent(gp)}/signals`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-ink-3">
        <th className="py-1.5 pr-3 font-medium">Month</th><th className="py-1.5 pr-3 font-medium">Plan (all board actions on file)</th>
        <th className="py-1.5 pr-3 font-medium">Action</th><th className="py-1.5 pr-3 font-medium">Fund / mandate</th>
        <th className="py-1.5 pr-3 text-right font-medium">$M</th><th className="py-1.5 font-medium">Source</th>
      </tr></thead>
      <tbody className="divide-y divide-line">
        {q.data!.map((s) => (
          <tr key={s.id} className="align-top">
            <td className="whitespace-nowrap py-1.5 pr-3 text-ink-2">{month(s.event_month)}</td>
            <td className="py-1.5 pr-3">{s.plan}{s.state ? <span className="text-ink-3"> · {s.state}</span> : null}</td>
            <td className="py-1.5 pr-3 text-ink-2">{s.signal_type}<div className="text-ink-3">{label(s.asset_group)}</div></td>
            <td className="py-1.5 pr-3" title={s.action_detail ?? ""}>{s.counterparty}</td>
            <td className="py-1.5 pr-3 text-right tabular">{s.amount_usd_m != null ? num(s.amount_usd_m) : ""}</td>
            <td className="py-1.5">
              {s.source_url ? <a href={s.source_url} target="_blank" rel="noreferrer" className="text-[var(--series-1)] hover:underline">{s.doc_type ?? s.source_name ?? "Source"}</a> : s.source_name}
              {s.source_type === "primary" && <Badge stage="closed_won" className="ml-1">Primary</Badge>}
              {s.doc_date && <div className="text-ink-3">{date(s.doc_date)}</div>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LpCommitments() {
  const search = useSearch({ from: "/app/lp" });
  const navigate = useNavigate({ from: "/lp" });
  const f = { months: search.months ?? "12", group: search.group, q: search.q, primary: search.primary };
  const summary = useQuery({ queryKey: ["lp-summary", f], queryFn: () => api<LpSummary>(`/lp/summary${qs(f)}`) });
  const gps = useQuery({ queryKey: ["lp-gps", f], queryFn: () => api<LpGp[]>(`/lp/gps${qs(f)}`), placeholderData: (p) => p });
  const save = useSave<{ account_id: string; deal_id: string | null }>();
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState(search.q ?? "");
  const set = (k: string, v: string) => navigate({ search: (s: any) => ({ ...s, [k]: v || undefined }) });
  const s = summary.data;

  return (
    <div>
      <PageHeader title="LP commitments"
        subtitle="Public pension board actions from the 35 Peaks Pension Signal Monitor. GPs winning new commitments are about to deploy into deals." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="GPs with new commitments" value={s ? num(s.gps) : "…"} sub={`Last ${f.months} months`} />
        <StatTile label="Committed" value={s ? usd(s.total_usd_m * 1e6, { compact: true }) : "…"} sub={s ? `${num(s.commitments)} actions` : ""} />
        <StatTile label="Pension plans" value={s ? num(s.plans) : "…"} />
        <StatTile label="From primary documents" value={s?.primary_pct != null ? `${s.primary_pct}%` : "…"}
          sub={s?.latest_month ? `Data through ${month(s.latest_month)}` : undefined} />
      </div>

      <form className="my-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set("q", text); }}>
        <Input aria-label="Search GP or fund" placeholder="Search GP or fund…" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => set("q", text)} className="w-56" />
        <Select aria-label="Window" value={f.months} onChange={(e) => set("months", e.target.value === "12" ? "" : e.target.value)}
          options={[{ value: "6", label: "Last 6 months" }, { value: "12", label: "Last 12 months" }, { value: "24", label: "Last 24 months" }]} className="w-44" />
        <Select aria-label="Asset class" value={f.group ?? ""} onChange={(e) => set("group", e.target.value)} placeholder="All private markets"
          options={GROUPS.map((g) => ({ value: g, label: label(g) }))} className="w-48" />
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={f.primary === "true"} onChange={(e) => set("primary", e.target.checked ? "true" : "")} /> Primary documents only
        </label>
      </form>

      {gps.isLoading ? <Loading /> : gps.error ? <ErrorBox error={gps.error} /> : gps.data!.length === 0 ? (
        <Empty title="No commitments in this window">Widen the window or clear a filter.</Empty>
      ) : (
        <Card>
          <div className={cx("-m-5 overflow-x-auto", gps.isFetching && "opacity-70")}>
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-5 py-2.5 font-medium">GP</th>
                <th className="px-3 py-2.5 text-right font-medium">Committed</th>
                <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                <th className="px-3 py-2.5 text-right font-medium">Plans</th>
                <th className="px-3 py-2.5 font-medium">Latest</th>
                <th className="px-3 py-2.5 font-medium">Recent funds</th>
                <th className="px-5 py-2.5" />
              </tr></thead>
              <tbody className="divide-y divide-line">
                {gps.data!.map((g) => (<Fragment key={g.gp}>
                  <tr className="align-top hover:bg-muted-bg/50">
                    <td className="px-5 py-2.5">
                      <button className="text-left font-medium text-ink hover:underline" onClick={() => setOpen(open === g.gp ? null : g.gp)}>
                        {open === g.gp ? "▾" : "▸"} {g.gp}
                      </button>
                      <div className="mt-0.5 flex flex-wrap gap-1 pl-4">
                        {g.groups.map((x) => <Badge key={x}>{label(x)}</Badge>)}
                        {g.account && <Link to="/accounts/$id" params={{ id: g.account.id }}><Badge stage="closed_won">In CRM</Badge></Link>}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular">{g.total_usd_m ? usd(g.total_usd_m * 1e6, { compact: true }) : <span className="font-normal text-ink-3">Undisclosed</span>}</td>
                    <td className="px-3 py-2.5 text-right tabular">{g.commitments}</td>
                    <td className="px-3 py-2.5 text-right tabular">{g.plans}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-2">{month(g.latest_month)}</td>
                    <td className="max-w-72 px-3 py-2.5 text-xs text-ink-2">{g.recent_funds.filter(Boolean).join("; ")}</td>
                    <td className="px-5 py-2.5 text-right">
                      <Button size="sm" variant={g.account ? "secondary" : "primary"} disabled={save.isPending}
                        onClick={async () => {
                          const r = await save.mutateAsync({ path: "/lp/gps/actions/add", method: "POST", json: { gp: g.gp, account_id: g.account?.id ?? null } });
                          if (r.deal_id) navigate({ to: "/deals/$id", params: { id: r.deal_id } });
                        }}>Add to pipeline</Button>
                    </td>
                  </tr>
                  {open === g.gp && <tr><td colSpan={7} className="bg-muted-bg/40 px-5 py-3"><GpDetail gp={g.gp} /></td></tr>}
                </Fragment>))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {save.error && <p className="mt-2 text-sm text-critical">{(save.error as Error).message}</p>}
      {s && <p className="mt-4 text-xs text-ink-3">{num(s.all_records)} pension board actions on file across all asset classes and action types; this view shows private-markets commitments and hires.</p>}
    </div>
  );
}
