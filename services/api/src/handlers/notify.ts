// Triggered by a new digest snapshot in S3. Asks Claude for a short pipeline commentary
// and emails the weekly digest to the team through SES. Runs outside the VPC.
import type { S3Event } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import Anthropic from "@anthropic-ai/sdk";
import type { Snapshot } from "../lib/snapshot.js";

const s3 = new S3Client({});
const ses = new SESv2Client({});
const secrets = new SecretsManagerClient({});

const usd = (n: number) => "$" + Math.round(Number(n)).toLocaleString("en-US");
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));
const label = (s: string) => s.replace(/_/g, " ");

async function commentary(snapshot: Snapshot): Promise<string | null> {
  try {
    const secret = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.ANTHROPIC_SECRET_ARN }));
    const apiKey = secret.SecretString?.trim();
    if (!apiKey || apiKey === "REPLACE_ME") return null;
    const client = new Anthropic({ apiKey });
    const { recipients: _r, ...data } = snapshot;
    const msg = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      max_tokens: 600,
      messages: [{
        role: "user",
        content:
          "You write the weekly pipeline note for Grodivo's sales team. Grodivo sells kAI to PE firms, " +
          "corporate M&A teams, consulting/advisory firms, and CXOs/boards, landing one deal then expanding. " +
          "Using only the JSON below, write 3 to 5 short bullet points: what moved, where the risk is, and the " +
          "one or two actions that matter most this week. Plain text bullets starting with '- '. No em dashes. " +
          "Do not invent numbers.\n\n" + JSON.stringify(data),
      }],
    });
    const block = msg.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("Claude commentary failed; sending digest without it", err);
    return null;
  }
}

function renderHtml(s: Snapshot, note: string | null) {
  const t = s.totals as any;
  const rows = (items: any[], cols: [string, (r: any) => string][]) =>
    items.length
      ? `<table cellpadding="6" style="border-collapse:collapse;font-size:13px;width:100%">
          <tr>${cols.map(([h]) => `<th align="left" style="border-bottom:1px solid #ddd">${h}</th>`).join("")}</tr>
          ${items.map((r) => `<tr>${cols.map(([, f]) => `<td style="border-bottom:1px solid #f0f0f0">${f(r)}</td>`).join("")}</tr>`).join("")}
         </table>`
      : `<p style="color:#888;font-size:13px">None this week.</p>`;
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:680px;color:#1a1a1a">
    <h2 style="margin-bottom:4px">Grodivo weekly pipeline</h2>
    <p style="color:#666;margin-top:0">${esc(s.generatedAt.slice(0, 10))}</p>
    <p style="font-size:15px">Open pipeline <b>${usd(t.open_pipeline)}</b> across <b>${t.open_deals}</b> deals ·
       weighted <b>${usd(t.weighted_pipeline)}</b> · cARR <b>${usd(t.carr)}</b>${s.targetArr ? ` of ${usd(s.targetArr)} target` : ""}</p>
    ${note ? `<h3>This week</h3><div style="white-space:pre-wrap;font-size:14px">${esc(note)}</div>` : ""}
    <h3>Stage changes</h3>
    ${rows(s.movedThisWeek, [["Deal", (r) => esc(r.name)], ["Account", (r) => esc(r.account)],
      ["Move", (r) => `${esc(label(r.from_stage))} → ${esc(label(r.to_stage))}`], ["Value", (r) => usd(r.value)]])}
    <h3>New deals</h3>
    ${rows(s.newDeals, [["Deal", (r) => esc(r.name)], ["Account", (r) => esc(r.account)],
      ["Stage", (r) => esc(label(r.stage))], ["Value", (r) => usd(r.value)]])}
    <h3>Needs attention</h3>
    ${rows(s.needsAttention, [["Deal", (r) => esc(r.name)], ["Owner", (r) => esc(r.owner_name ?? "Unassigned")],
      ["Close date", (r) => esc(r.expected_close ? String(r.expected_close).slice(0, 10) : "None")], ["Value", (r) => usd(r.value)]])}
    <p style="margin-top:24px"><a href="${esc(process.env.APP_URL)}">Open the dashboard</a></p>
  </div>`;
}

export const handler = async (event: S3Event) => {
  for (const record of event.Records) {
    const obj = await s3.send(new GetObjectCommand({
      Bucket: record.s3.bucket.name,
      Key: decodeURIComponent(record.s3.object.key.replace(/\+/g, " ")),
    }));
    const snapshot = JSON.parse(await obj.Body!.transformToString()) as Snapshot;
    const to = snapshot.recipients.map((r) => r.email);
    if (!to.length) continue;
    const note = await commentary(snapshot);
    await ses.send(new SendEmailCommand({
      FromEmailAddress: process.env.FROM_ADDRESS,
      Destination: { BccAddresses: to },
      Content: { Simple: {
        Subject: { Data: `Grodivo pipeline: week of ${snapshot.generatedAt.slice(0, 10)}` },
        Body: {
          Html: { Data: renderHtml(snapshot, note) },
          Text: { Data: `Open pipeline ${usd((snapshot.totals as any).open_pipeline)}. ${note ?? ""}\n\n${process.env.APP_URL}` },
        },
      } },
    }));
  }
};
