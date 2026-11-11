// Backfill / ongoing import of the scheduled-digest data logs into the signals database.
//
//   npx tsx scripts/import-digests.ts --out ./digest-batches  <csv files...>
//       writes ingest-ready JSON batches; upload them to s3://<digests bucket>/signals/inbox/ and the
//       ingest Lambda loads them (same path as the daily feed, no new infrastructure)
//   DATABASE_URL=... npx tsx scripts/import-digests.ts --db <csv files...>
//       loads straight into a database (local dev, or a bastion/VPN session)
//
// Safe to re-run: stories dedupe on url + headline, deals dedupe on buyer + target.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { buildDigestBatches } from "../src/lib/digest-import.js";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const out = outIdx >= 0 ? args[outIdx + 1] : null;
const toDb = args.includes("--db");
const archiveIdx = args.indexOf("--archive-days");
const archiveDays = archiveIdx >= 0 ? Number(args[archiveIdx + 1]) : 14;
const files = args.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1 && i !== archiveIdx + 1 && a.endsWith(".csv"));
if (!files.length || (!out && !toDb)) {
  console.error("usage: import-digests.ts (--out <dir> | --db) [--archive-days 14] <file.csv>...");
  process.exit(1);
}

const { batches, rows } = buildDigestBatches(files.map((f) => ({ name: basename(f), text: readFileSync(f, "utf8") })), { archiveDays });
const deals = batches.reduce((n, b) => n + b.items.length, 0);
console.log(`${files.length} files, ${rows} unique rows, ${deals} deal rows, ${batches.length} batches`);

if (out) {
  mkdirSync(out, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  batches.forEach((b, i) => writeFileSync(join(out, `digest-${stamp}-${String(i + 1).padStart(3, "0")}.json`), JSON.stringify(b)));
  console.log(`wrote ${batches.length} batch files to ${out}`);
}
if (toDb) {
  const { ingestBatch } = await import("../src/handlers/ingest.js");
  for (const b of batches) console.log(JSON.stringify(await ingestBatch(b)));
  process.exit(0);
}
