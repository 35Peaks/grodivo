import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Badge, Button, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader, SegmentDot, Select, Textarea, cx } from "../components/ui";
import { SEGMENTS, SEGMENT_COLOR, SIGNAL_DEAL_STATUSES, SIGNAL_TYPES, date, label, relative, usd, type Segment } from "../lib/format";
import { useAccounts, useSave, useSignalSummary, useSignals } from "../lib/queries";
import type { Signal, SignalProspect } from "../lib/types";

const TABS = [
  { value: "new", label: "New" },
  { value: "watching", label: "Watching" },
  { value: "actioned", label: "Actioned" },
  { value: "dismissed", label: "Dismissed" },
  { value: "archived", label: "Archive" },
] as const;

const DISMISS_REASONS = ["Not a fit for Grodivo", "Too small", "Already closed and integrated", "Duplicate", "Not a real deal"];

function FitScore({ score }: { score: number }) {
  return (
    <div className="w-14 shrink-0 text-center" title={`Fit score ${score} of 100`}>
      <div className={cx("text-xl font-semibold tabular", score >= 70 ? "text-ink" : "text-ink-2")}>{score}</div>
      <div className="mx-auto mt-1 h-1.5 w-10 rounded-full bg-muted-bg">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: "var(--seq-strong)" }} />
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-wide text-ink-3">Fit</div>
    </div>
  );
}

const FIELD_LABEL: Record<string, string> = {
  deal_status: "Status", deal_value_usd_m: "Value ($M)", expected_close: "Expected close", closed_on: "Closed",
  price_per_share: "Price/share", premium_pct: "Premium %", target_employees: "Target employees",
  acquirer_employees: "Buyer employees", consideration: "Consideration", approvals: "Approvals", financing: "Financing", sponsor: "Sponsor",
};

function DealFacts({ s }: { s: Signal }) {
  const facts: [string, string][] = [];
  if (s.target_employees != null) facts.push(["Target employees", s.target_employees.toLocaleString()]);
  if (s.expected_close) facts.push(["Expected close", date(s.expected_close)]);
  if (s.closed_on) facts.push(["Closed", date(s.closed_on)]);
  if (s.consideration && s.consideration !== "unknown") facts.push(["Consideration", s.consideration]);
  if (s.price_per_share != null) facts.push(["Price/share", `$${s.price_per_share}`]);
  if (s.premium_pct != null) facts.push(["Premium", `${s.premium_pct}%`]);
  if (s.approvals) facts.push(["Approvals", s.approvals]);
  if (s.financing) facts.push(["Financing", s.financing]);
  const tickers = [s.acquirer_ticker, s.target_ticker].filter(Boolean).join(" / ");
  if (tickers) facts.push(["Tickers", tickers]);
  for (const [k, v] of Object.entries(s.terms ?? {})) if (v != null && v !== "") facts.push([k.replace(/_/g, " "), String(v)]);
  if (!facts.length) return null;
  return (
    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {facts.map(([k, v]) => <div key={k} className="flex gap-1"><dt className="text-ink-3">{k}</dt><dd className="text-ink">{v}</dd></div>)}
    </dl>
  );
}

