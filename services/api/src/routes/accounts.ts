import { Hono } from "hono";
import { query } from "../lib/db.js";
import { requireRole, type AppEnv } from "../lib/auth.js";
import { accountInput, contactInput, parseBody, updateSet } from "../lib/validate.js";

export const accounts = new Hono<AppEnv>();

const ACCOUNT_COLUMNS = ["name", "segment", "parent_account_id", "industry", "employee_count", "website", "hq_location", "owner_id", "notes"] as const;
const CONTACT_COLUMNS = ["account_id", "name", "title", "email", "phone", "linkedin_url", "is_champion", "notes"] as const;

const ROLLUP_SQL = `
  SELECT a.*, u.name AS owner_name, p.name AS parent_name,
         COUNT(d.id) FILTER (WHERE d.is_open)                                AS open_deals,
         COALESCE(SUM(d.one_time_value + d.arr) FILTER (WHERE d.is_open), 0) AS open_pipeline,
         COUNT(d.id) FILTER (WHERE d.stage = 'closed_won')                   AS won_deals,
         COALESCE(SUM(d.arr) FILTER (WHERE d.stage = 'closed_won'), 0)       AS carr,
         COALESCE(SUM(d.one_time_value) FILTER (WHERE d.stage = 'closed_won'), 0) AS won_one_time,
         BOOL_OR(d.stage = 'closed_won' AND d.motion = 'land')               AS landed,
         (SELECT COUNT(*) FROM accounts ch WHERE ch.parent_account_id = a.id) AS child_accounts
  FROM accounts a
  LEFT JOIN users u ON u.id = a.owner_id
  LEFT JOIN accounts p ON p.id = a.parent_account_id
  LEFT JOIN deal_metrics d ON d.account_id = a.id`;

accounts.get("/", async (c) => {
  const params: unknown[] = [];
  const where: string[] = [];
  if (c.req.query("segment")) { params.push(c.req.query("segment")); where.push(`a.segment = $${params.length}`); }
  if (c.req.query("q")) { params.push(`%${c.req.query("q")}%`); where.push(`a.name ILIKE $${params.length}`); }
  const rows = await query(
    `${ROLLUP_SQL} ${where.length ? "WHERE " + where.join(" AND ") : ""}
     GROUP BY a.id, u.name, p.name ORDER BY carr DESC, open_pipeline DESC, a.name LIMIT 1000`, params);
  return c.json(rows);
});

accounts.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [account] = await query(`${ROLLUP_SQL} WHERE a.id = $1 GROUP BY a.id, u.name, p.name`, [id]);
  if (!account) return c.json({ error: "not found" }, 404);
  const [contacts, deals, children, activities] = await Promise.all([
    query(`SELECT * FROM contacts WHERE account_id = $1 ORDER BY is_champion DESC, name`, [id]),
    query(`SELECT d.id, d.name, d.stage, d.motion, d.offering, d.one_time_value, d.arr, d.seats, d.pepy_rate,
                  d.expected_close, d.closed_at, d.is_open, u.name AS owner_name
           FROM deal_metrics d LEFT JOIN users u ON u.id = d.owner_id
           WHERE d.account_id = $1 ORDER BY d.created_at`, [id]),
    query(`${ROLLUP_SQL} WHERE a.parent_account_id = $1 GROUP BY a.id, u.name, p.name ORDER BY a.name`, [id]),
    query(`SELECT a.*, u.name AS user_name, d.name AS deal_name FROM activities a
           LEFT JOIN users u ON u.id = a.user_id LEFT JOIN deals d ON d.id = a.deal_id
           WHERE a.account_id = $1 OR d.account_id = $1 ORDER BY a.occurred_at DESC LIMIT 100`, [id]),
  ]);
  return c.json({ ...account, contacts, deals, children, activities });
});

accounts.post("/", async (c) => {
  const data = await parseBody(c, accountInput);
  const values = { ...data, owner_id: data.owner_id ?? c.get("user").id };
  const cols = ACCOUNT_COLUMNS.filter((k) => (values as any)[k] !== undefined);
  try {
    const [row] = await query(
      `INSERT INTO accounts (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
      cols.map((k) => (values as any)[k]));
    return c.json(row, 201);
  } catch (e: any) {
    if (e.code === "23505") return c.json({ error: "An account with that name already exists" }, 409);
    throw e;
  }
});

accounts.patch("/:id", async (c) => {
  const data = await parseBody(c, accountInput, true);
  if (data.parent_account_id === c.req.param("id")) return c.json({ error: "an account cannot be its own parent" }, 400);
  const set = updateSet(data, ACCOUNT_COLUMNS, 2);
  if (!set.count) return c.json({ error: "nothing to update" }, 400);
  const [row] = await query(`UPDATE accounts SET ${set.sql} WHERE id = $1 RETURNING id`, [c.req.param("id"), ...set.values]);
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

accounts.delete("/:id", requireRole("admin", "manager"), async (c) => {
  try {
    await query(`DELETE FROM accounts WHERE id = $1`, [c.req.param("id")]);
  } catch (e: any) {
    if (e.code === "23503") return c.json({ error: "Delete or move this account's deals first" }, 409);
    throw e;
  }
  return c.body(null, 204);
});

export const contacts = new Hono<AppEnv>();

contacts.post("/", async (c) => {
  const data = await parseBody(c, contactInput);
  const cols = CONTACT_COLUMNS.filter((k) => (data as any)[k] !== undefined);
  const [row] = await query(
    `INSERT INTO contacts (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    cols.map((k) => (data as any)[k]));
  return c.json(row, 201);
});

contacts.patch("/:id", async (c) => {
  const data = await parseBody(c, contactInput, true);
  const set = updateSet(data, CONTACT_COLUMNS, 2);
  if (!set.count) return c.json({ error: "nothing to update" }, 400);
  const [row] = await query(`UPDATE contacts SET ${set.sql} WHERE id = $1 RETURNING id`, [c.req.param("id"), ...set.values]);
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});

contacts.delete("/:id", async (c) => {
  await query(`DELETE FROM contacts WHERE id = $1`, [c.req.param("id")]);
  return c.body(null, 204);
});
