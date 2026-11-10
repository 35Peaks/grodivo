import { Hono } from "hono";
import { query } from "../lib/db.js";
import type { AppEnv } from "../lib/auth.js";

export const dashboard = new Hono<AppEnv>();

/** Optional filters shared by dashboard queries. Returns SQL fragment for deal_metrics alias "d". */
function filters(c: { req: { query: (k: string) => string | undefined } }) {
  const where: string[] = [];
  const params: unknown[] = [];
  const owner = c.req.query("owner");
  const segment = c.req.query("segment");
  if (owner) { params.push(owner); where.push(`d.owner_id = $${params.length}`); }
  if (segment) { params.push(segment); where.push(`d.segment = $${params.length}`); }
  return { sql: where.length ? ` AND ${where.join(" AND ")}` : "", params };
}

dashboard.get("/summary", async (c) => {
  const f = filters(c);

  const [kpis] = await query(
    `SELECT
       COUNT(*) FILTER (WHERE d.is_open)                                         AS open_deals,
       COALESCE(SUM(d.one_time_value + d.arr) FILTER (WHERE d.is_open), 0)       AS open_pipeline,
       COALESCE(SUM(d.weighted_one_time + d.weighted_arr) FILTER (WHERE d.is_open), 0) AS weighted_pipeline,
       COALESCE(SUM(d.arr) FILTER (WHERE d.is_open), 0)                          AS open_arr,
       COALESCE(SUM(d.arr) FILTER (WHERE d.stage = 'closed_won'), 0)             AS carr,
       COALESCE(SUM(d.one_time_value) FILTER (WHERE d.stage = 'closed_won'
         AND d.closed_at >= date_trunc('year', now())), 0)                       AS bookings_ytd,
       COUNT(*) FILTER (WHERE d.stage = 'closed_won' AND d.closed_at >= now() - interval '180 days') AS won_180,
       COUNT(*) FILTER (WHERE d.stage = 'closed_lost' AND d.closed_at >= now() - interval '180 days') AS lost_180,
       ROUND(AVG(EXTRACT(EPOCH FROM (d.closed_at - d.created_at)) / 86400)
         FILTER (WHERE d.stage = 'closed_won'))                                  AS avg_cycle_days
     FROM deal_metrics d WHERE true ${f.sql}`,
    f.params,
  );

  const bySegment = await query(
    `SELECT s.segment,
            COUNT(d.id) FILTER (WHERE d.is_open)                                   AS open_deals,
            COALESCE(SUM(d.one_time_value + d.arr) FILTER (WHERE d.is_open), 0)    AS open_pipeline,
            COALESCE(SUM(d.weighted_one_time + d.weighted_arr) FILTER (WHERE d.is_open), 0) AS weighted_pipeline,
            COALESCE(SUM(d.arr) FILTER (WHERE d.stage = 'closed_won'), 0)          AS carr
     FROM unnest(enum_range(NULL::segment)) AS s(segment)
     LEFT JOIN deal_metrics d ON d.segment = s.segment ${f.sql}
     GROUP BY s.segment ORDER BY s.segment`,
    f.params,
  );

  const byStage = await query(
    `SELECT sp.stage, sp.sort_order,
            COUNT(d.id)                                       AS deals,
            COALESCE(SUM(d.one_time_value + d.arr), 0)        AS value,
            COALESCE(SUM(d.weighted_one_time + d.weighted_arr), 0) AS weighted
     FROM stage_probabilities sp
     LEFT JOIN deal_metrics d ON d.stage = sp.stage ${f.sql}
     GROUP BY sp.stage, sp.sort_order ORDER BY sp.sort_order`,
    f.params,
  );

  const [mix] = await query(
    `SELECT
       COALESCE(SUM(d.one_time_value) FILTER (WHERE d.stage = 'closed_won'), 0) AS won_one_time,
       COALESCE(SUM(d.arr)            FILTER (WHERE d.stage = 'closed_won'), 0) AS won_arr,
       COALESCE(SUM(d.one_time_value) FILTER (WHERE d.is_open), 0)             AS open_one_time,
       COALESCE(SUM(d.arr)            FILTER (WHERE d.is_open), 0)             AS open_arr
     FROM deal_metrics d WHERE true ${f.sql}`,
    f.params,
  );

  const landExpand = await query(
    `SELECT m.motion,
            COUNT(d.id) FILTER (WHERE d.is_open)                                AS open_deals,
            COALESCE(SUM(d.one_time_value + d.arr) FILTER (WHERE d.is_open), 0) AS open_pipeline,
            COUNT(d.id) FILTER (WHERE d.stage = 'closed_won')                   AS won_deals,
            COALESCE(SUM(d.one_time_value + d.arr) FILTER (WHERE d.stage = 'closed_won'), 0) AS won_value
     FROM unnest(enum_range(NULL::deal_motion)) AS m(motion)
     LEFT JOIN deal_metrics d ON d.motion = m.motion ${f.sql}
     GROUP BY m.motion ORDER BY m.motion`,
    f.params,
  );

  // Pilot funnel: every deal that ever reached the pilot stage, and where it ended up
  const [pilots] = await query(
    `WITH piloted AS (
       SELECT d.id, d.stage, d.closed_at, MIN(h.changed_at) AS pilot_at
       FROM deal_metrics d JOIN deal_stage_history h ON h.deal_id = d.id AND h.to_stage = 'pilot'
       WHERE true ${f.sql}
       GROUP BY d.id, d.stage, d.closed_at)
     SELECT COUNT(*)                                             AS reached_pilot,
            COUNT(*) FILTER (WHERE stage = 'pilot')              AS in_pilot,
            COUNT(*) FILTER (WHERE stage = 'closed_won')         AS converted,
            COUNT(*) FILTER (WHERE stage = 'closed_lost')        AS lost,
            ROUND(AVG(EXTRACT(EPOCH FROM (closed_at - pilot_at)) / 86400)
              FILTER (WHERE stage = 'closed_won'))               AS avg_days_to_convert
     FROM piloted`,
    f.params,
  );

  // Weighted forecast by expected close month (next 6 months, plus overdue bucket)
  const forecast = await query(
    `WITH months AS (
       SELECT generate_series(date_trunc('month', now()), date_trunc('month', now()) + interval '5 months', interval '1 month')::date AS month)
     SELECT to_char(m.month, 'YYYY-MM') AS month,
            COALESCE(SUM(d.weighted_arr), 0)      AS weighted_arr,
            COALESCE(SUM(d.weighted_one_time), 0) AS weighted_one_time,
            COALESCE(SUM(d.arr + d.one_time_value), 0) AS unweighted
     FROM months m
     LEFT JOIN deal_metrics d ON d.is_open
       AND date_trunc('month', GREATEST(d.expected_close, current_date)) = m.month ${f.sql}
     GROUP BY m.month ORDER BY m.month`,
    f.params,
  );

  const [target] = await query(
    `SELECT target_arr, target_bookings, period_start, period_end FROM quotas
     WHERE user_id IS NULL AND current_date BETWEEN period_start AND period_end
     ORDER BY period_start DESC LIMIT 1`,
  );

  const attention = await query(
    `SELECT d.id, d.name, d.account_name, d.stage, d.owner_id, u.name AS owner_name,
            d.one_time_value + d.arr AS value, d.expected_close, d.next_step, d.next_step_date,
            la.last_activity,
            CASE WHEN d.expected_close < current_date THEN 'overdue_close'
                 WHEN d.next_step_date < current_date THEN 'overdue_next_step'
                 ELSE 'no_recent_activity' END AS reason
     FROM deal_metrics d
     LEFT JOIN users u ON u.id = d.owner_id
     LEFT JOIN LATERAL (SELECT MAX(occurred_at) AS last_activity FROM activities a WHERE a.deal_id = d.id) la ON true
     WHERE d.is_open ${f.sql}
       AND (d.expected_close < current_date OR d.next_step_date < current_date
            OR COALESCE(la.last_activity, d.created_at) < now() - interval '21 days')
     ORDER BY d.one_time_value + d.arr DESC LIMIT 15`,
    f.params,
  );

  return c.json({ kpis, bySegment, byStage, mix, landExpand, pilots, forecast, target: target ?? null, attention });
});