function SignalCard({ s, onAdd, onDismiss }: { s: Signal; onAdd: (s: Signal, p?: SignalProspect) => void; onDismiss: (s: Signal) => void }) {
  const save = useSave();
  const [showSources, setShowSources] = useState(false);
  const primary = s.sources[0];
  const act = (action: string) => save.mutate({ path: `/signals/${s.id}/actions`, method: "POST", json: { action } });
  const inCrm = new Set(s.matched_accounts.map((a) => a.name.toLowerCase()));

  return (
    <article className="rounded-xl border border-line bg-card p-5">
      <div className="flex gap-4">
        <FitScore score={s.fit_score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge stage={s.deal_status === "announced" || s.deal_status === "pending" ? "pilot" : undefined}>{label(s.deal_status)}</Badge>
            <Badge>{label(s.deal_type)}</Badge>
            {s.deal_value_usd_m != null && <Badge>{usd(s.deal_value_usd_m * 1e6, { compact: true })}</Badge>}
            {s.sector && <span className="text-xs text-ink-3">{s.sector}{s.region ? ` · ${s.region}` : ""}</span>}
          </div>
          <h3 className="mt-1.5 text-base font-semibold leading-snug text-ink">
            {primary ? <a href={primary.url} target="_blank" rel="noreferrer" className="hover:underline">{s.headline}</a> : s.headline}
          </h3>
          <p className="mt-0.5 text-sm text-ink-2">
            {[s.acquirer && <span key="a"><span className="text-ink-3">Buyer</span> {s.acquirer}</span>,
              s.target && <span key="t"><span className="text-ink-3">Target</span> {s.target}</span>,
              s.sponsor && <span key="s"><span className="text-ink-3">Sponsor</span> {s.sponsor}</span>]
              .filter(Boolean).reduce<React.ReactNode[]>((acc, el, i) => (i ? [...acc, <span key={`d${i}`} className="text-ink-3"> · </span>, el] : [el]), [])}
          </p>
          <DealFacts s={s} />
          {s.why_grodivo && (
            <p className="mt-3 rounded-lg bg-muted-bg px-3 py-2 text-sm text-ink"><span className="font-medium">Why Grodivo: </span>{s.why_grodivo}</p>
          )}

          {s.prospects.length > 0 && s.status !== "actioned" && s.status !== "dismissed" && (
            <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
              {s.prospects.map((p) => (
                <li key={p.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium text-ink">
                      <SegmentDot color={SEGMENT_COLOR[p.segment]} />{p.name}
                      <span className="text-xs font-normal text-ink-3">{label(p.role)} · {label(p.segment)}</span>
                      {inCrm.has(p.name.toLowerCase()) && <Badge stage="closed_won">In CRM</Badge>}
                    </div>
                    {p.angle && <p className="mt-0.5 text-xs text-ink-2">{p.angle}</p>}
                  </div>
                  <Button size="sm" variant="primary" onClick={() => onAdd(s, p)}>Add to pipeline</Button>
                </li>
              ))}
            </ul>
          )}

          {s.advisors.length > 0 && (
            <p className="mt-2 text-xs text-ink-2"><span className="text-ink-3">Advisors: </span>{s.advisors.map((a) => a.role ? `${a.name} (${a.role})` : a.name).join(", ")}</p>
          )}
          {s.matched_accounts.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">Already in accounts:
              {s.matched_accounts.map((a) => (
                <Link key={a.id} to="/accounts/$id" params={{ id: a.id }} className="rounded bg-muted-bg px-1.5 py-0.5 text-ink hover:underline">{a.name}</Link>
              ))}
            </p>
          )}
          {s.links.length > 0 && (
            <p className="mt-2 text-xs text-good">
              Added to pipeline{s.actioned_by_name ? ` by ${s.actioned_by_name}` : ""}: {s.links.map((l, i) => (
                <span key={i}>{i > 0 && ", "}{l.deal_id ? <Link to="/deals/$id" params={{ id: l.deal_id }} className="underline">{l.account_name}</Link>
                  : l.account_id ? <Link to="/accounts/$id" params={{ id: l.account_id }} className="underline">{l.account_name}</Link> : l.account_name}</span>
              ))}
            </p>
          )}
          {s.status === "dismissed" && s.status_note && <p className="mt-2 text-xs text-ink-3">Dismissed: {s.status_note}</p>}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <button className="text-xs text-ink-3 hover:text-ink" onClick={() => setShowSources((v) => !v)}>
              {s.sources.length} source{s.sources.length === 1 ? "" : "s"}{s.events.length > 1 ? ` · ${s.events.length - 1} update${s.events.length > 2 ? "s" : ""}` : ""} · first seen {relative(s.first_seen_at)}{s.announced_on ? ` · announced ${date(s.announced_on)}` : ""}
            </button>
            <div className="flex flex-wrap gap-1.5">
              {s.status === "new" && <Button size="sm" variant="ghost" onClick={() => act("watch")}>Watch</Button>}
              {(s.status === "new" || s.status === "watching" || s.status === "archived") && <>
                <Button size="sm" onClick={() => onAdd(s)}>Add other company…</Button>
                <Button size="sm" variant="ghost" onClick={() => onDismiss(s)}>Dismiss</Button>
              </>}
              {(s.status === "dismissed" || s.status === "watching" || s.status === "archived") && <Button size="sm" variant="ghost" onClick={() => act("reopen")}>Move to New</Button>}
            </div>
          </div>
          {showSources && s.events.filter((e) => e.field !== "created").length > 0 && (
            <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
              {s.events.filter((e) => e.field !== "created").map((e, i) => (
                <li key={i} className="flex gap-2 text-ink-2">
                  <span className="w-28 shrink-0 text-ink-3">{date(e.at)}</span>
                  <span>{FIELD_LABEL[e.field] ?? e.field}: {e.old_value ? `${label(e.old_value)} → ` : ""}<span className="text-ink">{label(e.new_value)}</span></span>
                </li>
              ))}
            </ul>
          )}
          {showSources && (
            <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
              {s.sources.map((src) => (
                <li key={src.url} className="flex gap-2">
                  <span className="w-28 shrink-0 text-ink-3">{label(src.origin)}</span>
                  <a href={src.url} target="_blank" rel="noreferrer" className="truncate text-[var(--series-1)] hover:underline">{src.title || src.url}</a>
                  {src.publisher && <span className="shrink-0 text-ink-3">{src.publisher}</span>}
                </li>
              ))}
            </ul>
          )}
          {save.error && <p className="mt-2 text-xs text-critical">{(save.error as Error).message}</p>}
        </div>
      </div>
    </article>
  );
}

function AddToPipeline({ signal, prospect, onDone }: { signal: Signal; prospect?: SignalProspect; onDone: () => void }) {
  const accounts = useAccounts();
  const save = useSave<{ account_id: string; deal_id: string | null; created_account: boolean }>();
  const navigate = useNavigate();
  const match = prospect && signal.matched_accounts.find((a) => a.name.toLowerCase() === prospect.name.toLowerCase());
  const [accountId, setAccountId] = useState(match?.id ?? "");
  const [createDeal, setCreateDeal] = useState(true);
  if (!accounts.data) return <Loading />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const picked = accounts.data!.find((a) => a.id === accountId);
    const res = await save.mutateAsync({ path: `/signals/${signal.id}/actions`, method: "POST", json: {
      action: "add_prospect",
      name: picked?.name ?? String(f.get("name") ?? "").trim(),
      segment: picked?.segment ?? f.get("segment"),
      role: f.get("role") || null, angle: f.get("angle") || null,
      account_id: accountId || null, create_deal: createDeal,
    } });
    onDone();
    if (res.deal_id) navigate({ to: "/deals/$id", params: { id: res.deal_id } });
    else navigate({ to: "/accounts/$id", params: { id: res.account_id } });
  }

  const parties = [signal.acquirer, signal.target, signal.sponsor, ...signal.advisors.map((a) => a.name)].filter(Boolean) as string[];
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <p className="text-sm text-ink-2 sm:col-span-2">{signal.headline}</p>
      <Field label="Use an existing account" className="sm:col-span-2" hint="Leave as 'Create new account' to add the company below.">
        <Select value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Create new account"
          options={accounts.data.map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      {!accountId && <>
        <Field label="Company">
          <Input name="name" required defaultValue={prospect?.name ?? ""} list="signal-parties" />
          <datalist id="signal-parties">{parties.map((p) => <option key={p} value={p} />)}</datalist>
        </Field>
        <Field label="Segment">
          <Select name="segment" defaultValue={prospect?.segment ?? "corporate_ma"} options={SEGMENTS.map((s) => ({ value: s, label: label(s) }))} />
        </Field>
      </>}
      <Field label="Their role in the deal">
        <Select name="role" defaultValue={prospect?.role ?? "acquirer"} options={["acquirer", "sponsor", "target", "advisor"].map((r) => ({ value: r, label: label(r) }))} />
      </Field>
      <label className="flex items-end gap-2 pb-2 text-sm text-ink-2">
        <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} /> Create a lead-stage deal ($35K diagnostic)
      </label>
      <Field label="Outreach angle" className="sm:col-span-2"><Textarea name="angle" defaultValue={prospect?.angle ?? signal.why_grodivo ?? ""} /></Field>
      {save.error && <p className="text-sm text-critical sm:col-span-2">{(save.error as Error).message}</p>}
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" disabled={save.isPending}>Add to pipeline</Button></div>
    </form>
  );
}

