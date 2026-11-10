import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { AccountForm, ActivityComposer, ContactForm, DealForm } from "../components/forms";
import { Badge, Button, Card, Empty, ErrorBox, Loading, Modal, PageHeader, SegmentDot, StatTile } from "../components/ui";
import { SEGMENT_COLOR, date, label, relative, usd } from "../lib/format";
import { useAccount, useMeta, useSave } from "../lib/queries";
import type { Contact } from "../lib/types";

export function AccountPage() {
  const { id } = useParams({ from: "/app/accounts/$id" });
  const navigate = useNavigate();
  const q = useAccount(id);
  const meta = useMeta();
  const save = useSave();
  const [modal, setModal] = useState<null | "edit" | "deal" | "contact">(null);
  const [contact, setContact] = useState<Contact | undefined>();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const a = q.data!;
  const familyCarr = a.carr + a.children.reduce((s, c) => s + c.carr, 0);
  const familyOpen = a.open_pipeline + a.children.reduce((s, c) => s + c.open_pipeline, 0);

  return (
    <div>
      <div className="mb-2 text-xs text-ink-3"><Link to="/accounts" className="hover:underline">Accounts</Link> /
        {a.parent_account_id && <> <Link to="/accounts/$id" params={{ id: a.parent_account_id }} className="hover:underline">{a.parent_name}</Link> /</>}</div>
      <PageHeader
        title={<span className="flex items-center gap-2">{a.name}{a.landed && <Badge stage="closed_won">Landed</Badge>}</span>}
        subtitle={<span className="flex flex-wrap items-center gap-1.5"><SegmentDot color={SEGMENT_COLOR[a.segment]} />{label(a.segment)}
          {a.industry && <> · {a.industry}</>}{a.employee_count && <> · {a.employee_count.toLocaleString()} employees</>}
          {a.hq_location && <> · {a.hq_location}</>}{a.owner_name && <> · Owner {a.owner_name}</>}</span>}
        actions={<>
          {meta.data?.me.role !== "rep" && <Button variant="danger" onClick={async () => {
            if (!confirm(`Delete ${a.name}? Its contacts and activity go with it.`)) return;
            await save.mutateAsync({ path: `/accounts/${a.id}`, method: "DELETE" });
            navigate({ to: "/accounts" });
          }}>Delete</Button>}
          <Button onClick={() => setModal("edit")}>Edit</Button>
          <Button variant="primary" onClick={() => setModal("deal")}>New deal</Button>
        </>} />
      {save.error && <p className="mb-3 text-sm text-critical">{(save.error as Error).message}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Contracted ARR" value={usd(a.carr)} sub={a.children.length ? `${usd(familyCarr)} incl. linked accounts` : undefined} />
        <StatTile label="Won one-time fees" value={usd(a.won_one_time)} />
        <StatTile label="Open pipeline" value={usd(a.open_pipeline)} sub={a.children.length ? `${usd(familyOpen)} incl. linked accounts` : `${a.open_deals} open deals`} />
        <StatTile label="Seat potential" value={a.employee_count ? usd(a.employee_count * 250, { compact: true }) : "Not set"} sub="Employees × $250 PEPY" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Land and expand" subtitle="Every deal with this account, in order.">
            {a.deals.length === 0 ? <Empty title="No deals yet" /> : (
              <ol className="relative space-y-3 border-l border-line pl-5">
                {a.deals.map((d) => (
                  <li key={d.id} className="relative">
                    <span aria-hidden className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-card"
                      style={{ background: d.stage === "closed_won" ? "var(--good)" : d.is_open ? "var(--series-1)" : "var(--text-muted)" }} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <Link to="/deals/$id" params={{ id: d.id }} className="text-sm font-medium text-ink hover:underline">{d.name}</Link>
                        <div className="text-xs text-ink-3">{label(d.motion)} · {label(d.offering)} · {d.owner_name ?? "Unassigned"}{d.closed_at ? ` · closed ${date(d.closed_at)}` : d.expected_close ? ` · close ${date(d.expected_close)}` : ""}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge stage={d.stage}>{label(d.stage)}</Badge>
                        <span className="text-sm font-semibold tabular">{usd(d.one_time_value + d.arr, { compact: true })}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          {a.children.length > 0 && (
            <Card title="Linked accounts" subtitle="Portfolio companies, subsidiaries, or client companies.">
              <ul className="divide-y divide-line">
                {a.children.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                    <Link to="/accounts/$id" params={{ id: c.id }} className="font-medium hover:underline">{c.name}</Link>
                    <span className="text-xs text-ink-3 tabular">{usd(c.carr)} cARR · {usd(c.open_pipeline)} open</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Activity">
            <ActivityComposer accountId={a.id} />
            {a.activities.length === 0 ? <div className="mt-4"><Empty title="No activity logged yet" /></div> : (
              <ul className="mt-4 divide-y divide-line">
                {a.activities.map((x) => (
                  <li key={x.id} className="py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3"><Badge>{label(x.type)}</Badge>{x.user_name} · {relative(x.occurred_at)}{x.deal_name && <> · {x.deal_name}</>}</div>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{x.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Contacts" action={<Button size="sm" onClick={() => { setContact(undefined); setModal("contact"); }}>Add</Button>}>
            {a.contacts.length === 0 ? <p className="text-sm text-ink-3">No contacts yet.</p> : (
              <ul className="space-y-3">
                {a.contacts.map((c) => (
                  <li key={c.id}>
                    <button className="text-left" onClick={() => { setContact(c); setModal("contact"); }}>
                      <span className="text-sm font-medium text-ink hover:underline">{c.name}</span>
                      {c.is_champion && <Badge className="ml-1.5">Champion</Badge>}
                    </button>
                    <div className="text-xs text-ink-3">{[c.title, c.email, c.phone].filter(Boolean).join(" · ")}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {(a.notes || a.website) && (
            <Card title="Notes">
              {a.website && <a href={a.website.startsWith("http") ? a.website : `https://${a.website}`} target="_blank" rel="noreferrer" className="text-sm text-[var(--series-1)] hover:underline">{a.website}</a>}
              {a.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-ink-2">{a.notes}</p>}
            </Card>
          )}
        </div>
      </div>

      <Modal open={modal === "edit"} onClose={() => setModal(null)} title="Edit account" wide><AccountForm account={a} onDone={() => setModal(null)} /></Modal>
      <Modal open={modal === "deal"} onClose={() => setModal(null)} title={`New deal with ${a.name}`} wide>
        <DealForm accountId={a.id} onDone={(dealId) => { setModal(null); navigate({ to: "/deals/$id", params: { id: dealId } }); }} />
      </Modal>
      <Modal open={modal === "contact"} onClose={() => setModal(null)} title={contact ? "Edit contact" : "Add contact"}>
        <ContactForm accountId={a.id} contact={contact} onDone={() => setModal(null)} />
      </Modal>
    </div>
  );
}
