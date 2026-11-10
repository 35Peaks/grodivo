import { useState, type FormEvent } from "react";
import { ACTIVITY_TYPES, MOTIONS, OFFERINGS, SEGMENTS, SOURCES, STAGES, label, usd } from "../lib/format";
import { useAccounts, useMeta, useSave } from "../lib/queries";
import type { Account, Contact, DealDetail } from "../lib/types";
import { Button, Field, Input, Loading, Select, Textarea } from "./ui";

const opts = (xs: readonly string[]) => xs.map((x) => ({ value: x, label: label(x) }));
const numOrNull = (v: string) => (v === "" ? null : Number(v));
const strOrNull = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? null : String(v).trim());

function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-md bg-muted-bg px-3 py-2 text-sm text-critical">{(error as Error).message}</p>;
}

export function DealForm({ deal, accountId, onDone }: { deal?: DealDetail; accountId?: string; onDone: (id: string) => void }) {
  const meta = useMeta();
  const accounts = useAccounts();
  const save = useSave<{ id: string }>();
  const [offering, setOffering] = useState(deal?.offering ?? "diagnostic");
  const [oneTime, setOneTime] = useState(String(deal?.one_time_value ?? (offering === "diagnostic" ? 35000 : 0)));
  const [pepy, setPepy] = useState(String(deal?.pepy_rate ?? 250));
  const [seats, setSeats] = useState(String(deal?.seats ?? 0));
  const [stage, setStage] = useState(deal?.stage ?? "lead");
  const arr = Number(pepy || 0) * Number(seats || 0);
  // Selects are uncontrolled: wait for their options so defaultValue sticks
  if (!meta.data || !accounts.data) return <Loading />;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const json = {
      account_id: f.get("account_id"), name: f.get("name"), owner_id: strOrNull(f.get("owner_id")),
      motion: f.get("motion"), offering, stage,
      one_time_value: Number(oneTime || 0), pepy_rate: Number(pepy || 0), seats: Number(seats || 0),
      probability: numOrNull(String(f.get("probability") ?? "")),
      expected_close: strOrNull(f.get("expected_close")), source: f.get("source"),
      partner_name: strOrNull(f.get("partner_name")), next_step: strOrNull(f.get("next_step")),
      next_step_date: strOrNull(f.get("next_step_date")), lost_reason: strOrNull(f.get("lost_reason")),
    };
    const res = await save.mutateAsync(deal ? { path: `/deals/${deal.id}`, method: "PATCH", json } : { path: "/deals", method: "POST", json });
    onDone(deal?.id ?? res.id);
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Deal name" className="sm:col-span-2"><Input name="name" required defaultValue={deal?.name} placeholder="e.g. Diligence on Target Co." /></Field>
      <Field label="Account">
        <Select name="account_id" required defaultValue={deal?.account_id ?? accountId ?? ""} placeholder="Select account…"
          options={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label="Owner">
        <Select name="owner_id" defaultValue={deal?.owner_id ?? meta.data?.me.id ?? ""}
          options={(meta.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} placeholder="Unassigned" />
      </Field>
      <Field label="Offering"><Select value={offering} onChange={(e) => setOffering(e.target.value)} options={opts(OFFERINGS)} /></Field>
      <Field label="Motion" hint="Land = first deal with the client. Expand = portcos, next deals, practice-wide.">
        <Select name="motion" defaultValue={deal?.motion ?? "land"} options={opts(MOTIONS)} />
      </Field>
      <Field label="Stage"><Select value={stage} onChange={(e) => setStage(e.target.value as any)} options={opts(STAGES)} /></Field>
      <Field label="Win probability %" hint={`Blank = stage default (${meta.data?.stageProbabilities.find((s) => s.stage === stage)?.probability ?? "?"}%)`}>
        <Input name="probability" type="number" min={0} max={100} defaultValue={deal?.probability ?? ""} />
      </Field>
      <fieldset className="rounded-lg border border-line p-3 sm:col-span-2">
        <legend className="px-1 text-xs font-medium text-ink-2">Value</legend>
        <div className="grid grid-cols-3 gap-3">
          <Field label="One-time fee ($)"><Input type="number" min={0} step="any" value={oneTime} onChange={(e) => setOneTime(e.target.value)} /></Field>
          <Field label="PEPY rate ($)"><Input type="number" min={0} step="any" value={pepy} onChange={(e) => setPepy(e.target.value)} /></Field>
          <Field label="Seats (employees)"><Input type="number" min={0} step={1} value={seats} onChange={(e) => setSeats(e.target.value)} /></Field>
        </div>
        <p className="mt-2 text-xs text-ink-3 tabular">ARR {usd(arr)} · first-year value {usd(arr + Number(oneTime || 0))}</p>
      </fieldset>
      <Field label="Expected close"><Input name="expected_close" type="date" defaultValue={deal?.expected_close ?? ""} /></Field>
      <Field label="Source"><Select name="source" defaultValue={deal?.source ?? "direct"} options={opts(SOURCES)} /></Field>
      <Field label="Partner / referrer" className="sm:col-span-2"><Input name="partner_name" defaultValue={deal?.partner_name ?? ""} /></Field>
      <Field label="Next step"><Input name="next_step" defaultValue={deal?.next_step ?? ""} /></Field>
      <Field label="Next step date"><Input name="next_step_date" type="date" defaultValue={deal?.next_step_date ?? ""} /></Field>
      {stage === "closed_lost" && (
        <Field label="Lost reason" className="sm:col-span-2"><Input name="lost_reason" defaultValue={deal?.lost_reason ?? ""} /></Field>
      )}
      <div className="sm:col-span-2"><FormError error={save.error} /></div>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>{deal ? "Save changes" : "Create deal"}</Button>
      </div>
    </form>
  );
}

export function AccountForm({ account, onDone }: { account?: Account; onDone: (id: string) => void }) {
  const meta = useMeta();
  const accounts = useAccounts();
  const save = useSave<{ id: string }>();
  if (!meta.data || !accounts.data) return <Loading />;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const json = {
      name: f.get("name"), segment: f.get("segment"), parent_account_id: strOrNull(f.get("parent_account_id")),
      industry: strOrNull(f.get("industry")), employee_count: numOrNull(String(f.get("employee_count") ?? "")),
      website: strOrNull(f.get("website")), hq_location: strOrNull(f.get("hq_location")),
      owner_id: strOrNull(f.get("owner_id")), notes: strOrNull(f.get("notes")),
    };
    const res = await save.mutateAsync(account ? { path: `/accounts/${account.id}`, method: "PATCH", json } : { path: "/accounts", method: "POST", json });
    onDone(account?.id ?? res.id);
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Account name" className="sm:col-span-2"><Input name="name" required defaultValue={account?.name} /></Field>
      <Field label="Segment"><Select name="segment" required defaultValue={account?.segment ?? "pe"} options={opts(SEGMENTS)} /></Field>
      <Field label="Parent account" hint="e.g. the PE firm that owns this portfolio company">
        <Select name="parent_account_id" defaultValue={account?.parent_account_id ?? ""} placeholder="None"
          options={(accounts.data ?? []).filter((a) => a.id !== account?.id).map((a) => ({ value: a.id, label: a.name }))} />
      </Field>
      <Field label="Industry"><Input name="industry" defaultValue={account?.industry ?? ""} /></Field>
      <Field label="Employees" hint="Drives PEPY seat potential"><Input name="employee_count" type="number" min={0} defaultValue={account?.employee_count ?? ""} /></Field>
      <Field label="Website"><Input name="website" defaultValue={account?.website ?? ""} /></Field>
      <Field label="HQ location"><Input name="hq_location" defaultValue={account?.hq_location ?? ""} /></Field>
      <Field label="Owner">
        <Select name="owner_id" defaultValue={account?.owner_id ?? meta.data?.me.id ?? ""} placeholder="Unassigned"
          options={(meta.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} />
      </Field>
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={account?.notes ?? ""} /></Field>
      <div className="sm:col-span-2"><FormError error={save.error} /></div>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>{account ? "Save changes" : "Create account"}</Button>
      </div>
    </form>
  );
}

export function ContactForm({ accountId, contact, onDone }: { accountId: string; contact?: Contact; onDone: () => void }) {
  const save = useSave();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const json = {
      account_id: accountId, name: f.get("name"), title: strOrNull(f.get("title")), email: strOrNull(f.get("email")),
      phone: strOrNull(f.get("phone")), linkedin_url: strOrNull(f.get("linkedin_url")),
      is_champion: f.get("is_champion") === "on", notes: strOrNull(f.get("notes")),
    };
    await save.mutateAsync(contact ? { path: `/contacts/${contact.id}`, method: "PATCH", json } : { path: "/contacts", method: "POST", json });
    onDone();
  }
  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="Name"><Input name="name" required defaultValue={contact?.name} /></Field>
      <Field label="Title"><Input name="title" defaultValue={contact?.title ?? ""} /></Field>
      <Field label="Email"><Input name="email" type="email" defaultValue={contact?.email ?? ""} /></Field>
      <Field label="Phone"><Input name="phone" defaultValue={contact?.phone ?? ""} /></Field>
      <Field label="LinkedIn URL" className="sm:col-span-2"><Input name="linkedin_url" defaultValue={contact?.linkedin_url ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm text-ink-2 sm:col-span-2">
        <input type="checkbox" name="is_champion" defaultChecked={contact?.is_champion} /> Champion / economic buyer
      </label>
      <Field label="Notes" className="sm:col-span-2"><Textarea name="notes" defaultValue={contact?.notes ?? ""} /></Field>
      <div className="sm:col-span-2"><FormError error={save.error} /></div>
      <div className="flex justify-end sm:col-span-2"><Button type="submit" variant="primary" disabled={save.isPending}>Save contact</Button></div>
    </form>
  );
}

export function ActivityComposer({ dealId, accountId }: { dealId?: string; accountId?: string }) {
  const save = useSave();
  const [type, setType] = useState("call");
  const [summary, setSummary] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!summary.trim()) return;
    await save.mutateAsync({ path: "/activities", method: "POST", json: { deal_id: dealId, account_id: accountId, type, summary } });
    setSummary("");
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <Select aria-label="Activity type" value={type} onChange={(e) => setType(e.target.value)} options={opts(ACTIVITY_TYPES)} className="sm:w-32" />
      <Input aria-label="What happened" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Log a call, meeting, or note…" />
      <Button type="submit" variant="primary" disabled={save.isPending || !summary.trim()}>Log</Button>
    </form>
  );
}
