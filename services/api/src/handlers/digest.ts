// Runs inside the VPC on a schedule: reads the pipeline from Postgres and writes a JSON
// snapshot to S3 (via the free S3 gateway endpoint). The S3 write triggers the notify Lambda,
// which runs outside the VPC and can reach Claude and SES without a NAT gateway.
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { pipelineSnapshot } from "../lib/snapshot.js";

const s3 = new S3Client({});

export const handler = async () => {
  const snapshot = await pipelineSnapshot();
  const key = `digests/${snapshot.generatedAt.slice(0, 10)}.json`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.DIGEST_BUCKET,
    Key: key,
    Body: JSON.stringify(snapshot),
    ContentType: "application/json",
  }));
  return { key };
};
