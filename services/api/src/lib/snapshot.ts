import { query } from "./db.js";

/** Pipeline snapshot used by the weekly digest. Runs inside the VPC. */
export async function pipelineSnapshot() {
  const [totals] = await query(
    `SELECT COUNT(*) FILTER (WHERE is_open) AS open_deals,
            COALESCE(SUM(one_time_value + arr) FILTER (WHERE is_open), 0) AS open_pipeline,
            COALESCE(SUM(weighted_one_time + weighted_arr) FILTER (WHERE is_open), 0) AS weighted_pipeline,
            COALESCE(SUM(arr) FILTER (WHERE stage = 'closed_won'), 0) AS carr
     FROM deal_metrics`);
  const bySegment = await query(
    `SELECT segment, COUNT(*) FILTER (WHERE is_open) AS open_deals,
            COALESCE(SUM(one_time_value + arr) FILTER (WHERE is_open), 0) AS open_pipeline
     FROM deal_metrics GROUP BY segment ORDER BY segment`);
  const movedThisWeek = await query(
    `SELECT d.name, a.name AS account, h.from_stage, h.to_stage, h.changed_at,
            d.one_time_value + d.arr AS value
     FROM deal_stage_history h JOIN deals d ON d.id = h.deal_id JOIN accounts a ON a.id = d.account_id
     WHERE h.changed_at >= now() - interval '7 days' AND h.from_stage IS NOT NULL
     ORDER BY h.changed_at DESC LIMIT 40`);
  const newDeals = await query(
    `SELECT d.name, d.account_name AS account, d.stage, d.one_time_value + d.arr AS value
     FROM deal_metrics d WHERE d.created_at >= now() - interval '7 days' ORDER BY value DESC LIMIT 20`);
  const needsAttention = await query(
    `SELECT d.name, d.account_name AS account, d.stage, u.email AS owner_email, u.name AS owner_name,
            d.expected_close, d.next_step_date, d.one_time_value + d.arr AS value
     FROM deal_metrics d LEFT JOIN users u ON u.id = d.owner_id
     LEFT JOIN LATERAL (SELECT MAX(occurred_at) AS last FROM activities a WHERE a.deal_id = d.id) la ON true
     WHERE d.is_open AND (d.expected_close < current_date OR d.next_step_date < current_date
       OR COALESCE(la.last, d.created_at) < now() - interval '21 days')
     ORDER BY value DESC LIMIT 25`);
  const [target] = await query(
    `SELECT target_arr FROM quotas WHERE user_id IS NULL AND current_date BETWEEN period_start AND period_end
     ORDER BY period_start DESC LIMIT 1`);
  const recipients = await query<{ email: string; name: string; role: string }>(
    `SELECT email, name, role FROM users WHERE active ORDER BY name`);
  return { generatedAt: new Date().toISOString(), totals, bySegment, movedThisWeek, newDeals, needsAttention,
           targetArr: target?.target_arr ?? null, recipients };
}
export type Snapshot = Awaited<ReturnType<typeof pipelineSnapshot>>;
