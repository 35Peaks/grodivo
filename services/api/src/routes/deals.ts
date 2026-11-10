import { Hono } from "hono";
import { query, withTx } from "../lib/db.js";
import { currentUser, type AppEnv } from "../lib/auth.js";
import { dealInput, parseBody, updateSet } from "../lib/validate.js";

export const deals = new Hono<AppEnv>();

const DEAL_COLUMNS = [
  "account_id", "name", "owner_id", "primary_contact_id", "motion", "offering", "stage",
  "one_time_value", "pepy_rate", "seats", "probability", "expected_close", "lost_reason",
  "source", "partner_name", "next_step", "next_step_date",
] as const;

const LIST_SQL = `
  SELECT d.id, d.name, d.account_id, d.account_name, d.segment, d.owner_id, u.name AS owner_name,
         d.motion, d.offering, d.stage, d.one_time_value, d.pepy_rate, d.seats, d.arr,
         d.effective_probability, d.weighted_arr, d.weighted_one_time, d.expected_close,
         d.next_step, d.next_step_date, d.source, d.partner_name, d.is_open, d.closed_at,
         d.created_at, d.updated_at
  FROM deal_metrics d LEFT JOIN users u ON u.id = d.owner_id`;

function listFilters(q: (k: string) => string | undefined) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (q("stage")) add("d.stage = ?", q("stage"));
  if (q("segment")) add("d.segment = ?", q("segment"));
  if (q("owner")) add("d.owner_id = ?", q("owner"));
  if (q("account")) add("d.account_id = ?", q("account"));
  if (q("offering")) add("d.offering = ?", q("offering"));
  if (q("status") === "open") where.push("d.is_open");
  if (q("status") === "closed") where.push("NOT d.is_open");
  if (q("q")) {
    params.push(`%${q("q")}%`);
    where.push(`(d.name ILIKE $${params.length} OR d.account_name ILIKE $${params.length})`);
  }
  return { sql: where.length ? ` WHERE ${where.join(" AND ")}` : "", params };
}

deals.get("/", async (c) => {
  const f = listFilters((k) => c.req.query(k));
  const rows = await query(`${LIST_SQL}${f.sql} ORDER BY d.is_open DESC, d.expected_close NULLS LAST, d.updated_at DESC LIMIT 1000`, f.params);
  return c.json(rows);
});

deals.get("/export.csv", async (c) => {
  const f = listFilters((k) => c.req.query(k));
  const rows = await query(`${LIST_SQL}${f.sql} ORDER BY d.account_name, d.name`, f.params);
  const cols = ["name", "account_name", "segment", "owner_name", "motion", "offering", "stage", "one_time_value",
    "pepy_rate", "seats", "arr", "effective_probability", "expected_close", "source", "partner_name", "next_step"];
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k])).join(","))].join("\n");
  return c.body(csv, 200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="grodivo-deals-${new Date().toISOString().slice(0, 10)}.csv"`,
  });
});

deals.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [deal] = await query(`${LIST_SQL} WHERE d.id = $1`, [id]);
  if (!deal) return c.json({ error: "not found" }, 404);
  const [extra] = await query(
    `SELECT probability, lost_reason, primary_contact_id, created_by FROM deals WHERE id = $1`, [id]);
  const activities = await query(
    `SELECT a.*, u.name AS user_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
     WHERE a.deal_id = $1 ORDER BY a.occurred_at DESC LIMIT 200`, [id]);
  const history = await query(
    `SELECT h.from_stage, h.to_stage, h.changed_at, u.name AS changed_by_name
     FROM deal_stage_history h LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.deal_id = $1 ORDER BY h.changed_at`, [id]);
  return c.json({ ...deal, ...extra, activities, history });
});

deals.post("/", async (c) => {
  const user = currentUser(c);
  const data = await parseBody(c, dealInput);
  const values = { ...data, owner_id: data.owner_id ?? user.id };
  const cols = DEAL_COLUMNS.filter((k) => (values as any)[k] !== undefined);
  const row = await withTx(user.id, async (db) => {
    const res = await db.query(
      `INSERT INTO deals (${cols.join(", ")}, created_by)
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}, $${cols.length + 1}) RETURNING id`,
      [...cols.map((k) => (values as any)[k]), user.id],
    );
    return res.rows[0];
  });
  return c.json(row, 201);
});

deals.patch("/:id", async (c) => {
  const user = currentUser(c);
  const data = await parseBody(c, dealInput, true);
  const set = updateSet(data, DEAL_COLUMNS, 2);
  if (!set.count) return c.json({ error: "nothing to update" }, 400);
  const row = await withTx(user.id, async (db) => {
    const res = await db.query(`UPDATE deals SET ${set.sql} WHERE id = $1 RETURNING id`, [c.req.param("id"), ...set.values]);
    return res.rows[0];
  });
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json(row);
});

deals.delete("/:id", async (c) => {
  const user = currentUser(c);
  const id = c.req.param("id");
  const [deal] = await query<{ owner_id: string | null }>(`SELECT owner_id FROM deals WHERE id = $1`, [id]);
  if (!deal) return c.json({ error: "not found" }, 404);
  if (user.role === "rep" && deal.owner_id !== user.id) return c.json({ error: "only the owner or a manager can delete" }, 403);
  await query(`DELETE FROM deals WHERE id = $1`, [id]);
  return c.body(null, 204);
});
