// Applies db/migrations/*.sql in order. Invoked by CI after each deploy.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db } from "../lib/db.js";

export const handler = async () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await db().connect();
  const applied: string[] = [];
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    // Serialize concurrent runs
    await client.query(`SELECT pg_advisory_lock(727001)`);
    const done = new Set((await client.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(727001)`).catch(() => {});
    client.release();
  }
  console.log(JSON.stringify({ applied }));
  return { applied };
};
