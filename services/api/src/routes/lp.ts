import { Hono } from "hono";
import { z } from "zod";
import { query, withTx } from "../lib/db.js";
import { currentUser, type AppEnv } from "../lib/auth.js";
import { parseBody } from "../lib/validate.js";
import { normalizeCompany } from "../lib/signals.js";

export const lp = new Hono<AppEnv>();

// GP = reconciled entity when available, else the manager family as reported
const GP = `coalesce(l.manager_entity, l.manager_family)`;
// Private-markets commitments and hires: money a GP is about to deploy
const DEPLOYING = `l.asset_group IN ('private_equity', 'venture', 'private_credit', 'infrastructure')
  AND (l.signal_category = 'Pacing' OR l.signal_type ~* '(commit|hire|selected|approv|award)')
  AND l.signal_type !~* '(terminat|redempt|probation|watch)'`;

function filters(q: (k: string) => string | undefined) {
  const params: unknown[] = [Math.min(Math.max(Number(q("months") ?? 12), 1), 60)];
  const where = [`l.event_month >= date_trunc('month', now()) - make_interval(months => $1)`, `${GP} IS NOT NULL`, DEPLOYING,
    // placeholders the monitor uses when no single GP is named
    `${GP} !~* '^(various|multiple|several|tbd|undisclosed|unnamed|n/?a|none|staff)\\y' AND ${GP} !~* '\\yinternal\\y'`];
  if (q("group")) { params.push(q("group")); where.push(`l.asset_group = $${params.length}`); }
  if (q("q")) { params.push(`%${q("q")}%`); where.push(`(${GP} ILIKE $${params.length} OR l.counterparty ILIKE $${params.length})`); }
  if (q("primary") === "true") where.push(`l.source_type = 'primary'`);
  return { where: where.join(" AND "), params };
}

lp.get("/summary", async (c) => {
  const f = filters((k) => c.req.query(k));
  const [row] = await query(
    `SELECT COUNT(DISTINCT ${GP}) AS gps, COUNT(*) AS commitments, COALESCE(SUM(l.amount_usd_m), 0) AS total_usd_m,
            COUNT(DISTINCT l.plan) AS plans,
            ROUND(100.0 * COUNT(*) FILTER (WHERE l.source_type = 'primary') / NULLIF(COUNT(*), 0)) AS primary_pct,
            (SELECT MAX(event_month) FROM lp_signals) AS latest_month, (SELECT COUNT(*) FROM lp_signals) AS all_records
     FROM lp_signals l WHERE ${f.where}`, f.params);
  return c.json(row);
});

lp.get("/gps", async (c) => {
  const f = filters((k) => c.req.query(k));
  const rows = await query(
    `WITH g AS (
       SELECT ${GP} AS gp, COUNT(*) AS commitments, COALESCE(SUM(l.amount_usd_m), 0) AS total_usd_m,
              COUNT(DISTINCT l.plan) AS plans, MAX(l.event_month) AS latest_month,
              array_agg(DISTINCT l.asset_group) AS groups,
              COUNT(*) FILTER (WHERE l.source_type = 'primary') AS primary_count,
              (array_agg(l.counterparty ORDER BY l.event_month DESC NULLS LAST))[1:3] AS recent_funds
       FROM lp_signals l WHERE ${f.where} GROUP BY 1)
     SELECT g.*,
       (SELECT json_build_object('id', a.id, 'name', a.name) FROM accounts a
          WHERE similarity(lower(a.name), lower(g.gp)) > 0.6 ORDER BY similarity(lower(a.name), lower(g.gp)) DESC LIMIT 1) AS account
     FROM g ORDER BY g.total_usd_m DESC, g.commitments DESC LIMIT 300`, f.params);
  return c.json(rows);
});

