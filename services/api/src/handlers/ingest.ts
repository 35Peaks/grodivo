// Triggered by a new batch in s3://<bucket>/signals/inbox/. Runs inside the VPC: validates,
// dedupes and upserts signals into Postgres, then records the run.
import type { S3Event } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { withTx } from "../lib/db.js";
import { origins, parseSignals, upsertSignals, type Origin } from "../lib/signals.js";

const s3 = new S3Client({});

export async function ingestBatch(batch: { origin?: string; note?: string; items?: unknown[] }) {
  const origin = (origins as readonly string[]).includes(String(batch.origin)) ? (batch.origin as Origin) : "manual";
  const { items, rejected } = parseSignals(batch.items);
  return withTx(null, async (client) => {
    const { created, merged } = await upsertSignals(client, items, origin);
    await client.query(
      `INSERT INTO signal_runs (origin, items_in, created, merged, skipped, note) VALUES ($1, $2, $3, $4, $5, $6)`,
      [origin, (batch.items ?? []).length, created, merged, rejected, batch.note ?? null]);
    return { origin, created, merged, rejected };
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
