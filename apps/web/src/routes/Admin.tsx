import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select } from "../components/ui";
import { api } from "../lib/api";
import { authDisabled } from "../lib/auth";
import { date, label, usd } from "../lib/format";
import { useMeta, useSave } from "../lib/queries";
import type { AdminUser, Quota } from "../lib/types";

const ROLE_OPTS = ["rep", "manager", "admin"].map((r) => ({ value: r, label: label(r) }));

function Users() {
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<AdminUser[]>("/admin/users"), enabled: !authDisabled });
  const save = useSave();
  const [msg, setMsg] = useState<string | null>(null);
  async function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await save.mutateAsync({ path: "/admin/users", method: "POST", json: { name: f.get("name"), email: f.get("email"), role: f.get("role") } });
    setMsg(`Invitation sent to ${f.get("email")}. They'll get a temporary password by email.`);
    form.reset();
  }
  async function setEnabled(u: AdminUser, enabled: boolean) {
    await save.mutateAsync({ path: `/admin/users/${encodeURIComponent(u.username)}`, method: "PATCH", json: { enabled } });
    await save.mutateAsync({ path: `/settings/users/${u.id}`, method: "PATCH", json: { active: enabled } }).catch(() => {});
  }
  return (
    <Card title="Team members" subtitle="Invite-only. New users receive a temporary password and set their own on first sign-in.">
      <form onSubmit={invite} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
        <Field label="Name"><Input name="name" required /></Field>
        <Field label="Email"><Input name="email" type="email" required /></Field>
        <Field label="Role"><Select name="role" defaultValue="rep" options={ROLE_OPTS} /></Field>
        <Button type="submit" variant="primary" disabled={save.isPending}>Send invite</Button>
      </form>
      {msg && <p className="mt-2 text-sm text-good">{msg}</p>}
      {save.error && <p className="mt-2 text-sm text-critical">{(save.error as Error).message}</p>}
      {authDisabled ? <p className="mt-4 text-sm text-ink-3">User management needs Cognito (not available in local mode).</p>
        : users.isLoading ? <Loading /> : users.error ? <div className="mt-4"><ErrorBox error={users.error} /></div> : (
        <table className="mt-5 w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-3">
            <th className="py-2 font-medium">Name</th><th className="py-2 font-medium">Email</th><th className="py-2 font-medium">Role</th>
            <th className="py-2 font-medium">Status</th><th className="py-2" /></tr></thead>
          <tbody className="divide-y divide-line">
            {users.data!.map((u) => (
              <tr key={u.username} className={u.enabled ? "" : "opacity-60"}>
                <td className="py-2 font-medium">{u.name}</td>
                <td className="py-2 text-ink-2">{u.email}</td>
                <td className="py-2">
                  <select aria-label={`Role for ${u.name}`} value={u.role} className="rounded border border-line bg-card px-1.5 py-0.5 text-sm"
                    onChange={(e) => save.mutate({ path: `/admin/users/${encodeURIComponent(u.username)}`, method: "PATCH", json: { role: e.target.value } })}>
                    {ROLE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </td>
                <td className="py-2"><Badge>{!u.enabled ? "Disabled" : u.status === "FORCE_CHANGE_PASSWORD" ? "Invited" : "Active"}</Badge></td>
                <td className="py-2 text-right">
                  <Button size="sm" variant={u.enabled ? "danger" : "secondary"} onClick={() => setEnabled(u, !u.enabled)}>{u.enabled ? "Disable" : "Enable"}</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs text-ink-3">Role changes take effect the next time the person signs in.</p>
    </Card>
  );
}

function Quotas() {
  const meta = useMeta();
  const quotas = useQuery({ queryKey: ["quotas"], queryFn: () => api<Quota[]>("/settings/quotas") });
  const save = useSave();
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await save.mutateAsync({ path: "/settings/quotas", method: "POST", json: {
      user_id: f.get("user_id") || null, period_start: f.get("period_start"), period_end: f.get("period_end"),
      target_arr: Number(f.get("target_arr") || 0), target_bookings: Number(f.get("target_bookings") || 0) } });
    form.reset();
  }
  return (
    <Card title="Targets and quotas" subtitle="Leave the person blank for the company-wide target shown on the Overview.">
      <form onSubmit={add} className="grid grid-cols-2 gap-3 lg:grid-cols-6 lg:items-end">
        <Field label="Person"><Select name="user_id" placeholder="Company target" options={(meta.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} /></Field>
        <Field label="Start"><Input name="period_start" type="date" required /></Field>
        <Field label="End"><Input name="period_end" type="date" required /></Field>
        <Field label="ARR target ($)"><Input name="target_arr" type="number" min={0} required /></Field>
        <Field label="One-time fees target ($)"><Input name="target_bookings" type="number" min={0} /></Field>
        <Button type="submit" variant="primary" disabled={save.isPending}>Save target</Button>
      </form>
      {save.error && <p className="mt-2 text-sm text-critical">{(save.error as Error).message}</p>}
      {quotas.data && (
        <table className="mt-5 w-full text-sm">
          <thead><tr className="border-b border-line text-left text-xs text-ink-3">
            <th className="py-2 font-medium">Who</th><th className="py-2 font-medium">Period</th>
            <th className="py-2 text-right font-medium">ARR</th><th className="py-2 text-right font-medium">One-time</th><th /></tr></thead>
          <tbody className="divide-y divide-line">
            {quotas.data.map((q) => (
              <tr key={q.id}>
                <td className="py-2">{q.user_name ?? <span className="font-medium">Company</span>}</td>
                <td className="py-2 text-ink-2">{date(q.period_start)} to {date(q.period_end)}</td>
                <td className="py-2 text-right tabular">{usd(q.target_arr)}</td>
                <td className="py-2 text-right tabular">{usd(q.target_bookings)}</td>
                <td className="py-2 text-right"><Button size="sm" variant="ghost" onClick={() => save.mutate({ path: `/settings/quotas/${q.id}`, method: "DELETE" })}>Remove</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function StageProbabilities() {
  const meta = useMeta();
  const save = useSave();
  const [vals, setVals] = useState<Record<string, number>>({});
  const rows = meta.data?.stageProbabilities ?? [];
  return (
    <Card title="Stage probabilities" subtitle="Default win probability used for weighted pipeline. Individual deals can override.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        {rows.map((s) => (
          <Field key={s.stage} label={label(s.stage)}>
            <Input type="number" min={0} max={100} value={vals[s.stage] ?? s.probability}
              onChange={(e) => setVals((v) => ({ ...v, [s.stage]: Number(e.target.value) }))} />
          </Field>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="primary" disabled={!Object.keys(vals).length || save.isPending} onClick={async () => {
          await save.mutateAsync({ path: "/settings/stage-probabilities", method: "PUT",
            json: rows.map((s) => ({ stage: s.stage, probability: vals[s.stage] ?? s.probability })) });
          setVals({});
        }}>Save probabilities</Button>
      </div>
    </Card>
  );
}

export function Admin() {
  const meta = useMeta();
  if (meta.data?.me.role !== "admin") return <ErrorBox error={new Error("Admins only")} />;
  return (
    <div className="space-y-4">
      <PageHeader title="Admin" subtitle="Team access, targets, and forecast settings." />
      <Users />
      <Quotas />
      <StageProbabilities />
    </div>
  );
}
