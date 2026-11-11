// Shared signal model: validation, normalization, dedupe and the Postgres upsert.
import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { segments } from "./validate.js";

export const dealStatuses = ["rumored", "announced", "pending", "closed", "terminated", "unknown"] as const;
export const dealTypes = ["pe_platform", "pe_add_on", "corporate_acquisition", "merger", "take_private", "carve_out", "other"] as const;
export const origins = ["fmp", "gdelt", "claude_research", "manual", "digest"] as const;
export type Origin = (typeof origins)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null);
const int = z.coerce.number().int().min(0).max(10_000_000).nullish().catch(null);
const str = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const loose = <T extends readonly [string, ...string[]]>(vals: T, fallback: T[number]) =>
  z.string().nullish().transform((v) => ((vals as readonly string[]).includes(String(v)) ? (v as T[number]) : fallback));

export const signalInput = z.object({
  headline: z.string().trim().min(5).max(400),
  summary: str(2000),
  deal_status: loose(dealStatuses, "unknown"),
  deal_type: loose(dealTypes, "other"),
  acquirer: str(200),
  target: str(200),
  sponsor: str(200),
  advisors: z.array(z.object({ name: z.string().trim().min(1).max(200), role: str(100) })).max(20).catch([]).default([]),
  deal_value_usd_m: z.coerce.number().min(0).max(5_000_000).nullish().catch(null),
  sector: str(120),
  region: str(120),
  announced_on: isoDate,
  acquirer_ticker: str(20),
  target_ticker: str(20),
  acquirer_hq: str(120),
  target_hq: str(120),
  target_employees: int,
  acquirer_employees: int,
  consideration: str(40),
  price_per_share: z.coerce.number().min(0).max(1e7).nullish().catch(null),
  premium_pct: z.coerce.number().min(-100).max(10_000).nullish().catch(null),
  expected_close: isoDate,
  closed_on: isoDate,
  financing: str(500),
  approvals: str(500),
  terms: z.record(z.string(), z.unknown()).catch({}).default({}),
  fit_score: z.coerce.number().int().min(0).max(100).catch(0).default(0),
  why_grodivo: str(1000),
  prospects: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    role: str(60),
    segment: loose(segments, "corporate_ma"),
    angle: str(500),
  })).max(6).catch([]).default([]),
  source: z.object({
    url: z.string().trim().url().max(2000),
    publisher: str(200),
    title: str(400),
    published_at: z.string().datetime({ offset: true }).nullish().catch(null),
    raw: z.unknown().optional(),                 // original record from the provider, stored verbatim
  }),
}).passthrough();                              // keep any extra fields Claude returns in `extracted`
export type SignalInput = z.infer<typeof signalInput>;

/** Validates a batch, dropping (not failing on) malformed items. */
export function parseSignals(raw: unknown): { items: SignalInput[]; rejected: number } {
  const arr = Array.isArray(raw) ? raw : [];
  const items: SignalInput[] = [];
  let rejected = 0;
  for (const r of arr) {
    const p = signalInput.safeParse(r);
    if (p.success) items.push(p.data);
    else rejected++;
  }
  return { items, rejected };
}

const SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp", "lp", "ltd", "limited", "plc",
  "holdings", "holding", "group", "sa", "ag", "nv", "se", "spa", "the", "and",
]);

/** "The Acme Holdings, Inc." -> "acme" */
export function normalizeCompany(name: string | null | undefined): string {
  if (!name) return "";
  const words = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const kept = words.filter((w) => !SUFFIXES.has(w));
  return (kept.length ? kept : words).join(" ");
}

export function dedupeKey(s: Pick<SignalInput, "acquirer" | "target" | "source">): string {
  const a = normalizeCompany(s.acquirer);
  const t = normalizeCompany(s.target);
  if (a && t) return `${a}|${t}`;
  return "url:" + createHash("sha1").update(s.source.url).digest("hex");
}

