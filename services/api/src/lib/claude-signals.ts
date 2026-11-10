// Claude does the judgment: is this a real deal, what kind, and is there a Grodivo selling moment.
import Anthropic from "@anthropic-ai/sdk";
import type { Candidate } from "./news-sources.js";

export const GRODIVO_BRIEF = `Grodivo sells kAI, an AI platform that de-risks the people side of M&A and transformation:
a 3-minute team assessment (TAP), a Quality of Culture (QoC) diligence report that prices EBITDA and timeline risk,
and ongoing coaching and monitoring through integration. It is priced as a $20-50K one-time deal diagnostic plus
per-employee-per-year kAI seats. It lands on one deal and expands across the client.

Buyer segments (use these exact codes):
- pe: PE firms. Land on one diligence target or platform, expand to every portco and deal.
- corporate_ma: corporate development and integration leaders at acquirers. Land on one acquisition.
- consulting: consulting/advisory firms (integration consultants, Big 4 deal advisory, boutiques). Land on one client deal, expand to a practice license. Firms advising on a deal are channel partners.
- cxo_board: CXOs and boards running a transformation.

Best selling moments, highest first:
1. Announced but not closed deals (integration planning is happening now; pre-close is the ideal window).
2. PE platform acquisitions and add-ons (sponsor + portco).
3. Large corporate acquisitions with significant headcount (more employees = bigger kAI opportunity).
4. Consulting or advisory firms named as advisors on a deal (channel/partner angle).

Fit score 0-100: 80+ = pre-close deal with a clear buyer and 500+ employees involved, or a PE platform/add-on with a named sponsor;
50-79 = relevant but closed, smaller, or missing a buyer; below 50 = weak (asset/property deals, tiny tech tuck-ins with no
people story, pure financing, stock buybacks). Not M&A at all = drop it.`;

const OUTPUT_SPEC = `Return ONLY a JSON array (no prose) of objects with these keys:
ref (the candidate ref, or null for research results), headline, summary (one factual sentence),
deal_status (rumored|announced|pending|closed|terminated|unknown), deal_type (pe_platform|pe_add_on|corporate_acquisition|merger|take_private|carve_out|other),
acquirer, target, sponsor (PE sponsor behind the buyer, else null), advisors ([{name, role}] only if reported),
deal_value_usd_m (number in USD millions, or null), sector, region, announced_on (YYYY-MM-DD or null),
fit_score (0-100), why_grodivo (one or two sentences: the specific selling angle),
prospects ([{name, role: acquirer|sponsor|target|advisor, segment: pe|corporate_ma|consulting|cxo_board, angle}] who Grodivo should pitch, best first, max 3).
Use only facts present in the source. Never invent advisors, values or dates. No em dashes.`;

let client: Anthropic | undefined;
const model = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const getClient = (apiKey: string) => (client ??= new Anthropic({ apiKey }));

/** Pulls the first JSON array out of a model reply (tolerates code fences and stray prose). */
export function extractJsonArray(text: string): unknown[] {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [fenced, text]) {
    if (!candidate) continue;
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start === -1 || end <= start) continue;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* try next */ }
  }
  return [];
}

const textOf = (msg: Anthropic.Message) =>
  msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");

/** Classify and score headline/filing candidates in batches. Returns raw objects with a source attached. */
export async function classifyCandidates(apiKey: string, candidates: Candidate[], batchSize = 40) {
  const out: any[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const msg = await getClient(apiKey).messages.create({
      model: model(),
      max_tokens: 8000,
      system: GRODIVO_BRIEF,
      messages: [{
        role: "user",
        content: `Below are news headlines and SEC filings. Keep only real M&A deals (announced, pending, rumored with named parties, or just closed). Drop everything else.\n\n${OUTPUT_SPEC}\n\nCANDIDATES:\n` +
          batch.map((c) => JSON.stringify({ ref: c.ref, title: c.title, publisher: c.publisher, date: c.published_at, hint: c.hint })).join("\n"),
      }],
    });
    const byRef = new Map(batch.map((c) => [c.ref, c]));
    for (const r of extractJsonArray(textOf(msg)) as any[]) {
      const c = byRef.get(r?.ref);
      if (!c) continue;  // never accept items that don't map back to a real source
      out.push({ ...r, source: { url: c.url, publisher: c.publisher, title: c.title, published_at: c.published_at } });
    }
  }
  return out;
}

/** Curated research pass: Claude searches the web for the day's best Grodivo-relevant deals. */
export async function researchDeals(apiKey: string, maxSearches = 10) {
  const today = new Date().toISOString().slice(0, 10);
  const msg = await getClient(apiKey).messages.create({
    model: model(),
    max_tokens: 12000,
    system: GRODIVO_BRIEF,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearches } as any],
    messages: [{
      role: "user",
      content: `Today is ${today}. Search for M&A deals announced or materially updated in the last 2 days that are strong Grodivo selling moments:
pre-close corporate acquisitions with real headcount, PE platform and add-on acquisitions (name the sponsor), take-privates, carve-outs,
and deals where a consulting or advisory firm is named as an advisor. Favor US deals; include global deals with large US workforces.
Check sources such as Reuters, Bloomberg, WSJ, PE Hub, PitchBook news, Axios Pro Rata, Business Wire and PR Newswire.
Return 5 to 15 of the strongest, each tied to the article you actually read.

${OUTPUT_SPEC}
Also include "source_url", "source_publisher" and "source_title" for the article each item came from. Use ref = null.`,
    }],
  });
  return (extractJsonArray(textOf(msg)) as any[])
    .filter((r) => typeof r?.source_url === "string" && /^https?:\/\//.test(r.source_url))
    .map((r) => ({ ...r, source: { url: r.source_url, publisher: r.source_publisher ?? null, title: r.source_title ?? r.headline, published_at: null } }));
}
