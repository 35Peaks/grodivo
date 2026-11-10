import { Hono } from "hono";
import { query } from "../lib/db.js";
import { currentUser, type AppEnv } from "../lib/auth.js";
import { activityInput, parseBody } from "../lib/validate.js";

export const activities = new Hono<AppEnv>();

activities.get("/", async (c) => {
  const params: unknown[] = [];
  const where: string[] = [];
  if (c.req.query("user")) { params.push(c.req.query("user")); where.push(`a.user_id = $${params.length}`); }
  const rows = await query(
    `SELECT a.*, u.name AS user_name, d.name AS deal_name, COALESCE(acc.name, dacc.name) AS account_name
     FROM activities a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN deals d ON d.id = a.deal_id
     LEFT JOIN accounts acc ON acc.id = a.account_id
     LEFT JOIN accounts dacc ON dacc.id = d.account_id
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY a.occurred_at DESC LIMIT 100`, params);
  return c.json(rows);
});

activities.post("/", async (c) => {
  const user = currentUser(c);
  const data = await parseBody(c, activityInput);
  // Activities on a deal also roll up to its account
  let accountId = data.account_id ?? null;
  if (!accountId && data.deal_id) {
    const [d] = await query<{ account_id: string }>(`SELECT account_id FROM deals WHERE id = $1`, [data.deal_id]);
    accountId = d?.account_id ?? null;
  }
  const [row] = await query(
    `INSERT INTO activities (deal_id, account_id, user_id, type, summary, occurred_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now())) RETURNING *`,
    [data.deal_id ?? null, accountId, user.id, data.type, data.summary, data.occurred_at ?? null]);
  return c.json(row, 201);
});

activities.delete("/:id", async (c) => {
  const user = currentUser(c);
  const [a] = await query<{ user_id: string }>(`SELECT user_id FROM activities WHERE id = $1`, [c.req.param("id")]);
  if (!a) return c.json({ error: "not found" }, 404);
  if (a.user_id !== user.id && user.role === "rep") return c.json({ error: "forbidden" }, 403);
  await query(`DELETE FROM activities WHERE id = $1`, [c.req.param("id")]);
  return c.body(null, 204);
});
