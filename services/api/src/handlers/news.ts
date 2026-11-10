// Weekday news run (outside the VPC, so it can reach FMP, GDELT and Claude).
// Writes one JSON batch per origin to S3; the ingest Lambda (inside the VPC) loads them into Postgres.
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { fetchFmp, fetchGdelt } from "../lib/news-sources.js";
import { classifyCandidates, researchDeals } from "../lib/claude-signals.js";
import type { Origin } from "../lib/signals.js";

const s3 = new S3Client({});
const secrets = new SecretsManagerClient({});

async function secret(arn: string | undefined): Promise<string | null> {
  if (!arn) return null;
  const v = (await secrets.send(new GetSecretValueCommand({ SecretId: arn }))).SecretString?.trim();
  return v && v !== "REPLACE_ME" ? v : null;
}

async function put(origin: Origin, items: unknown[], note: string) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `signals/inbox/${day}/${origin}-${Date.now()}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.DIGEST_BUCKET, Key: key, ContentType: "application/json",
    Body: JSON.stringify({ origin, generated_at: new Date().toISOString(), note, items }),
  }));
  return key;
}

export const handler = async (event: { sources?: Origin[] } = {}) => {
  const anthropicKey = await secret(process.env.ANTHROPIC_SECRET_ARN);
  if (!anthropicKey) throw new Error("Anthropic API key not set in Secrets Manager; signals need Claude to classify news");
  const fmpKey = await secret(process.env.FMP_SECRET_ARN);
  const want = new Set<Origin>(event.sources ?? ["fmp", "gdelt", "claude_research"]);
  const report: Record<string, unknown> = {};

  // Each source is independent: one failing never blocks the others.
  const jobs: Promise<void>[] = [];
  if (want.has("fmp")) jobs.push((async () => {
    if (!fmpKey) { report.fmp = "skipped: no FMP key"; return; }
    const cands = await fetchFmp(fmpKey);
    const items = await classifyCandidates(anthropicKey, cands);
    report.fmp = { candidates: cands.length, kept: items.length, key: await put("fmp", items, `${cands.length} filings`) };
  })().catch((e) => { report.fmp = `error: ${e.message}`; }));

  if (want.has("gdelt")) jobs.push((async () => {
    const cands = await fetchGdelt();
    const items = await classifyCandidates(anthropicKey, cands);
    report.gdelt = { candidates: cands.length, kept: items.length, key: await put("gdelt", items, `${cands.length} headlines`) };
  })().catch((e) => { report.gdelt = `error: ${e.message}`; }));

  if (want.has("claude_research")) jobs.push((async () => {
    const items = await researchDeals(anthropicKey);
    report.claude_research = { kept: items.length, key: await put("claude_research", items, "web research") };
  })().catch((e) => { report.claude_research = `error: ${e.message}`; }));

  await Promise.all(jobs);
  console.log(JSON.stringify(report));
  return report;
};
