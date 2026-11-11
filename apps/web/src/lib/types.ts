import type { Segment, Stage } from "./format";

export interface User { id: string; name: string; email: string; role: "admin" | "manager" | "rep" }
export interface Meta { me: User; users: User[]; stageProbabilities: { stage: Stage; probability: number; sort_order: number }[] }

export interface Deal {
  id: string; name: string; account_id: string; account_name: string; segment: Segment;
  owner_id: string | null; owner_name: string | null; motion: "land" | "expand"; offering: string; stage: Stage;
  one_time_value: number; pepy_rate: number; seats: number; arr: number; effective_probability: number;
  weighted_arr: number; weighted_one_time: number; expected_close: string | null; next_step: string | null;
  next_step_date: string | null; source: string; partner_name: string | null; is_open: boolean; closed_at: string | null;
  created_at: string; updated_at: string;
}
export interface DealDetail extends Deal {
  probability: number | null; lost_reason: string | null; primary_contact_id: string | null;
  activities: Activity[]; history: { from_stage: Stage | null; to_stage: Stage; changed_at: string; changed_by_name: string | null }[];
}
export interface Activity {
  id: string; deal_id: string | null; account_id: string | null; user_id: string | null; user_name: string | null;
  deal_name?: string | null; account_name?: string | null; type: string; summary: string; occurred_at: string;
}
export interface Account {
  id: string; name: string; segment: Segment; parent_account_id: string | null; parent_name: string | null;
  industry: string | null; employee_count: number | null; website: string | null; hq_location: string | null;
  owner_id: string | null; owner_name: string | null; notes: string | null;
  open_deals: number; open_pipeline: number; won_deals: number; carr: number; won_one_time: number;
  landed: boolean | null; child_accounts: number;
}
export interface Contact {
  id: string; account_id: string; name: string; title: string | null; email: string | null; phone: string | null;
  linkedin_url: string | null; is_champion: boolean; notes: string | null;
}
export interface AccountDetail extends Account {
  contacts: Contact[]; children: Account[]; activities: Activity[];
  deals: Pick<Deal, "id" | "name" | "stage" | "motion" | "offering" | "one_time_value" | "arr" | "seats" | "pepy_rate" | "expected_close" | "closed_at" | "is_open" | "owner_name">[];
}
export interface Summary {
  kpis: { open_deals: number; open_pipeline: number; weighted_pipeline: number; open_arr: number; carr: number;
    bookings_ytd: number; won_180: number; lost_180: number; avg_cycle_days: number | null };
  bySegment: { segment: Segment; open_deals: number; open_pipeline: number; weighted_pipeline: number; carr: number }[];
  byStage: { stage: Stage; deals: number; value: number; weighted: number }[];
  mix: { won_one_time: number; won_arr: number; open_one_time: number; open_arr: number };
  landExpand: { motion: "land" | "expand"; open_deals: number; open_pipeline: number; won_deals: number; won_value: number }[];
  pilots: { reached_pilot: number; in_pilot: number; converted: number; lost: number; avg_days_to_convert: number | null };
  forecast: { month: string; weighted_arr: number; weighted_one_time: number; unweighted: number }[];
  target: { target_arr: number; target_bookings: number; period_start: string; period_end: string } | null;
  attention: { id: string; name: string; account_name: string; stage: Stage; owner_name: string | null; value: number;
    expected_close: string | null; next_step: string | null; next_step_date: string | null; last_activity: string | null;
    reason: "overdue_close" | "overdue_next_step" | "no_recent_activity" }[];
}
export interface Scorecard {
  id: string; name: string; email: string; role: string; open_deals: number; open_pipeline: number; weighted_pipeline: number;
  won_arr_qtd: number; won_bookings_qtd: number; won_deals_qtd: number; activities_30d: number;
  quota_arr: number | null; quota_bookings: number | null;
}
export interface Quota { id: string; user_id: string | null; user_name: string | null; period_start: string; period_end: string; target_arr: number; target_bookings: number }
export interface AdminUser { username: string; id: string; email: string; name: string; role: "admin" | "manager" | "rep"; enabled: boolean; status: string; created: string }

export interface SignalProspect { name: string; role: string | null; segment: Segment; angle: string | null }
export interface Signal {
  id: string; headline: string; summary: string | null;
  deal_status: "rumored" | "announced" | "pending" | "closed" | "terminated" | "unknown";
  deal_type: "pe_platform" | "pe_add_on" | "corporate_acquisition" | "merger" | "take_private" | "carve_out" | "other";
  acquirer: string | null; target: string | null; sponsor: string | null;
  advisors: { name: string; role: string | null }[]; deal_value_usd_m: number | null;
  sector: string | null; region: string | null; announced_on: string | null; fit_score: number;
  acquirer_ticker: string | null; target_ticker: string | null; acquirer_hq: string | null; target_hq: string | null;
  target_employees: number | null; acquirer_employees: number | null; consideration: string | null;
  price_per_share: number | null; premium_pct: number | null; expected_close: string | null; closed_on: string | null;
  financing: string | null; approvals: string | null; terms: Record<string, unknown>;
  events: { field: string; old_value: string | null; new_value: string | null; origin: string | null; source_url: string | null; at: string }[];
  why_grodivo: string | null; prospects: SignalProspect[];
  status: "new" | "watching" | "actioned" | "dismissed" | "archived"; status_note: string | null;
  actioned_by_name: string | null; actioned_at: string | null; first_seen_at: string; last_seen_at: string;
  sources: { url: string; publisher: string | null; title: string | null; origin: string; published_at: string | null }[];
  matched_accounts: { id: string; name: string; segment: Segment }[];
  links: { account_id: string | null; account_name: string | null; deal_id: string | null; role: string | null; created_at: string }[];
}
export interface SignalSummary {
  new: number; new_high_fit: number; watching: number; actioned_30d: number; last_24h: number;
  runs: { origin: string; started_at: string; items_in: number; created: number; merged: number; skipped: number; note: string | null }[];
}
