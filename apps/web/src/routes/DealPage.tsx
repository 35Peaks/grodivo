import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { ActivityComposer, DealForm } from "../components/forms";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, SegmentDot } from "../components/ui";
import { SEGMENT_COLOR, date, isPast, label, relative, usd } from "../lib/format";
import { useDeal, useMeta, useSave } from "../lib/queries";

export function DealPage() {
  const { id } = useParams({ from: "/app/deals/$id" });
  const navigate = useNavigate();
  const q = useDeal(id);
  const meta = useMeta();
  const save = useSave();
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const d = q.data!;
  const me = meta.data?.me;
  const canDelete = me && (me.role !== "rep" || d.owner_id === me.id);

  const facts: [string, React.ReactNode][] = [
    ["Account", <Link to="/accounts/$id" params={{ id: d.account_id }} className="hover:underline">{d.account_name}</Link>],
    ["Segment", <span className="flex items-center gap-1.5"><SegmentDot color={SEGMENT_COLOR[d.segment]} />{label(d.segment)}</span>],
    ["Offering", label(d.offering)],
    ["Motion", label(d.motion)],
    ["Owner", d.owner_name ?? "Unassigned"],
    ["Source", label(d.source) + (d.partner_name ? ` · ${d.partner_name}` : "")],
    ["Expected close", <span className={d.is_open && isPast(d.expected_close) ? "text-critical" : ""}>{date(d.expected_close) || "Not set"}</span>],
    ["Probability", `${d.effective_probability}%${d.probability === null ? " (stage default)" : ""}`],
  ];

  return (
    <div>
      <div className="mb-2 text-xs text-ink-3"><Link to="/pipeline" className="hover:underline">Pipeline</Link> /</div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{d.name}<Badge stage={d.stage}>{label(d.stage)}</Badge></span>}
        subtitle={d.closed_at ? `Closed ${date(d.closed_at)}` : `Updated ${relative(d.updated_at)}`}
        actions={<>
          {canDelete && <Button variant="danger" onClick={async () => {
            if (!confirm(`Delete "${d.name}"? This can't be undone.`)) return;
            await save.mutateAsync({ path: `/deals/${d.id}`, method: "DELETE" });
            navigate({ to: "/pipeline" });
          }}>Delete</Button>}
          <Button variant="primary" onClick={() => setEditing(true)}>Edit deal</Button>
        </>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-3 gap-3">
            {[["One-time fee", d.one_time_value], ["ARR", d.arr], ["Weighted value", d.weighted_arr + d.weighted_one_time]].map(([l, v]) => (
              <div key={l as string} className="rounded-xl border border-line bg-card px-4 py-3">
                <div className="text-xs text-ink-2">{l}</div>
                <div className="mt-1 text-lg font-semibold tabular">{usd(v as number)}</div>
              </div>
            ))}
          </div>
          {d.seats > 0 && <p className="text-xs text-ink-3 tabular">{d.seats.toLocaleString()} seats × {usd(d.pepy_rate)} PEPY</p>}

          <Card title="Activity">
            <ActivityComposer dealId={d.id} />
            {d.activities.length === 0 ? <div className="mt-4"><Empty title="No activity logged yet" /></div> : (
              <ul className="mt-4 divide-y divide-line">
                {d.activities.map((a) => (
                  <li key={a.id} className="py-2.5">
                    <div className="flex items-center gap-2 text-xs text-ink-3"><Badge>{label(a.type)}</Badge>{a.user_name} · {relative(a.occurred_at)}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{a.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <dl className="space-y-2.5 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-ink-3">{k}</dt><dd className="text-right text-ink">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Card title="Next step">
            {d.next_step ? (
              <><p className="text-sm text-ink">{d.next_step}</p>
                {d.next_step_date && <p className={"mt-1 text-xs " + (isPast(d.next_step_date) && d.is_open ? "text-critical" : "text-ink-3")}>Due {date(d.next_step_date)}</p>}</>
            ) : <p className="text-sm text-ink-3">None set.</p>}
            {d.lost_reason && <p className="mt-3 text-sm text-ink-2">Lost reason: {d.lost_reason}</p>}
          </Card>
          <Card title="Stage history">
            <ol className="space-y-2 text-sm">
              {d.history.map((h, i) => (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-ink">{h.from_stage ? `${label(h.from_stage)} → ${label(h.to_stage)}` : `Created in ${label(h.to_stage)}`}</span>
                  <span className="shrink-0 text-xs text-ink-3">{date(h.changed_at)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit deal" wide>
        <DealForm deal={d} onDone={() => setEditing(false)} />
      </Modal>
    </div>
  );
}
