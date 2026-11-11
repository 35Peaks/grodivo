import { Hono } from "hono";
import { z } from "zod";
import { query, withTx } from "../lib/db.js";
import { currentUser, type AppEnv } from "../lib/auth.js";
import { parseBody, segments } from "../lib/validate.js";
import { dealTypes, normalizeCompany, signalInput, upsertSignals } from "../lib/signals.js";

export const signals = new Hono<AppEnv>();

// Every company name a signal mentions, for fuzzy matching against existing accounts
const NAMES_SQL = `
  SELECT DISTINCT n FROM (
    SELECT s.acquirer AS n UNION ALL SELECT s.target UNION ALL SELECT s.sponsor
    UNION ALL SELECT p->>'name' FROM jsonb_array_elements(s.prospects) p
    UNION ALL SELECT a->>'name' FROM jsonb_array_elements(s.advisors) a
  ) x WHERE n IS NOT NULL AND length(n) > 1`;

const LIST_SQL = `
  SELECT s.*,
    (SELECT COALESCE(json_agg(json_build_object('url', ss.url, 'publisher', ss.publisher, 'title', ss.title,
        'origin', ss.origin, 'published_at', ss.published_at) ORDER BY ss.published_at DESC NULLS LAST), '[]')
       FROM signal_sources ss WHERE ss.signal_id = s.id) AS sources,
    (SELECT COALESCE(json_agg(DISTINCT jsonb_build_object('id', a.id, 'name', a.name, 'segment', a.segment)), '[]')
       FROM accounts a
       WHERE EXISTS (SELECT 1 FROM (${NAMES_SQL}) names WHERE similarity(lower(a.name), lower(names.n)) > 0.6)) AS matched_accounts,
    (SELECT COALESCE(json_agg(json_build_object('account_id', l.account_id, 'account_name', a.name, 'deal_id', l.deal_id,
        'role', l.role, 'created_at', l.created_at) ORDER BY l.created_at), '[]')
       FROM signal_links l LEFT JOIN accounts a ON a.id = l.account_id WHERE l.signal_id = s.id) AS links,
    (SELECT COALESCE(json_agg(json_build_object('field', e.field, 'old_value', e.old_value, 'new_value', e.new_value,
        'origin', e.origin, 'source_url', e.source_url, 'at', e.at) ORDER BY e.at), '[]')
       FROM signal_events e WHERE e.signal_id = s.id) AS events,
    u.name AS actioned_by_name
  FROM signals s LEFT JOIN users u ON u.id = s.actioned_by`;

signals.get("/", async (c) => {
  const q = (k: string) => c.req.query(k);
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replaceAll("?", `$${params.length}`)); };
  const status = q("status") ?? "new";
  if (status !== "all") add("s.status = ?", status);
  if (q("type")) add("s.deal_type = ?", q("type"));
  if (q("deal_status")) add("s.deal_status = ?", q("deal_status"));
  if (q("segment")) add("s.prospects @> jsonb_build_array(jsonb_build_object('segment', ?::text))", q("segment"));
  if (q("min_fit")) add("s.fit_score >= ?", Number(q("min_fit")));
  if (q("days")) add("s.first_seen_at >= now() - make_interval(days => ?)", Number(q("days")));
  if (q("q")) add("(s.headline ILIKE ? OR s.acquirer ILIKE ? OR s.target ILIKE ? OR s.sponsor ILIKE ?)", `%${q("q")}%`);
  const rows = await query(
    `${LIST_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY s.fit_score DESC, s.first_seen_at DESC LIMIT 200`, params);
  return c.json(rows);
});

