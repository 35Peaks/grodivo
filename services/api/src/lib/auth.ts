import type { Context, MiddlewareHandler } from "hono";
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from "aws-lambda";
import { query } from "./db.js";

export type Role = "admin" | "manager" | "rep";
export interface CurrentUser { id: string; email: string; name: string; role: Role }
export type AppEnv = {
  Bindings: { event: APIGatewayProxyEventV2WithJWTAuthorizer };
  Variables: { user: CurrentUser };
};

export function parseGroups(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw !== "string") return [];
  // API Gateway flattens arrays to "[admin rep]" or "admin,rep"
  return raw.replace(/^\[|\]$/g, "").split(/[\s,]+/).filter(Boolean);
}

export function roleFromGroups(groups: string[]): Role {
  if (groups.includes("admin")) return "admin";
  if (groups.includes("manager")) return "manager";
  return "rep";
}

/** Reads JWT claims verified by API Gateway and upserts the user row. */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const claims = c.env?.event?.requestContext?.authorizer?.jwt?.claims
    ?? (process.env.LOCAL_DEV_USER ? JSON.parse(process.env.LOCAL_DEV_USER) : undefined);
  if (!claims?.sub || !claims?.email) return c.json({ error: "unauthorized" }, 401);

  const role = roleFromGroups(parseGroups(claims["cognito:groups"]));
  const name = String(claims.name ?? claims.given_name ?? String(claims.email).split("@")[0]);
  const [row] = await query<CurrentUser & { active: boolean }>(
    `INSERT INTO users (id, email, name, role, last_seen_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
       role = EXCLUDED.role, last_seen_at = now()
     RETURNING id, email, name, role, active`,
    [claims.sub, String(claims.email).toLowerCase(), name, role],
  );
  if (!row?.active) return c.json({ error: "account disabled" }, 403);
  c.set("user", { id: row.id, email: row.email, name: row.name, role: row.role });
  await next();
};

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("user").role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
}

export const currentUser = (c: Context<AppEnv>) => c.get("user");