const STATUS_RANK: Record<string, number> = { unknown: 0, rumored: 1, announced: 2, pending: 3, closed: 4, terminated: 4 };

// Facts that can change as a deal progresses: newest reported value wins, and every change is logged.
const TRACKED = ["deal_value_usd_m", "expected_close", "closed_on", "price_per_share", "premium_pct",
  "target_employees", "acquirer_employees", "consideration", "approvals", "financing", "sponsor"] as const;
// Descriptive facts: fill if missing, never overwrite.
const FILL = ["summary", "sector", "region", "announced_on", "acquirer_ticker", "target_ticker", "acquirer_hq",
  "target_hq", "why_grodivo"] as const;
const COLUMNS = ["headline", "deal_status", "deal_type", "acquirer", "target", ...TRACKED, ...FILL] as const;

const asText = (v: unknown) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
const same = (a: unknown, b: unknown) => {
  const x = asText(a), y = asText(b);
  if (x === null || y === null) return x === y;
  const nx = Number(x), ny = Number(y);
  return !Number.isNaN(nx) && !Number.isNaN(ny) ? Math.abs(nx - ny) < 1e-6 : x.toLowerCase() === y.toLowerCase();
};

/** The verbatim extraction, minus the provider record (stored on the source row). */
const extractedOf = (s: SignalInput) => {
  const { source, _status: _s, ...rest } = s as SignalInput & Record<string, unknown>;
  return { ...rest, source: { url: source.url, publisher: source.publisher, title: source.title, published_at: source.published_at } };
};

/**
 * Inserts new signals or merges into existing ones (exact key, else a fuzzy acquirer+target
 * match within 30 days). Every source, raw record, extraction and fact change is kept.
 * Dismissed/actioned signals keep their status; new sources and facts still attach.
 */