function DismissForm({ signal, onDone }: { signal: Signal; onDone: () => void }) {
  const save = useSave();
  const [reason, setReason] = useState(DISMISS_REASONS[0]!);
  const [other, setOther] = useState("");
  return (
    <form className="space-y-3" onSubmit={async (e) => {
      e.preventDefault();
      await save.mutateAsync({ path: `/signals/${signal.id}/actions`, method: "POST", json: { action: "dismiss", note: reason === "Other" ? other : reason } });
      onDone();
    }}>
      <p className="text-sm text-ink-2">{signal.headline}</p>
      <div className="space-y-1.5">
        {[...DISMISS_REASONS, "Other"].map((r) => (
          <label key={r} className="flex items-center gap-2 text-sm"><input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />{r}</label>
        ))}
      </div>
      {reason === "Other" && <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Reason" required />}
      <p className="text-xs text-ink-3">Reasons help tune what the feed surfaces.</p>
      <div className="flex justify-end"><Button type="submit" variant="primary" disabled={save.isPending}>Dismiss</Button></div>
    </form>
  );
}

function ManualSignal({ onDone }: { onDone: () => void }) {
  const save = useSave();
  return (
    <form className="grid grid-cols-1 gap-4 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const v = (k: string) => (String(f.get(k) ?? "").trim() || null);
      await save.mutateAsync({ path: "/signals", method: "POST", json: {
        headline: v("headline"), acquirer: v("acquirer"), target: v("target"), sponsor: v("sponsor"),
        deal_type: v("deal_type"), deal_status: v("deal_status"), why_grodivo: v("why_grodivo"),
        deal_value_usd_m: v("value") ? Number(v("value")) : null,
        source: { url: v("url"), publisher: null, title: v("headline"), published_at: null },
      } });
      onDone();
    }}>
      <Field label="Headline" className="sm:col-span-2"><Input name="headline" required minLength={5} /></Field>
      <Field label="Source link" className="sm:col-span-2"><Input name="url" type="url" required placeholder="https://" /></Field>
      <Field label="Buyer"><Input name="acquirer" /></Field>
      <Field label="Target"><Input name="target" /></Field>
      <Field label="PE sponsor"><Input name="sponsor" /></Field>
      <Field label="Value ($M)"><Input name="value" type="number" min={0} step="any" /></Field>
      <Field label="Deal type"><Select name="deal_type" defaultValue="corporate_acquisition" options={SIGNAL_TYPES.map((t) => ({ value: t, label: label(t) }))} /></Field>
      <Field label="Status"><Select name="deal_status" defaultValue="announced" options={SIGNAL_DEAL_STATUSES.map((t) => ({ value: t, label: label(t) }))} /></Field>
      <Field label="Why Grodivo" className="sm:col-span-2"><Textarea name="why_grodivo" /></Field>
      {save.error && <p className="text-sm text-critical sm:col-span-2">{(save.error as Error).message}</p>}
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" disabled={save.isPending}>Add signal</Button></div>
    </form>
  );
}

