export const SEGMENTS = ["pe", "corporate_ma", "consulting", "cxo_board"] as const;
export const STAGES = ["lead", "qualified", "discovery", "proposal", "pilot", "negotiation", "closed_won", "closed_lost"] as const;
export const OPEN_STAGES = STAGES.slice(0, 6);
export const OFFERINGS = ["diagnostic", "kai_subscription", "enterprise_transformation", "pilot"] as const;
export const SOURCES = ["direct", "partner", "referral", "inbound", "event", "investor", "news_signal"] as const;
export const MOTIONS = ["land", "expand"] as const;
export const SIGNAL_TYPES = ["pe_platform", "pe_add_on", "corporate_acquisition", "merger", "take_private", "carve_out", "other"] as const;
export const SIGNAL_DEAL_STATUSES = ["rumored", "announced", "pending", "closed", "terminated", "unknown"] as const;
export const ACTIVITY_TYPES = ["call", "email", "meeting", "demo", "note", "task"] as const;
export type Segment = (typeof SEGMENTS)[number];
export type Stage = (typeof STAGES)[number];

export const LABELS: Record<string, string> = {
  pe: "PE firms", corporate_ma: "Corporate M&A", consulting: "Consulting / Advisory", cxo_board: "CXOs & Boards",
  lead: "Lead", qualified: "Qualified", discovery: "Discovery", proposal: "Proposal", pilot: "Pilot",
  negotiation: "Negotiation", closed_won: "Closed won", closed_lost: "Closed lost",
  diagnostic: "Deal diagnostic", kai_subscription: "kAI subscription", enterprise_transformation: "Enterprise transformation",
  land: "Land", expand: "Expand",
  direct: "Direct", partner: "Partner", referral: "Referral", inbound: "Inbound", event: "Event", investor: "Investor intro",
  call: "Call", email: "Email", meeting: "Meeting", demo: "Demo", note: "Note", task: "Task",
  admin: "Admin", manager: "Manager", rep: "Rep", news_signal: "M&A signal",
  pe_platform: "PE platform", pe_add_on: "PE add-on", corporate_acquisition: "Corporate acquisition", merger: "Merger",
  take_private: "Take-private", carve_out: "Carve-out", other: "Other",
  rumored: "Rumored", announced: "Announced", pending: "Pending close", closed: "Closed", terminated: "Terminated", unknown: "Status unclear",
  fmp: "SEC filings (FMP)", gdelt: "News wire (GDELT)", claude_research: "Claude research", manual: "Added by team",
  acquirer: "Acquirer", target: "Target", sponsor: "Sponsor", advisor: "Advisor",
};
export const label = (k: string | null | undefined) => (k ? LABELS[k] ?? k.replace(/_/g, " ") : "");

/** Categorical slot per segment: fixed order, never re-assigned by rank or filter. */
export const SEGMENT_COLOR: Record<Segment, string> = {
  pe: "var(--series-1)", corporate_ma: "var(--series-2)", consulting: "var(--series-3)", cxo_board: "var(--series-4)",
};

export function usd(n: number | null | undefined, opts: { compact?: boolean } = {}) {
  const v = Number(n ?? 0);
  if (opts.compact && Math.abs(v) >= 1000) {
    return "$" + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: Math.abs(v) >= 1e6 ? 2 : 0 }).format(v);
  }
  return "$" + Math.round(v).toLocaleString("en-US");
}
export const num = (n: number | null | undefined) => Number(n ?? 0).toLocaleString("en-US");
export const pct = (n: number) => `${Math.round(n)}%`;

export function date(d: string | null | undefined) {
  if (!d) return "";
  const dt = d.length === 10 ? new Date(d + "T00:00:00") : new Date(d);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function relative(d: string | null | undefined) {
  if (!d) return "";
  const days = Math.round((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date(d);
}
export const isPast = (d: string | null | undefined) => !!d && d < new Date().toISOString().slice(0, 10);
