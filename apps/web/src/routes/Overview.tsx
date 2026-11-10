import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { BarList, Meter, SplitBar, StackedColumns } from "../components/charts";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, SegmentDot, Select, StatTile } from "../components/ui";
import { OPEN_STAGES, SEGMENTS, SEGMENT_COLOR, date, label, num, pct, usd } from "../lib/format";
import { useMeta, useSignalSummary, useSummary } from "../lib/queries";

const REASON: Record<string, string> = {
  overdue_close: "Close date passed", overdue_next_step: "Next step overdue", no_recent_activity: "No activity in 21+ days",
};

export function Overview() {
  const search = useSearch({ from: "/app/" });
  const navigate = useNavigate({ from: "/" });
  const meta = useMeta();
  const q = useSummary({ owner: search.owner, segment: search.segment });
  const signals = useSignalSummary();
  const setFilter = (k: "owner" | "segment", v: string) => navigate({ search: (s) => ({ ...s, [k]: v || undefined }) });

  const filters = (
    <>
      <Select aria-label="Segment" value={search.segment ?? ""} onChange={(e) => setFilter("segment", e.target.value)}
        placeholder="All segments" options={SEGMENTS.map((s) => ({ value: s, label: label(s) }))} className="w-48" />
      <Select aria-label="Owner" value={search.owner ?? ""} onChange={(e) => setFilter("owner", e.target.value)}
        placeholder="Whole team" options={(meta.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} className="w-44" />
    </>
  );

  if (q.isLoading) return <><PageHeader title="Overview" actions={filters} /><Loading /></>;
  if (q.error) return <ErrorBox error={q.error} />;
  const s = q.data!;
  const k = s.kpis;
  const winRate = k.won_180 + k.lost_180 > 0 ? (k.won_180 / (k.won_180 + k.lost_180)) * 100 : null;
  const pilotConv = s.pilots.converted + s.pilots.lost > 0 ? (s.pilots.converted / (s.pilots.converted + s.pilots.lost)) * 100 : null;
  const stageRows = s.byStage.filter((r) => (OPEN_STAGES as readonly string[]).includes(r.stage));
  const monthLabel = (m: string) => new Date(m + "-01T00:00:00").toLocaleDateString("en-US", { month: "short" });

  return (
    <div className={q.isFetching ? "opacity-70 transition-opacity" : "transition-opacity"}>
      <PageHeader title="Overview" subtitle="Pipeline, revenue and forecast across all four segments." actions={filters} />
      {signals.data && Number(signals.data.new_high_fit) > 0 && (
        <Link to="/signals" search={{ min_fit: "70" }} className="mb-3 flex items-center justify-between rounded-xl border border-line bg-card px-5 py-3 text-sm hover:bg-muted-bg">
          <span><span className="font-semibold">{signals.data.new_high_fit} high-fit M&A signals</span> <span className="text-ink-2">waiting for review ({signals.data.last_24h} new in the last 24 hours)</span></span>
          <span className="text-ink-3">Review →</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="col-span-2 rounded-xl border border-line bg-card px-5 py-4">
          <Meter label="Contracted ARR vs target" value={k.carr} target={s.target?.target_arr ?? 0} />
          {s.target && <p className="mt-2 text-[11px] text-ink-3">Target period {date(s.target.period_start)} to {date(s.target.period_end)}</p>}
        </div>
        <StatTile label="Open pipeline" value={usd(k.open_pipeline, { compact: true })} sub={`${num(k.open_deals)} open deals`} />
        <StatTile label="Weighted pipeline" value={usd(k.weighted_pipeline, { compact: true })} sub="By stage probability" />
        <StatTile label="Win rate, 180 days" value={winRate === null ? "None yet" : pct(winRate)}
          sub={`${k.won_180} won · ${k.lost_180} lost${k.avg_cycle_days !== null ? ` · ${k.avg_cycle_days}-day avg cycle` : ""}`} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Open pipeline by segment" subtitle="One-time fees plus first-year ARR. Click a segment to filter.">
          <BarList
            onSelect={(seg) => setFilter("segment", search.segment === seg ? "" : seg)}
            rows={s.bySegment.map((r) => ({
              key: r.segment, tipLabel: label(r.segment), value: r.open_pipeline, color: SEGMENT_COLOR[r.segment],
              label: <span className="flex items-center gap-2"><SegmentDot color={SEGMENT_COLOR[r.segment]} />{label(r.segment)} <span className="text-ink-3">· {r.open_deals} deals</span></span>,
              detail: [{ label: "Weighted", value: usd(r.weighted_pipeline) }, { label: "cARR", value: usd(r.carr) }],
            }))} />
        </Card>
        <Card title="Open pipeline by stage" subtitle="Unweighted value at each stage.">
          <BarList rows={stageRows.map((r) => ({
            key: r.stage, tipLabel: label(r.stage), value: r.value, color: "var(--seq-strong)",
            label: <>{label(r.stage)} <span className="text-ink-3">· {r.deals}</span></>,
            detail: [{ label: "Deals", value: String(r.deals) }, { label: "Weighted", value: usd(r.weighted) }],
          }))} />
        </Card>

        <Card title="Weighted forecast by expected close" subtitle="Open deals, next six months. Past-due close dates count in the current month.">
          <StackedColumns
            series={[{ label: "Recurring (ARR)", color: "var(--series-1)" }, { label: "One-time fees", color: "var(--series-2)" }]}
            data={s.forecast.map((f) => ({ key: f.month, label: monthLabel(f.month), values: [f.weighted_arr, f.weighted_one_time] }))} />
        </Card>
        <Card title="Revenue mix" subtitle="Recurring kAI seats versus one-time diagnostics and programs.">
          <div className="space-y-6">
            <SplitBar label="Closed won" parts={[
              { label: "Recurring", value: s.mix.won_arr, color: "var(--series-1)" },
              { label: "One-time", value: s.mix.won_one_time, color: "var(--series-2)" }]} />
            <SplitBar label="Open pipeline" parts={[
              { label: "Recurring", value: s.mix.open_arr, color: "var(--series-1)" },
              { label: "One-time", value: s.mix.open_one_time, color: "var(--series-2)" }]} />
          </div>
          <div className="mt-6 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            {s.landExpand.map((m) => (
              <div key={m.motion}>
                <div className="text-xs font-medium text-ink-2">{m.motion === "land" ? "Land (new clients)" : "Expand (existing clients)"}</div>
                <div className="mt-0.5 font-semibold tabular">{usd(m.open_pipeline, { compact: true })} <span className="text-xs font-normal text-ink-3">open · {m.open_deals} deals</span></div>
                <div className="text-xs text-ink-3 tabular">{usd(m.won_value, { compact: true })} won · {m.won_deals} deals</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Paid pilots" subtitle="Deals that reached the pilot stage.">
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-ink-2">Reached pilot</dt><dd className="text-xl font-semibold tabular">{s.pilots.reached_pilot}</dd></div>
            <div><dt className="text-xs text-ink-2">In pilot now</dt><dd className="text-xl font-semibold tabular">{s.pilots.in_pilot}</dd></div>
            <div><dt className="text-xs text-ink-2">Converted</dt><dd className="text-xl font-semibold tabular">{s.pilots.converted}{pilotConv !== null && <span className="ml-1 text-xs font-normal text-ink-3">{pct(pilotConv)}</span>}</dd></div>
            <div><dt className="text-xs text-ink-2">Avg days to convert</dt><dd className="text-xl font-semibold tabular">{s.pilots.avg_days_to_convert ?? "None"}</dd></div>
          </dl>
        </Card>
        <Card title="Needs attention" subtitle="Overdue close dates, overdue next steps, or quiet for 21+ days." className="lg:col-span-2">
          {s.attention.length === 0 ? <Empty title="Nothing overdue">Every open deal has a current close date, next step and recent activity.</Empty> : (
            <ul className="divide-y divide-line">
              {s.attention.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link to="/deals/$id" params={{ id: d.id }} className="block truncate text-sm font-medium text-ink hover:underline">{d.name}</Link>
                    <div className="truncate text-xs text-ink-3">{d.account_name} · {d.owner_name ?? "Unassigned"} · {REASON[d.reason]}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge stage={d.stage}>{label(d.stage)}</Badge>
                    <span className="w-16 text-right text-sm font-semibold tabular">{usd(d.value, { compact: true })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