signals.get("/summary", async (c) => {
  const [counts] = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'new') AS new,
            COUNT(*) FILTER (WHERE status = 'new' AND fit_score >= 70) AS new_high_fit,
            COUNT(*) FILTER (WHERE status = 'watching') AS watching,
            COUNT(*) FILTER (WHERE status = 'actioned' AND actioned_at >= now() - interval '30 days') AS actioned_30d,
            COUNT(*) FILTER (WHERE first_seen_at >= now() - interval '24 hours') AS last_24h
     FROM signals`);
  const runs = await query(
    `SELECT DISTINCT ON (origin) origin, started_at, items_in, created, merged, skipped, note
     FROM signal_runs ORDER BY origin, started_at DESC`);
  return c.json({ ...counts, runs });
});

signals.get("/:id", async (c) => {
  const [row] = await query(`${LIST_SQL} WHERE s.id = $1`, [c.req.param("id")]);
  if (!row) return c.json({ error: "not found" }, 404);
  // Full record for audit: raw provider data and per-source extractions
  const raw = await query(`SELECT origin, url, raw, extracted, created_at FROM signal_sources WHERE signal_id = $1 ORDER BY created_at`, [row.id]);
  return c.json({ ...row, source_records: raw });
});

/** Everything the feed looked at, kept or dropped, for tuning and audit. */
signals.get("/candidates/recent", async (c) => {
  const kept = c.req.query("kept");
  const rows = await query(
    `SELECT id, origin, url, title, published_at, kept, reason, signal_id, created_at FROM signal_candidates
     ${kept === "true" ? "WHERE kept" : kept === "false" ? "WHERE NOT kept" : ""}
     ORDER BY created_at DESC LIMIT 500`);
  return c.json(rows);
});

/** Manual entry: a rep pastes a deal they heard about. Same dedupe as the automated feed. */
signals.post("/", async (c) => {
  const user = currentUser(c);
  const body = await c.req.json().catch(() => ({}));
  const s = signalInput.parse({ fit_score: 60, ...body });
  const result = await withTx(user.id, (db) => upsertSignals(db, [s], "manual"));
  return c.json(result, 201);
});

const actionInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add_prospect"),
    name: z.string().trim().min(1).max(200),          // company to pursue
    segment: z.enum(segments),
    role: z.string().trim().max(60).nullish(),
    angle: z.string().trim().max(1000).nullish(),
    account_id: z.string().uuid().nullish(),          // pick an existing account instead of creating one
    create_deal: z.boolean().default(true),
  }),
  z.object({ action: z.literal("attach"), account_id: z.string().uuid(), role: z.string().trim().max(60).nullish() }),
  z.object({ action: z.literal("watch"), note: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("dismiss"), note: z.string().trim().max(1000).nullish() }),
  z.object({ action: z.literal("reopen") }),
]);

function dealName(role: string | null | undefined, s: { acquirer: string | null; target: string | null; headline: string }) {
  const pair = [s.acquirer, s.target].filter(Boolean).join(" / ") || s.headline.slice(0, 80);
  if (role === "advisor") return `Channel: advisor on ${pair}`;
  if (role === "sponsor") return `Diligence & integration: ${pair}`;
  return `Integration diagnostic: ${pair}`;
}

signals.post("/:id/actions", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const body = await parseBody(c, actionInput);

  const result = await withTx(user.id, async (db) => {
    const sig = (await db.query(`SELECT * FROM signals WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!sig) return null;
    const src = (await db.query<{ url: string }>(
      `SELECT url FROM signal_sources WHERE signal_id = $1 ORDER BY published_at DESC NULLS LAST LIMIT 1`, [id])).rows[0];
    const noteText = `M&A signal: ${sig.headline}${src ? `\n${src.url}` : ""}`;

    if (body.action === "watch" || body.action === "dismiss" || body.action === "reopen") {
      const status = body.action === "watch" ? "watching" : body.action === "dismiss" ? "dismissed" : "new";
      await db.query(
        `UPDATE signals SET status = $2, status_note = $3, actioned_by = $4, actioned_at = now() WHERE id = $1`,
        [id, status, "note" in body ? body.note ?? null : null, user.id]);
      return { status };
    }

    let accountId: string;
    let createdAccount = false;
    let dealId: string | null = null;
    const role = body.role ?? null;

    if (body.action === "attach") {
      accountId = body.account_id;
    } else if (body.account_id) {
      accountId = body.account_id;
    } else {
      // Reuse an account with the same normalized name rather than creating a near-duplicate
      const norm = normalizeCompany(body.name);
      const existing = (await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM accounts WHERE similarity(lower(name), $1) > 0.8 ORDER BY similarity(lower(name), $1) DESC LIMIT 1`,
        [body.name.toLowerCase()])).rows.find((a) => normalizeCompany(a.name) === norm);
      if (existing) accountId = existing.id;
      else {
        accountId = (await db.query<{ id: string }>(
          `INSERT INTO accounts (name, segment, owner_id, notes) VALUES ($1, $2, $3, $4) RETURNING id`,
          [body.name, body.segment, user.id, `Added from M&A signal: ${sig.headline}`])).rows[0]!.id;
        createdAccount = true;
      }
    }

    if (body.action === "add_prospect" && body.create_deal) {
      const landed = (await db.query(
        `SELECT 1 FROM deals WHERE account_id = $1 AND stage = 'closed_won' LIMIT 1`, [accountId])).rowCount;
      const nextStepDate = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      dealId = (await db.query<{ id: string }>(
        `INSERT INTO deals (account_id, name, owner_id, motion, offering, stage, one_time_value, source,
           next_step, next_step_date, created_by)
         VALUES ($1, $2, $3, $4, 'diagnostic', 'lead', 35000, 'news_signal', $5, $6, $3) RETURNING id`,
        [accountId, dealName(role, sig), user.id, landed ? "expand" : "land",
         (body.angle ? `Outreach: ${body.angle}` : "Outreach on the deal").slice(0, 500), nextStepDate])).rows[0]!.id;
    }

    await db.query(
      `INSERT INTO activities (deal_id, account_id, user_id, type, summary) VALUES ($1, $2, $3, 'note', $4)`,
      [dealId, accountId, user.id, noteText + (body.action === "add_prospect" && body.angle ? `\nAngle: ${body.angle}` : "")]);
    await db.query(
      `INSERT INTO signal_links (signal_id, account_id, deal_id, role, created_by) VALUES ($1, $2, $3, $4, $5)`,
      [id, accountId, dealId, role, user.id]);
    await db.query(
      `UPDATE signals SET status = 'actioned', actioned_by = $2, actioned_at = now() WHERE id = $1`, [id, user.id]);
    return { status: "actioned", account_id: accountId, deal_id: dealId, created_account: createdAccount };
  });

  return result ? c.json(result) : c.json({ error: "not found" }, 404);
});

export const signalTypes = dealTypes;
