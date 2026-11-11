import { z } from "zod";
import type { Context } from "hono";

export const segments = ["pe", "corporate_ma", "consulting", "cxo_board"] as const;
export const stages = ["lead", "qualified", "discovery", "proposal", "pilot", "negotiation", "closed_won", "closed_lost"] as const;
export const offerings = ["diagnostic", "kai_subscription", "enterprise_transformation", "pilot"] as const;
export const sources = ["direct", "partner", "referral", "inbound", "event", "investor", "news_signal", "lp_signal"] as const;
export const motions = ["land", "expand"] as const;
export const activityTypes = ["call", "email", "meeting", "demo", "note", "task"] as const;

const optText = z.string().trim().max(5000).nullish().transform((v) => (v ? v : null));
const optDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().transform((v) => v ?? null);
const uuid = z.string().uuid();

export const accountInput = z.object({
  name: z.string().trim().min(1).max(200),
  segment: z.enum(segments),
  parent_account_id: uuid.nullish(),
  industry: optText,
  employee_count: z.number().int().min(0).nullish(),
  website: optText,
  hq_location: optText,
  owner_id: uuid.nullish(),
  notes: optText,
});

export const contactInput = z.object({
  account_id: uuid,
  name: z.string().trim().min(1).max(200),
  title: optText,
  email: z.string().trim().email().nullish().or(z.literal("").transform(() => null)),
  phone: optText,
  linkedin_url: optText,
  is_champion: z.boolean().optional(),
  notes: optText,
});

export const dealInput = z.object({
  account_id: uuid,
  name: z.string().trim().min(1).max(200),
  owner_id: uuid.nullish(),
  primary_contact_id: uuid.nullish(),
  motion: z.enum(motions).default("land"),
  offering: z.enum(offerings),
  stage: z.enum(stages).default("lead"),
  one_time_value: z.number().min(0).default(0),
  pepy_rate: z.number().min(0).default(0),
  seats: z.number().int().min(0).default(0),
  probability: z.number().int().min(0).max(100).nullish(),
  expected_close: optDate,
  lost_reason: optText,
  source: z.enum(sources).default("direct"),
  partner_name: optText,
  next_step: optText,
  next_step_date: optDate,
});

export const activityInput = z.object({
  deal_id: uuid.nullish(),
  account_id: uuid.nullish(),
  type: z.enum(activityTypes),
  summary: z.string().trim().min(1).max(5000),
  occurred_at: z.string().datetime({ offset: true }).optional(),
}).refine((v) => v.deal_id || v.account_id, "deal_id or account_id is required");

export const quotaInput = z.object({
  user_id: uuid.nullable(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target_arr: z.number().min(0),
  target_bookings: z.number().min(0).default(0),
});

export async function parseBody<T extends z.ZodTypeAny>(c: Context<any>, schema: T, partial = false): Promise<z.infer<T>> {
  const body = await c.req.json().catch(() => ({}));
  const s: any = partial && "partial" in schema ? (schema as any).partial() : schema;
  const parsed = s.parse(body);
  if (!partial || typeof body !== "object" || body === null) return parsed;
  // PATCH: keep only fields the client actually sent, so schema defaults never overwrite stored values
  return Object.fromEntries(Object.entries(parsed).filter(([k]) => k in body)) as z.infer<T>;
}

/** Builds "col = $n" pairs from a validated partial object, limited to allowed columns. */
export function updateSet(data: Record<string, unknown>, allowed: readonly string[], startIndex = 1) {
  const cols = Object.keys(data).filter((k) => allowed.includes(k) && data[k] !== undefined);
  return {
    sql: cols.map((k, i) => `${k} = $${i + startIndex}`).join(", "),
    values: cols.map((k) => data[k]),
    count: cols.length,
  };
}
