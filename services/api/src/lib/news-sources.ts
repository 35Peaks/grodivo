// Raw news collectors. Each returns lightweight candidates for Claude to classify and score.

export interface Candidate {
  ref: string;             // short id used to match Claude's output back to the candidate
  title: string;
  url: string;
  publisher: string | null;
  published_at: string | null;
  hint?: string;           // structured context (e.g. FMP filing fields)
  raw: unknown;            // the provider's original record, stored verbatim in the database
}

const UA = "GrodivoSalesSignals/1.0 (+https://grodivo.ai)";

async function getJson(url: string, timeoutMs = 20_000): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).host} responded ${res.status}`);
  return res.json();
}

/** Financial Modeling Prep: latest M&A filings (public companies, SEC-sourced). */
export async function fetchFmp(apiKey: string, sinceDays = 3): Promise<Candidate[]> {
  const url = `https://financialmodelingprep.com/stable/mergers-acquisitions-latest?page=0&limit=200&apikey=${encodeURIComponent(apiKey)}`;
  const rows: any[] = await getJson(url);
  const cutoff = Date.now() - sinceDays * 86_400_000;
  const out: Candidate[] = [];
  for (const [i, r] of (Array.isArray(rows) ? rows : []).entries()) {
    const accepted = Date.parse(r.acceptedDate ?? r.transactionDate ?? "");
    if (!Number.isNaN(accepted) && accepted < cutoff) continue;
    if (!r.link || !r.companyName) continue;
    out.push({
      ref: `fmp${i}`,
      title: `${r.companyName}${r.symbol ? ` (${r.symbol})` : ""} / ${r.targetedCompanyName ?? "undisclosed target"}${r.targetedSymbol ? ` (${r.targetedSymbol})` : ""}`,
      url: r.link,
      publisher: "SEC filing via Financial Modeling Prep",
      published_at: Number.isNaN(accepted) ? null : new Date(accepted).toISOString(),
      raw: r,
      hint: `SEC M&A filing. Acquirer: ${r.companyName} (${r.symbol ?? "n/a"}). Target: ${r.targetedCompanyName ?? "n/a"} (${r.targetedSymbol ?? "n/a"}). Transaction date: ${r.transactionDate ?? "n/a"}.`,
    });
  }
  return out;
}

const DEAL_WORDS = /\b(acquir\w*|acquisition|merg(?:er|ers|e|es|ing)|to buy|buys|bought|take[- ]private|takeover|add-on|platform investment|carve[- ]out|divest\w*|majority stake|agreed to sell|deal to)\b/i;

/** GDELT DOC 2.0: English-language M&A headlines from the last day. Free, no key. */
export async function fetchGdelt(hours = 24, max = 150): Promise<Candidate[]> {
  const q = '("to acquire" OR "agreed to acquire" OR "acquisition of" OR "merger agreement" OR "take private" OR "add-on acquisition" OR "majority stake" OR "private equity firm") sourcelang:english';
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&format=json&sort=DateDesc&maxrecords=${max}&timespan=${hours}h`;
  const data = await getJson(url, 30_000);
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const [i, a] of ((data?.articles ?? []) as any[]).entries()) {
    const title = String(a.title ?? "").trim();
    if (!title || !a.url || !DEAL_WORDS.test(title)) continue;
    const norm = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").slice(0, 80);
    if (seen.has(norm)) continue;   // syndicated duplicates
    seen.add(norm);
    out.push({
      ref: `gd${i}`,
      title,
      url: a.url,
      publisher: a.domain ?? null,
      published_at: parseGdeltDate(a.seendate),
      raw: a,
    });
  }
  return out;
}

/** GDELT seendate looks like 20261110T143000Z */
export function parseGdeltDate(s: unknown): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(s ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}
