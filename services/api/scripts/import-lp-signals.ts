// Loads the 35 Peaks Pension Signal Monitor (public pension board actions) into the dashboard database.
//
// 1. Export from the monitor's SQLite DB (joins plans, counterparties, source documents, reconciled entities):
//      npx tsx scripts/import-lp-signals.ts --export <path/to/public_plans.db> <export.json>
//    (needs the sqlite3 CLI; or use the Python one-liner in docs/lp-signals.md)
// 2. Build ingest batches and upload to s3://<digests bucket>/signals/inbox/ ...
//      npx tsx scripts/import-lp-signals.ts --out ./lp-batches <export.json>
//    ... or load a database directly:
//      DATABASE_URL=... npx tsx scripts/import-lp-signals.ts --db <export.json>
// Upserts on signal_key, so re-running refreshes records.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EXPORT_SQL = `select s.signal_key, s.period, s.event_date, s.signal_category, s.signal_type, s.asset_class, s.manager_family,
 s.amount_usd_m, s.relevance, s.action_detail, s.source_snippet, s.created_at, p.name plan, p.plan_type, p.state, p.region,
 p.aum_tier, p.priority, cp.name counterparty, cp.cp_role, d.source_name, d.title source_title, d.url source_url, d.source_type,
 d.doc_type, d.doc_date, d.retrieved_at, e.canonical_name manager_entity, e.entity_type
 from signals s left join plans p on p.plan_id=s.plan_id left join counterparties cp on cp.cp_id=s.cp_id
 left join source_documents d on d.source_doc_id=s.source_doc_id left join entities e on e.entity_id=s.entity_id`;

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

if (args[0] === "--export") {
  const [, db, out] = args;
  const json = execFileSync("sqlite3", ["-json", "-readonly", db!, EXPORT_SQL], { maxBuffer: 1 << 28 }).toString();
  writeFileSync(out!, json);
  console.log(`exported ${JSON.parse(json).length} records to ${out}`);
  process.exit(0);
}

const input = args[args.length - 1]!;
const rows: Record<string, unknown>[] = JSON.parse(readFileSync(input, "utf8"));
const size = 400;
const batches = [];
for (let i = 0; i < rows.length; i += size) batches.push({ origin: "lp_signals", note: `pension monitor ${i / size + 1}`, lp_signals: rows.slice(i, i + size) });
console.log(`${rows.length} records, ${batches.length} batches`);

const out = flag("--out");
if (out) {
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  batches.forEach((b, i) => writeFileSync(join(out, `lp-${stamp}-${String(i + 1).padStart(3, "0")}.json`), JSON.stringify(b)));
  console.log(`wrote ${batches.length} batch files to ${out}`);
}
if (args.includes("--db")) {
  const { ingestBatch } = await import("../src/handlers/ingest.js");
  for (const b of batches) console.log(JSON.stringify(await ingestBatch(b as any)));
  process.exit(0);
}
