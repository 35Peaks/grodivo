import { Link } from "@tanstack/react-router";
import { Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { label, num, usd } from "../lib/format";
import { useScorecards } from "../lib/queries";

function Attainment({ value, quota }: { value: number; quota: number | null }) {
  if (!quota) return <span className="text-ink-3">No quota</span>;
  const p = value / quota;
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted-bg"><div className="h-full rounded-full" style={{ width: `${Math.min(p, 1) * 100}%`, background: "var(--seq-strong)" }} /></div>
      <span className="w-10 text-right tabular">{Math.round(p * 100)}%</span>
    </div>
  );
}

export function Team() {
  const q = useScorecards();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data!;
  return (
    <div>
      <PageHeader title="Team" subtitle="Rep scorecards for the current quarter. Quotas are set by admins." />
      {rows.length === 0 ? <Empty title="No team members yet" /> : (
        <Card>
          <div className="-m-5 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-ink-3">
                <th className="px-5 py-2.5 font-medium">Rep</th>
                <th className="px-3 py-2.5 text-right font-medium">Open deals</th>
                <th className="px-3 py-2.5 text-right font-medium">Open pipeline</th>
                <th className="px-3 py-2.5 text-right font-medium">Weighted</th>
                <th className="px-3 py-2.5 text-right font-medium">Won ARR (QTD)</th>
                <th className="px-3 py-2.5 text-right font-medium">Won fees (QTD)</th>
                <th className="px-3 py-2.5 text-right font-medium">ARR vs quota</th>
                <th className="px-5 py-2.5 text-right font-medium">Activities, 30d</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-5 py-2.5">
                      <Link to="/pipeline" search={{ owner: r.id }} className="font-medium text-ink hover:underline">{r.name}</Link>
                      <div className="text-xs text-ink-3">{label(r.role)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular">{num(r.open_deals)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{usd(r.open_pipeline)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{usd(r.weighted_pipeline)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{usd(r.won_arr_qtd)}</td>
                    <td className="px-3 py-2.5 text-right tabular">{usd(r.won_bookings_qtd)}</td>
                    <td className="px-3 py-2.5"><Attainment value={r.won_arr_qtd} quota={r.quota_arr} /></td>
                    <td className="px-5 py-2.5 text-right tabular">{num(r.activities_30d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
