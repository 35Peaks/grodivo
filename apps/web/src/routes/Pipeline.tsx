import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { DealForm } from "../components/forms";
import { Badge, Button, Empty, ErrorBox, Input, Loading, Modal, PageHeader, SegmentDot, Select } from "../components/ui";
import { downloadCsv } from "../lib/api";
import { OFFERINGS, SEGMENTS, SEGMENT_COLOR, STAGES, date, isPast, label, usd } from "../lib/format";
import { qs, useDeals, useMeta, useSave } from "../lib/queries";

export function Pipeline() {
  const search = useSearch({ from: "/app/pipeline" });
  const navigate = useNavigate({ from: "/pipeline" });
  const meta = useMeta();
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState(search.q ?? "");
  const f = { status: search.status ?? "open", stage: search.stage, segment: search.segment, owner: search.owner, offering: search.offering, q: search.q };
  const deals = useDeals(f);
  const save = useSave();
  const set = (k: string, v: string) => navigate({ search: (s: any) => ({ ...s, [k]: v || undefined }) });

  const rows = deals.data ?? [];
  const totals = rows.reduce((a, d) => ({ value: a.value + d.one_time_value + d.arr, weighted: a.weighted + d.weighted_arr + d.weighted_one_time }), { value: 0, weighted: 0 });

  return (
    <div>
      <PageHeader title="Pipeline" subtitle={`${rows.length} deals · ${usd(totals.value, { compact: true })} total · ${usd(totals.weighted, { compact: true })} weighted`}
        actions={<>
          <Button onClick={() => downloadCsv(`/deals/export.csv${qs(f)}`)}>Export CSV</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>New deal</Button>
        </>} />

      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set("q", text); }}>
        <Input aria-label="Search deals" placeholder="Search deal or account…" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => set("q", text)} className="w-56" />
        <Select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value === "open" ? "" : e.target.value || "all")}
          options={[{ value: "open", label: "Open deals" }, { value: "closed", label: "Closed deals" }, { value: "all", label: "All deals" }]} className="w-36" />
        <Select aria-label="Stage" value={f.stage ?? ""} onChange={(e) => set("stage", e.target.value)} placeholder="Any stage" options={STAGES.map((s) => ({ value: s, label: label(s) }))} className="w-36" />
        <Select aria-label="Segment" value={f.segment ?? ""} onChange={(e) => set("segment", e.target.value)} placeholder="All segments" options={SEGMENTS.map((s) => ({ value: s, label: label(s) }))} className="w-44" />
        <Select aria-label="Offering" value={f.offering ?? ""} onChange={(e) => set("offering", e.target.value)} placeholder="Any offering" options={OFFERINGS.map((s) => ({ value: s, label: label(s) }))} className="w-48" />
        <Select aria-label="Owner" value={f.owner ?? ""} onChange={(e) => set("owner", e.target.value)} placeholder="Any owner" options={(meta.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} className="w-40" />
      </form>

      {deals.isLoading ? <Loading /> : deals.error ? <ErrorBox error={deals.error} /> : rows.length === 0 ? (
        <Empty title="No deals match">Try clearing a filter, or add the first deal.</Empty>
      ) : (
        <div className={"overflow-x-auto rounded-xl border border-line bg-card " + (deals.isFetching ? "opacity-70" : "")}>
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-4 py-2.5 font-medium">Deal</th>
                <th className="px-3 py-2.5 font-medium">Stage</th>
                <th className="px-3 py-2.5 font-medium">Offering</th>
                <th className="px-3 py-2.5 text-right font-medium">One-time</th>
                <th className="px-3 py-2.5 text-right font-medium">ARR</th>
                <th className="px-3 py-2.5 text-right font-medium">Prob.</th>
                <th className="px-3 py-2.5 font-medium">Close</th>
                <th className="px-3 py-2.5 font-medium">Next step</th>
                <th className="px-4 py-2.5 font-medium">Owner</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((d) => (
                <tr key={d.id} className="hover:bg-muted-bg/50">
                  <td className="px-4 py-2.5">
                    <Link to="/deals/$id" params={{ id: d.id }} className="font-medium text-ink hover:underline">{d.name}</Link>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
                      <SegmentDot color={SEGMENT_COLOR[d.segment]} />
                      <Link to="/accounts/$id" params={{ id: d.account_id }} className="hover:underline">{d.account_name}</Link>
                      {d.motion === "expand" && <Badge>Expand</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <select aria-label={`Stage for ${d.name}`} value={d.stage} disabled={save.isPending}
                      onChange={(e) => save.mutate({ path: `/deals/${d.id}`, method: "PATCH", json: { stage: e.target.value } })}
                      className="rounded border border-transparent bg-transparent py-0.5 text-sm text-ink hover:border-line">
                      {STAGES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{label(d.offering)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{d.one_time_value ? usd(d.one_time_value) : <span className="text-ink-3">None</span>}</td>
                  <td className="px-3 py-2.5 text-right tabular">{d.arr ? usd(d.arr) : <span className="text-ink-3">None</span>}
                    {d.seats > 0 && <div className="text-[11px] text-ink-3">{d.seats.toLocaleString()} × {usd(d.pepy_rate)}</div>}</td>
                  <td className="px-3 py-2.5 text-right tabular text-ink-2">{d.effective_probability}%</td>
                  <td className={"px-3 py-2.5 whitespace-nowrap " + (d.is_open && isPast(d.expected_close) ? "text-critical" : "text-ink-2")}>
                    {d.is_open && isPast(d.expected_close) && <span aria-hidden>⚠ </span>}{date(d.expected_close) || <span className="text-ink-3">Not set</span>}
                  </td>
                  <td className="max-w-56 px-3 py-2.5">
                    <div className="truncate text-ink-2">{d.next_step ?? <span className="text-ink-3">None</span>}</div>
                    {d.next_step_date && <div className={"text-[11px] " + (isPast(d.next_step_date) && d.is_open ? "text-critical" : "text-ink-3")}>{date(d.next_step_date)}</div>}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-ink-2">{d.owner_name ?? <span className="text-ink-3">Unassigned</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {save.error && <p className="mt-2 text-sm text-critical">{(save.error as Error).message}</p>}

      <Modal open={creating} onClose={() => setCreating(false)} title="New deal" wide>
        <DealForm onDone={(id) => { setCreating(false); navigate({ to: "/deals/$id", params: { id } }); }} />
      </Modal>
    </div>
  );
}
