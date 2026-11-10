// Shared signal model: validation, normalization, dedupe and the Postgres upsert.
import { createHash } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { segments } from "./validate.js";

export const dealStatuses = ["rumored", "announced", "pending", "closed", "terminated", "unknown"] as const;
export const dealTypes = ["pe_platform", "pe_add_on", "corporate_acquisition", "merger", "take_private", "carve_out", "other"] as const;
export const origins = ["fmp", "gdelt", "claude_research", "manual"] as const;
export type Origin = (typeof origins)[number];

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
  announced_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null),
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
  }),
});
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

/**
 * Inserts new signals or merges into existing ones (exact key, else a fuzzy acquirer+target
 * match within 30 days). Dismissed/actioned signals keep their status; new sources still attach.
 */
export async function upsertSignals(client: pg.PoolClient, items: SignalInput[], origin: Origin) {
  let created = 0, merged = 0;
  for (const s of items) {
    const key = dedupeKey(s);
    let existing = (await client.query<{ id: string; deal_status: string }>(
      `SELECT id, deal_status FROM signals WHERE dedupe_key = $1`, [key])).rows[0];

    if (!existing && s.acquirer && s.target) {
      existing = (await client.query<{ id: string; deal_status: string }>(
        `SELECT id, deal_status FROM signals
         WHERE first_seen_at > now() - interval '30 days'
           AND similarity(lower(coalesce(acquirer, '')), $1) > 0.55
           AND similarity(lower(coalesce(target, '')), $2) > 0.55
         ORDER BY similarity(lower(acquirer), $1) + similarity(lower(target), $2) DESC LIMIT 1`,
        [s.acquirer.toLowerCase(), s.target.toLowerCase()])).rows[0];
    }

    let id: string;
    if (existing) {
      const advance = (STATUS_RANK[s.deal_status] ?? 0) > (STATUS_RANK[existing.deal_status] ?? 0);
      await client.query(
        `UPDATE signals SET
           last_seen_at = now(),
           deal_status = CASE WHEN $2 THEN $3::signal_deal_status ELSE deal_status END,
           summary = COALESCE(summary, $4), sponsor = COALESCE(sponsor, $5),
           deal_value_usd_m = COALESCE(deal_value_usd_m, $6), sector = COALESCE(sector, $7),
           region = COALESCE(region, $8), announced_on = COALESCE(announced_on, $9),
           why_grodivo = COALESCE(why_grodivo, $10),
           fit_score = GREATEST(fit_score, $11),
           advisors = CASE WHEN jsonb_array_length(advisors) = 0 THEN $12::jsonb ELSE advisors END,
           prospects = CASE WHEN jsonb_array_length(prospects) = 0 THEN $13::jsonb ELSE prospects END,
           deal_type = CASE WHEN deal_type = 'other' THEN $14::signal_deal_type ELSE deal_type END
         WHERE id = $1`,
        [existing.id, advance, s.deal_status, s.summary, s.sponsor, s.deal_value_usd_m, s.sector, s.region,
         s.announced_on, s.why_grodivo, s.fit_score, JSON.stringify(s.advisors), JSON.stringify(s.prospects), s.deal_type]);
      id = existing.id;
      merged++;
    } else {
      const res = await client.query<{ id: string }>(
        `INSERT INTO signals (dedupe_key, headline, summary, deal_status, deal_type, acquirer, target, sponsor,
           advisors, deal_value_usd_m, sector, region, announced_on, fit_score, why_grodivo, prospects)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [key, s.headline, s.summary, s.deal_status, s.deal_type, s.acquirer, s.target, s.sponsor,
         JSON.stringify(s.advisors), s.deal_value_usd_m, s.sector, s.region, s.announced_on, s.fit_score,
         s.why_grodivo, JSON.stringify(s.prospects)]);
      id = res.rows[0]!.id;
      created++;
    }
    await client.query(
      `INSERT INTO signal_sources (signal_id, origin, url, publisher, title, published_at)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (signal_id, url) DO NOTHING`,
      [id, origin, s.source.url, s.source.publisher, s.source.title ?? s.headline, s.source.published_at]);
  }
  return { created, merged };
}
