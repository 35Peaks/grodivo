import { Hono } from "hono";
import { z } from "zod";
import { query } from "../lib/db.js";
import { requireRole, type AppEnv } from "../lib/auth.js";
import { parseBody, quotaInput, stages } from "../lib/validate.js";

export const settings = new Hono<AppEnv>();

settings.get("/meta", async (c) => {
  const [users, stageProbabilities] = await Promise.all([
    query(`SELECT id, name, email, role FROM users WHERE active ORDER BY name`),
    query(`SELECT stage, probability, sort_order FROM stage_probabilities ORDER BY sort_order`),
  ]);
  return c.json({ me: c.get("user"), users, stageProbabilities });
});

settings.put("/stage-probabilities", requireRole("admin"), async (c) => {
  const body = await parseBody(c, z.array(z.object({ stage: z.enum(stages), probability: z.number().int().min(0).max(100) })));
  for (const s of body) await query(`UPDATE stage_probabilities SET probability = $2 WHERE stage = $1`, [s.stage, s.probability]);
  return c.json({ ok: true });
});

settings.get("/quotas", async (c) => {
  const rows = await query(
    `SELECT q.*, u.name AS user_name FROM quotas q LEFT JOIN users u ON u.id = q.user_id
     ORDER BY q.period_start DESC, u.name NULLS FIRST`);
  return c.json(rows);
});

settings.post("/quotas", requireRole("admin"), async (c) => {
  const q = await parseBody(c, quotaInput);
  const [row] = await query(
    `INSERT INTO quotas (user_id, period_start, period_end, target_arr, target_bookings)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid), period_start, period_end)
     DO UPDATE SET target_arr = EXCLUDED.target_arr, target_bookings = EXCLUDED.target_bookings
     RETURNING *`,
    [q.user_id, q.period_start, q.period_end, q.target_arr, q.target_bookings]);
  return c.json(row, 201);
});

settings.delete("/quotas/:id", requireRole("admin"), async (c) => {
  await query(`DELETE FROM quotas WHERE id = $1`, [c.req.param("id")]);
  return c.body(null, 204);
});

/** Mirrors a Cognito enable/disable into Postgres so disabled users drop out of lists and scorecards. */
settings.patch("/users/:id", requireRole("admin"), async (c) => {
  const body = await parseBody(c, z.object({ active: z.boolean() }));
  const [row] = await query(`UPDATE users SET active = $2 WHERE id = $1 RETURNING id, active`, [c.req.param("id"), body.active]);
  return row ? c.json(row) : c.json({ error: "not found" }, 404);
});
