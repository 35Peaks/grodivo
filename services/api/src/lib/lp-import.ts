// Pension Signal Monitor export -> lp_signals rows.
const GROUPS: [RegExp, string][] = [
  [/venture/i, "venture"],
  [/private equity|buyout|growth equity|\bpe\b/i, "private_equity"],
  [/private credit|private debt|direct lending|credit/i, "private_credit"],
  [/infrastructure|infra\b|energy|natural resources|real assets/i, "infrastructure"],
  [/real estate|\bre\b|property/i, "real_estate"],
  [/hedge|absolute return/i, "hedge_funds"],
  [/public equity|fixed income|equity|bond|cash/i, "public"],
];
export function assetGroup(assetClass: string | null | undefined): string {
  if (!assetClass) return "other";
  for (const [re, g] of GROUPS) if (re.test(assetClass)) return g;
  return "other";
}

const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const month = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? `${v.slice(0, 7)}-01` : null);
const txt = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));

export function toLpSignal(r: Record<string, unknown>) {
  const amount = Number(r.amount_usd_m);
  return {
    signal_key: String(r.signal_key),
    period: txt(r.period), event_month: month(r.event_date) ?? month(r.period),
    signal_category: txt(r.signal_category), signal_type: txt(r.signal_type), asset_class: txt(r.asset_class),
    asset_group: assetGroup(txt(r.asset_class)),
    plan: txt(r.plan), plan_type: txt(r.plan_type), state: txt(r.state), region: txt(r.region), aum_tier: txt(r.aum_tier),
    counterparty: txt(r.counterparty), manager_family: txt(r.manager_family), manager_entity: txt(r.manager_entity),
    amount_usd_m: r.amount_usd_m !== null && r.amount_usd_m !== undefined && Number.isFinite(amount) ? amount : null,
    relevance: txt(r.relevance), action_detail: txt(r.action_detail), source_snippet: txt(r.source_snippet),
    source_name: txt(r.source_name), source_title: txt(r.source_title), source_url: txt(r.source_url),
    source_type: txt(r.source_type) ?? "secondary", doc_type: txt(r.doc_type), doc_date: date(r.doc_date),
    retrieved_at: date(r.retrieved_at), raw: r,
  };
}

const COLS = ["signal_key", "period", "event_month", "signal_category", "signal_type", "asset_class", "asset_group", "plan",
  "plan_type", "state", "region", "aum_tier", "counterparty", "manager_family", "manager_entity", "amount_usd_m", "relevance",
  "action_detail", "source_snippet", "source_name", "source_title", "source_url", "source_type", "doc_type", "doc_date",
  "retrieved_at", "raw"] as const;

/** Upserts on signal_key so re-exports refresh records (e.g. after entity reconciliation). */
export async function upsertLpSignals(client: { query: (q: string, v: unknown[]) => Promise<any> }, rows: Record<string, unknown>[]) {
  let n = 0;
  for (const raw of rows) {
    if (!raw?.signal_key) continue;
    const r = toLpSignal(raw) as Record<string, unknown>;
    const vals = COLS.map((c) => (c === "raw" ? JSON.stringify(r.raw) : r[c]));
    await client.query(
      `INSERT INTO lp_signals (${COLS.join(", ")}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (signal_key) DO UPDATE SET ${COLS.filter((c) => c !== "signal_key").map((c) => `${c} = EXCLUDED.${c}`).join(", ")}, imported_at = now()`,
      vals);
    n++;
  }
  return n;
}
