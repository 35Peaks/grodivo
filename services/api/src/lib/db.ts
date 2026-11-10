import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// NUMERIC -> number (values are well within double precision for this app); BIGINT -> number
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));
// DATE -> "YYYY-MM-DD" string (avoid timezone shifts)
pg.types.setTypeParser(1082, (v) => v);

function sslConfig(): pg.PoolConfig["ssl"] {
  if (process.env.DATABASE_SSL === "false") return false;
  const here = dirname(fileURLToPath(import.meta.url));
  const caPath = join(here, "rds-ca.pem");
  if (existsSync(caPath)) return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  // Traffic stays inside the private VPC; encrypt even without the CA bundle.
  return { rejectUnauthorized: false };
}

let pool: pg.Pool | undefined;
export function db(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(),
      max: 2,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const res = await db().query<T>(text, params);
  return res.rows;
}

/** Runs fn in a transaction with app.user_id set, so triggers can attribute changes. */
export async function withTx<T>(userId: string | null, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