lp.get("/gps/:gp/signals", async (c) => {
  const rows = await query(
    `SELECT l.id, l.event_month, l.plan, l.state, l.signal_category, l.signal_type, l.asset_class, l.asset_group, l.counterparty,
            l.amount_usd_m, l.action_detail, l.source_snippet, l.source_name, l.source_title, l.source_url, l.source_type,
            l.doc_type, l.doc_date
     FROM lp_signals l WHERE lower(${GP}) = lower($1) ORDER BY l.event_month DESC NULLS LAST, l.amount_usd_m DESC NULLS LAST LIMIT 200`,
    [c.req.param("gp")]);
  return c.json(rows);
});

const addInput = z.object({
  gp: z.string().trim().min(1).max(200),
  account_id: z.string().uuid().nullish(),
  create_deal: z.boolean().default(true),
  angle: z.string().trim().max(1000).nullish(),
});

/** Add a GP to the pipeline: find/create a PE account, optional lead deal, and a note listing its recent commitments. */
lp.post("/gps/actions/add", async (c) => {
  const user = currentUser(c);
  const body = await parseBody(c, addInput);
  const recent = await query<{ plan: string; counterparty: string; amount_usd_m: number | null; event_month: string; source_url: string }>(
    `SELECT plan, counterparty, amount_usd_m, event_month, source_url FROM lp_signals l
     WHERE lower(${GP}) = lower($1) AND ${DEPLOYING} ORDER BY event_month DESC NULLS LAST LIMIT 8`, [body.gp]);
  const total = recent.reduce((s, r) => s + Number(r.amount_usd_m ?? 0), 0);

  const result = await withTx(user.id, async (db) => {
    let accountId = body.account_id ?? null;
    let created = false;
    if (!accountId) {
      const norm = normalizeCompany(body.gp);
      const match = (await db.query<{ id: string; name: string }>(
        `SELECT id, name FROM accounts WHERE similarity(lower(name), $1) > 0.8 ORDER BY similarity(lower(name), $1) DESC LIMIT 3`,
        [body.gp.toLowerCase()])).rows.find((a) => normalizeCompany(a.name) === norm);
      if (match) accountId = match.id;
      else {
        accountId = (await db.query<{ id: string }>(
          `INSERT INTO accounts (name, segment, owner_id, notes) VALUES ($1, 'pe', $2, $3) RETURNING id`,
          [body.gp, user.id, "Added from LP commitments (public pension board actions)"])).rows[0]!.id;
        created = true;
      }
    }
    let dealId: string | null = null;
    if (body.create_deal) {
      const landed = (await db.query(`SELECT 1 FROM deals WHERE account_id = $1 AND stage = 'closed_won' LIMIT 1`, [accountId])).rowCount;
      dealId = (await db.query<{ id: string }>(
        `INSERT INTO deals (account_id, name, owner_id, motion, offering, stage, one_time_value, source, next_step, next_step_date, created_by)
         VALUES ($1, $2, $3, $4, 'diagnostic', 'lead', 35000, 'lp_signal', $5, $6, $3) RETURNING id`,
        [accountId, `New fund deployment: ${body.gp}`, user.id, landed ? "expand" : "land",
         (body.angle ? `Outreach: ${body.angle}` : "Outreach: diligence support as new fund deploys").slice(0, 500),
         new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)])).rows[0]!.id;
    }
    const lines = recent.map((r) => `- ${r.plan}: ${r.counterparty ?? "commitment"}${r.amount_usd_m ? ` $${r.amount_usd_m}M` : ""} (${String(r.event_month).slice(0, 7)}) ${r.source_url ?? ""}`);
    await db.query(
      `INSERT INTO activities (deal_id, account_id, user_id, type, summary) VALUES ($1, $2, $3, 'note', $4)`,
      [dealId, accountId, user.id, `LP commitments to ${body.gp}${total ? ` (about $${Math.round(total)}M across recent records)` : ""}:\n${lines.join("\n")}`]);
    return { account_id: accountId, deal_id: dealId, created_account: created };
  });
  return c.json(result);
});
