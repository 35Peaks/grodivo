// Converts rows from the 35 Peaks / Group Black Dome digest data logs into
// (a) verbatim digest_items rows (every type) and (b) signals for deal-type rows.
// Heuristic only: no Claude call. Fit scores and prospects are rough; the live feed enriches.
import { parse } from "csv-parse/sync";
import { normalizeCompany } from "./signals.js";

export interface DigestRow {
  date_logged: string; week_of: string; digest: string; section: string; headline: string; url: string;
  firms_named: string; target_company: string; deal_type: string; deal_size_usd_m: string;
  source_publication: string; summary: string; [k: string]: string;
}

export const parseDigestCsv = (text: string): DigestRow[] =>
  (parse(text.replace(/\r\n?/g, "\n"), { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true, relax_quotes: true }) as DigestRow[])
    .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), typeof v === "string" ? v.trim() : v])) as DigestRow);

const DEAL_TYPES: Record<string, string> = {
  "m&a": "corporate_acquisition", "m&a (acquisition)": "corporate_acquisition", "m&a (merger)": "merger",
  "buyout": "pe_platform", "take-private": "take_private", "add-on": "pe_add_on",
};
const SECTOR: Record<string, string> = {
  "fashion is finance": "Consumer & luxury", "compute is capital": "Digital infrastructure",
  "wm weekly": "Wealth management", "fintech weekly": "Fintech", "oil/gas/energy": "Energy",
};
const PE_LIKE = /\b(capital|partners|equity|investments?|ventures|fund|kkr|blackstone|apollo|carlyle|tpg|bain|cvc|eqt|permira|advent|cinven|warburg|thoma|vista|hellman)\b/i;
const RUMOR = /\b(weigh|weighs|explor|consider|in talks|nears?|eyes|could|sale process|suitors?|bids?|mulls|reportedly|seeks? buyer)/i;
const CLOSED = /\b(complet|closes|closed|finaliz)/i;
const ANNOUNCED = /\b(agree|agreed|sells|sold|sale of|stake|to acquire|to buy|signed|definitive|will acquire|acquires|acquired|buys|bought|merg|announc|takes? private|backs)/i;

const splitFirms = (s: string) => (s || "").split(/;/).map((f) => f.trim()).filter((f) => f && f !== "(multiple)");
const clean = (f: string) => f.replace(/\((seller|buyer|target|sponsor)\)/gi, "").trim();

export function isDealRow(r: DigestRow) {
  return (r.deal_type || "").trim().toLowerCase() in DEAL_TYPES;
}

export function toDigestItem(r: DigestRow, sourceFile: string) {
  const firms = splitFirms(r.firms_named);
  const size = Number(r.deal_size_usd_m);
  return {
    digest: r.digest || "unknown", date_logged: /^\d{4}-\d{2}-\d{2}$/.test(r.date_logged) ? r.date_logged : null,
    week_of: r.week_of || null, section: r.section || null, headline: r.headline, url: r.url || null,
    firms_named: firms.map(clean), sellers: firms.filter((f) => /\(seller\)/i.test(f)).map(clean),
    target_company: r.target_company || null, deal_type: r.deal_type || null,
    deal_size_usd_m: r.deal_size_usd_m && Number.isFinite(size) ? size : null,
    source_publication: r.source_publication || null, summary: r.summary || null, source_file: sourceFile, raw: r,
  };
}

export function toSignal(r: DigestRow, archiveBefore: string) {
  const type = DEAL_TYPES[(r.deal_type || "").trim().toLowerCase()]!;
  const firms = splitFirms(r.firms_named);
  const sellers = firms.filter((f) => /\(seller\)/i.test(f)).map(clean);
  const target = r.target_company?.trim() || null;
  const buyers = firms.filter((f) => !/\(seller\)/i.test(f)).map(clean)
    .filter((f) => !target || normalizeCompany(f) !== normalizeCompany(target));
  const buyer = buyers[0] ?? null;
  const peBuyer = !!buyer && PE_LIKE.test(buyer);
  // Buyouts and take-privates are sponsor deals; add-ons are often strategic (e.g. RIA aggregators), so only
  // treat the buyer as a PE sponsor when the name looks like one
  const peDeal = type === "pe_platform" || type === "take_private";
  const dealType = type === "corporate_acquisition" && peBuyer ? "pe_platform" : type;
  const text = `${r.headline} ${r.summary}`;
  const status = RUMOR.test(text) ? "rumored" : CLOSED.test(text) ? "closed" : ANNOUNCED.test(text) ? "announced" : "unknown";
  const size = Number(r.deal_size_usd_m) || null;

  let fit = { take_private: 70, pe_platform: 70, pe_add_on: 65, corporate_acquisition: 60, merger: 60 }[dealType] ?? 55;
  if (size && size >= 1000) fit += 10; else if (size && size >= 250) fit += 5;
  if (status === "rumored") fit -= 10;
  if (!buyer) fit -= 15;

  const sponsorRole = peDeal || peBuyer;
  const prospects = buyer ? [{
    name: buyer, role: sponsorRole ? "sponsor" : "acquirer", segment: sponsorRole ? "pe" : "corporate_ma",
    angle: null,
  }] : [];
  const date = /^\d{4}-\d{2}-\d{2}$/.test(r.date_logged) ? r.date_logged : null;

  return {
    headline: r.headline, summary: r.summary || null, deal_status: status, deal_type: dealType,
    acquirer: buyer, target, sponsor: sponsorRole ? buyer : null,
    advisors: [], deal_value_usd_m: size, sector: SECTOR[(r.digest || "").toLowerCase()] ?? null, region: null,
    announced_on: date, fit_score: Math.max(0, Math.min(100, fit)), why_grodivo: null, prospects,
    terms: sellers.length ? { sellers: sellers.join("; ") } : {},
    _status: date && date < archiveBefore ? "archived" : "new",
    source: { url: r.url, publisher: r.source_publication || null, title: r.headline,
      published_at: date ? `${date}T12:00:00Z` : null, raw: r },
  };
}

/** Builds ingest batches: signals for deal rows plus every row as a digest item. */
export function buildDigestBatches(files: { name: string; text: string }[], opts: { archiveDays?: number; batchSize?: number } = {}) {
  const archiveBefore = new Date(Date.now() - (opts.archiveDays ?? 14) * 86_400_000).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const rows: { row: DigestRow; file: string }[] = [];
  for (const f of files) {
    for (const row of parseDigestCsv(f.text)) {
      if (!row.headline) continue;
      const k = `${row.url}|${row.headline.toLowerCase()}`;
      if (seen.has(k)) continue;   // the Press Intelligence DB repeats the WM/Fintech logs
      seen.add(k);
      rows.push({ row, file: f.name });
    }
  }
  const size = opts.batchSize ?? 150;
  const batches = [];
  for (let i = 0; i < rows.length; i += size) {
    const chunk = rows.slice(i, i + size);
    const items: unknown[] = [];
    const digest_items = chunk.map(({ row, file }) => {
      let signal_ref: number | null = null;
      if (isDealRow(row) && /^https?:\/\//.test(row.url)) { signal_ref = items.length; items.push(toSignal(row, archiveBefore)); }
      return { ...toDigestItem(row, file), signal_ref };
    });
    batches.push({ origin: "digest", note: `digest backfill ${i / size + 1}`, items, digest_items });
  }
  return { batches, rows: rows.length };
}