export async function upsertSignals(client: pg.PoolClient, items: SignalInput[], origin: Origin) {
  let created = 0, merged = 0;
  const ids: string[] = [];
  for (const s of items) {
    const key = dedupeKey(s);
    let existing = (await client.query(`SELECT * FROM signals WHERE dedupe_key = $1`, [key])).rows[0];

    if (!existing && s.acquirer && s.target) {
      existing = (await client.query(
        `SELECT * FROM signals
         WHERE first_seen_at > now() - interval '30 days'
           AND similarity(lower(coalesce(acquirer, '')), $1) > 0.55
           AND similarity(lower(coalesce(target, '')), $2) > 0.55
         ORDER BY similarity(lower(acquirer), $1) + similarity(lower(target), $2) DESC LIMIT 1`,
        [s.acquirer.toLowerCase(), s.target.toLowerCase()])).rows[0];
    }

    const extracted = extractedOf(s);
    let id: string;
    if (existing) {
      id = existing.id;
      const sets: string[] = ["last_seen_at = now()"];
      const vals: unknown[] = [id];
      const events: [string, unknown, unknown][] = [];
      const set = (col: string, v: unknown, cast = "") => { vals.push(v); sets.push(`${col} = $${vals.length}${cast}`); };

      if ((STATUS_RANK[s.deal_status] ?? 0) > (STATUS_RANK[existing.deal_status] ?? 0)) {
        set("deal_status", s.deal_status, "::signal_deal_status");
        events.push(["deal_status", existing.deal_status, s.deal_status]);
      }
      if (existing.deal_type === "other" && s.deal_type !== "other") set("deal_type", s.deal_type, "::signal_deal_type");
      // A historical (archived) deal that shows up again in the live feed comes back to the queue
      if (existing.status === "archived" && origin !== "digest") {
        set("status", "new", "::signal_status");
        events.push(["status", "archived", "new"]);
      }
      for (const f of TRACKED) {
        const v = (s as any)[f];
        if (v === null || v === undefined || same(existing[f], v)) continue;
        set(f, v);
        events.push([f, existing[f], v]);
      }
      for (const f of FILL) {
        const v = (s as any)[f];
        if (v !== null && v !== undefined && (existing[f] === null || existing[f] === undefined)) set(f, v);
      }
      vals.push(Math.max(existing.fit_score, s.fit_score)); sets.push(`fit_score = $${vals.length}`);
      if (!existing.advisors?.length && s.advisors.length) set("advisors", JSON.stringify(s.advisors), "::jsonb");
      if (!existing.prospects?.length && s.prospects.length) set("prospects", JSON.stringify(s.prospects), "::jsonb");
      vals.push(JSON.stringify(s.terms)); sets.push(`terms = terms || $${vals.length}::jsonb`);
      vals.push(JSON.stringify(extracted)); sets.push(`extracted = $${vals.length}::jsonb`);
      await client.query(`UPDATE signals SET ${sets.join(", ")} WHERE id = $1`, vals);

      for (const [field, oldV, newV] of events) {
        await client.query(
          `INSERT INTO signal_events (signal_id, field, old_value, new_value, origin, source_url) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, field, asText(oldV), asText(newV), origin, s.source.url]);
      }
      merged++;
    } else {
      const initial = (s as any)._status === "archived" ? "archived" : "new";   // backfills land in the archive
      const cols = [...COLUMNS, "dedupe_key", "fit_score", "advisors", "prospects", "terms", "extracted", "status", "first_seen_at"];
      // Imported history keeps its original date; live items are seen now
      const firstSeen = origin === "digest" && s.source.published_at ? s.source.published_at : new Date().toISOString();
      const vals = [...COLUMNS.map((c) => (s as any)[c] ?? null), key, s.fit_score,
        JSON.stringify(s.advisors), JSON.stringify(s.prospects), JSON.stringify(s.terms), JSON.stringify(extracted), initial, firstSeen];
      id = (await client.query<{ id: string }>(
        `INSERT INTO signals (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`, vals)).rows[0]!.id;
      await client.query(
        `INSERT INTO signal_events (signal_id, field, old_value, new_value, origin, source_url) VALUES ($1, 'created', NULL, $2, $3, $4)`,
        [id, s.deal_status, origin, s.source.url]);
      created++;
    }
    ids.push(id);
    await client.query(
      `INSERT INTO signal_sources (signal_id, origin, url, publisher, title, published_at, raw, extracted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (signal_id, url) DO UPDATE SET extracted = EXCLUDED.extracted, raw = COALESCE(EXCLUDED.raw, signal_sources.raw)`,
      [id, origin, s.source.url, s.source.publisher, s.source.title ?? s.headline, s.source.published_at,
       s.source.raw === undefined ? null : JSON.stringify(s.source.raw), JSON.stringify(extracted)]);
  }
  return { created, merged, ids };
}

export interface CandidateRecord {
  url: string; title: string | null; published_at: string | null; kept: boolean; reason: string | null; raw?: unknown;
}

/** Logs every candidate the run looked at (kept or dropped). Re-seen URLs update in place. */
export async function recordCandidates(client: pg.PoolClient, runId: number, origin: Origin, cands: CandidateRecord[], urlToSignal: Map<string, string>) {
  for (const c of cands) {
    await client.query(
      `INSERT INTO signal_candidates (run_id, origin, url, title, published_at, kept, reason, signal_id, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (origin, url) DO UPDATE SET run_id = EXCLUDED.run_id, kept = EXCLUDED.kept OR signal_candidates.kept,
         reason = COALESCE(EXCLUDED.reason, signal_candidates.reason), signal_id = COALESCE(EXCLUDED.signal_id, signal_candidates.signal_id)`,
      [runId, origin, c.url, c.title, c.published_at, c.kept, c.reason, urlToSignal.get(c.url) ?? null,
       c.raw === undefined ? null : JSON.stringify(c.raw)]);
  }
}