dashboard.get("/scorecards", async (c) => {
  const rows = await query(
    `WITH q AS (SELECT date_trunc('quarter', now())::date AS qs,
                       (date_trunc('quarter', now()) + interval '3 months')::date AS qe)
     SELECT u.id, u.name, u.email, u.role,
            COUNT(d.id) FILTER (WHERE d.is_open)                                   AS open_deals,
            COALESCE(SUM(d.one_time_value + d.arr) FILTER (WHERE d.is_open), 0)    AS open_pipeline,
            COALESCE(SUM(d.weighted_one_time + d.weighted_arr) FILTER (WHERE d.is_open), 0) AS weighted_pipeline,
            COALESCE(SUM(d.arr) FILTER (WHERE d.stage = 'closed_won' AND d.closed_at >= q.qs), 0) AS won_arr_qtd,
            COALESCE(SUM(d.one_time_value) FILTER (WHERE d.stage = 'closed_won' AND d.closed_at >= q.qs), 0) AS won_bookings_qtd,
            COUNT(d.id) FILTER (WHERE d.stage = 'closed_won' AND d.closed_at >= q.qs) AS won_deals_qtd,
            (SELECT COUNT(*) FROM activities a WHERE a.user_id = u.id AND a.occurred_at >= now() - interval '30 days') AS activities_30d,
            (SELECT target_arr FROM quotas qq WHERE qq.user_id = u.id
               AND current_date BETWEEN qq.period_start AND qq.period_end ORDER BY qq.period_start DESC LIMIT 1) AS quota_arr,
            (SELECT target_bookings FROM quotas qq WHERE qq.user_id = u.id
               AND current_date BETWEEN qq.period_start AND qq.period_end ORDER BY qq.period_start DESC LIMIT 1) AS quota_bookings
     FROM users u CROSS JOIN q
     LEFT JOIN deal_metrics d ON d.owner_id = u.id
     WHERE u.active
     GROUP BY u.id, q.qs ORDER BY weighted_pipeline DESC, u.name`,
  );
  return c.json(rows);
});
