import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { AccountForm } from "../components/forms";
import { Badge, Button, Empty, ErrorBox, Input, Loading, Modal, PageHeader, SegmentDot, Select } from "../components/ui";
import { SEGMENTS, SEGMENT_COLOR, label, usd } from "../lib/format";
import { useAccounts } from "../lib/queries";

export function Accounts() {
  const search = useSearch({ from: "/app/accounts" });
  const navigate = useNavigate({ from: "/accounts" });
  const [creating, setCreating] = useState(false);
  const [text, setText] = useState(search.q ?? "");
  const q = useAccounts({ segment: search.segment, q: search.q });
  const set = (k: string, v: string) => navigate({ search: (s: any) => ({ ...s, [k]: v || undefined }) });
  const rows = q.data ?? [];

  return (
    <div>
      <PageHeader title="Accounts" subtitle="Clients and prospects, with land-and-expand rollups."
        actions={<Button variant="primary" onClick={() => setCreating(true)}>New account</Button>} />
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set("q", text); }}>
        <Input aria-label="Search accounts" placeholder="Search accounts…" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => set("q", text)} className="w-56" />
        <Select aria-label="Segment" value={search.segment ?? ""} onChange={(e) => set("segment", e.target.value)} placeholder="All segments"
          options={SEGMENTS.map((s) => ({ value: s, label: label(s) }))} className="w-48" />
      </form>
      {q.isLoading ? <Loading /> : q.error ? <ErrorBox error={q.error} /> : rows.length === 0 ? (
        <Empty title="No accounts yet">Add a PE firm, corporate acquirer, consulting firm, or enterprise to get started.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-ink-3">
              <th className="px-4 py-2.5 font-medium">Account</th><th className="px-3 py-2.5 font-medium">Segment</th>
              <th className="px-3 py-2.5 text-right font-medium">cARR</th><th className="px-3 py-2.5 text-right font-medium">Won one-time</th>
              <th className="px-3 py-2.5 text-right font-medium">Open pipeline</th><th className="px-3 py-2.5 text-right font-medium">Open deals</th>
              <th className="px-4 py-2.5 font-medium">Owner</th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {rows.map((a) => (
                <tr key={a.id} className="hover:bg-muted-bg/50">
                  <td className="px-4 py-2.5">
                    <Link to="/accounts/$id" params={{ id: a.id }} className="font-medium text-ink hover:underline">{a.name}</Link>
                    <div className="mt-0.5 flex gap-1.5 text-xs text-ink-3">
                      {a.landed && <Badge stage="closed_won">Landed</Badge>}
                      {a.parent_name && <span>Part of {a.parent_name}</span>}
                      {a.child_accounts > 0 && <span>{a.child_accounts} linked accounts</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5"><span className="flex items-center gap-1.5 text-ink-2"><SegmentDot color={SEGMENT_COLOR[a.segment]} />{label(a.segment)}</span></td>
                  <td className="px-3 py-2.5 text-right tabular">{usd(a.carr)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{usd(a.won_one_time)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{usd(a.open_pipeline)}</td>
                  <td className="px-3 py-2.5 text-right tabular">{a.open_deals}</td>
                  <td className="px-4 py-2.5 text-ink-2">{a.owner_name ?? <span className="text-ink-3">Unassigned</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New account" wide>
        <AccountForm onDone={(id) => { setCreating(false); navigate({ to: "/accounts/$id", params: { id } }); }} />
      </Modal>
    </div>
  );
}