export function Signals() {
  const search = useSearch({ from: "/app/signals" });
  const navigate = useNavigate({ from: "/signals" });
  const status = search.status ?? "new";
  const f = { status, type: search.type, deal_status: search.deal_status, segment: search.segment, min_fit: search.min_fit, q: search.q };
  const list = useSignals(f);
  const summary = useSignalSummary();
  const [text, setText] = useState(search.q ?? "");
  const [adding, setAdding] = useState<{ s: Signal; p?: SignalProspect } | null>(null);
  const [dismissing, setDismissing] = useState<Signal | null>(null);
  const [manual, setManual] = useState(false);
  const set = (k: string, v: string) => navigate({ search: (s: any) => ({ ...s, [k]: v || undefined }) });
  const lastRun = summary.data?.runs.reduce<string | null>((m, r) => (!m || r.started_at > m ? r.started_at : m), null);

  return (
    <div>
      <PageHeader title="M&A signals"
        subtitle={<>Deals in the news that open a Grodivo conversation. Refreshed weekday mornings{lastRun ? `; last update ${relative(lastRun)}` : ""}.</>}
        actions={<Button onClick={() => setManual(true)}>Add a deal you heard about</Button>} />

      <div className="mb-4 flex flex-wrap items-center gap-1 border-b border-line">
        {TABS.map((t) => {
          const n = t.value === "new" ? summary.data?.new : t.value === "watching" ? summary.data?.watching : undefined;
          return (
            <button key={t.value} onClick={() => set("status", t.value === "new" ? "" : t.value)}
              className={cx("-mb-px border-b-2 px-3 py-2 text-sm", status === t.value ? "border-[var(--accent)] font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink")}>
              {t.label}{n ? <span className="ml-1.5 rounded bg-muted-bg px-1.5 text-xs tabular">{n}</span> : null}
            </button>
          );
        })}
      </div>

      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); set("q", text); }}>
        <Input aria-label="Search signals" placeholder="Search company or headline…" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => set("q", text)} className="w-60" />
        <Select aria-label="Fit" value={search.min_fit ?? ""} onChange={(e) => set("min_fit", e.target.value)} placeholder="Any fit"
          options={[{ value: "70", label: "Fit 70+" }, { value: "50", label: "Fit 50+" }]} className="w-28" />
        <Select aria-label="Segment" value={search.segment ?? ""} onChange={(e) => set("segment", e.target.value)} placeholder="All segments"
          options={SEGMENTS.map((s) => ({ value: s, label: label(s) }))} className="w-48" />
        <Select aria-label="Deal type" value={search.type ?? ""} onChange={(e) => set("type", e.target.value)} placeholder="Any deal type"
          options={SIGNAL_TYPES.map((s) => ({ value: s, label: label(s) }))} className="w-48" />
        <Select aria-label="Deal status" value={search.deal_status ?? ""} onChange={(e) => set("deal_status", e.target.value)} placeholder="Any status"
          options={SIGNAL_DEAL_STATUSES.map((s) => ({ value: s, label: label(s) }))} className="w-40" />
      </form>

      {list.isLoading ? <Loading /> : list.error ? <ErrorBox error={list.error} /> : list.data!.length === 0 ? (
        <Empty title={status === "new" ? "No new signals" : `No ${status} signals`}>
          {status === "new" ? "New deals arrive each weekday morning. Check Watching for deals you're tracking."
            : status === "archived" ? "Older deals imported from the 35 Peaks digests appear here." : "Try clearing a filter."}
        </Empty>
      ) : (
        <div className={cx("space-y-3", list.isFetching && "opacity-70")}>
          {list.data!.map((s) => <SignalCard key={s.id} s={s} onAdd={(sig, p) => setAdding({ s: sig, p })} onDismiss={setDismissing} />)}
        </div>
      )}

      {summary.data && summary.data.runs.length > 0 && (
        <p className="mt-6 text-xs text-ink-3">
          Feed health: {summary.data.runs.map((r) => `${label(r.origin)} ${relative(r.started_at)} (${r.created} new, ${r.merged} merged)`).join(" · ")}
        </p>
      )}

      <Modal open={!!adding} onClose={() => setAdding(null)} title={adding?.p ? `Add ${adding.p.name} to pipeline` : "Add a company to pipeline"} wide>
        {adding && <AddToPipeline signal={adding.s} prospect={adding.p} onDone={() => setAdding(null)} />}
      </Modal>
      <Modal open={!!dismissing} onClose={() => setDismissing(null)} title="Dismiss signal">
        {dismissing && <DismissForm signal={dismissing} onDone={() => setDismissing(null)} />}
      </Modal>
      <Modal open={manual} onClose={() => setManual(false)} title="Add a deal" wide>
        {manual && <ManualSignal onDone={() => setManual(false)} />}
      </Modal>
    </div>
  );
}

export type { Segment };
