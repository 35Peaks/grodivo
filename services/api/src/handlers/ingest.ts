// Triggered by a new batch in s3://<bucket>/signals/inbox/. Runs inside the VPC: validates,
// dedupes and upserts signals into Postgres, then records the run.
import type { S3Event } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { withTx } from "../lib/db.js";
import { origins, parseSignals, recordCandidates, upsertSignals, type CandidateRecord, type Origin } from "../lib/signals.js";

const s3 = new S3Client({});

export async function ingestBatch(batch: { origin?: string; note?: string; items?: unknown[]; candidates?: CandidateRecord[] }) {
  const origin = (origins as readonly string[]).includes(String(batch.origin)) ? (batch.origin as Origin) : "manual";
  const { items, rejected } = parseSignals(batch.items);
  return withTx(null, async (client) => {
    const run = (await client.query<{ id: number }>(
      `INSERT INTO signal_runs (origin, items_in, note) VALUES ($1, $2, $3) RETURNING id`,
      [origin, (batch.items ?? []).length, batch.note ?? null])).rows[0]!;
    const { created, merged, ids } = await upsertSignals(client, items, origin);
    await client.query(`UPDATE signal_runs SET created = $2, merged = $3, skipped = $4 WHERE id = $1`, [run.id, created, merged, rejected]);

    // Audit trail: every candidate, kept or dropped (research batches log their kept items)
    const urlToSignal = new Map(items.map((s, i) => [s.source.url, ids[i]!]));
    const cands: CandidateRecord[] = Array.isArray(batch.candidates) && batch.candidates.length
      ? batch.candidates.filter((c) => c && typeof c.url === "string")
      : items.map((s) => ({ url: s.source.url, title: s.source.title, published_at: s.source.published_at ?? null, kept: true, reason: null, raw: s.source.raw }));
    await recordCandidates(client, run.id, origin, cands, urlToSignal);
    return { origin, created, merged, rejected, candidates: cands.length };
  });
}

export const handler = async (event: S3Event) => {
  const results = [];
  for (const record of event.Records) {
    const obj = await s3.send(new GetObjectCommand({
      Bucket: record.s3.bucket.name,
      Key: decodeURIComponent(record.s3.object.key.replace(/\+/g, " ")),
    }));
    results.push(await ingestBatch(JSON.parse(await obj.Body!.transformToString())));
  }
  console.log(JSON.stringify(results));
  return results;
};
