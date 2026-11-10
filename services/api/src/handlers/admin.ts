// User management (invite, change role, disable). Runs outside the VPC so it can reach
// Cognito directly; the user table in Postgres syncs itself on each user's next request.
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { z } from "zod";
import {
  AdminAddUserToGroupCommand, AdminCreateUserCommand, AdminDisableUserCommand, AdminEnableUserCommand,
  AdminListGroupsForUserCommand, AdminRemoveUserFromGroupCommand, CognitoIdentityProviderClient, ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { parseGroups, roleFromGroups, type AppEnv } from "../lib/auth.js";

const cognito = new CognitoIdentityProviderClient({});
const UserPoolId = process.env.USER_POOL_ID!;
const ROLES = ["admin", "manager", "rep"] as const;

const app = new Hono<AppEnv>().basePath("/admin");

app.use("*", async (c, next) => {
  const claims = c.env?.event?.requestContext?.authorizer?.jwt?.claims;
  if (!claims || roleFromGroups(parseGroups(claims["cognito:groups"])) !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
});

app.get("/users", async (c) => {
  const users: any[] = [];
  let token: string | undefined;
  do {
    const res = await cognito.send(new ListUsersCommand({ UserPoolId, PaginationToken: token, Limit: 60 }));
    for (const u of res.Users ?? []) {
      const attr = (n: string) => u.Attributes?.find((a) => a.Name === n)?.Value;
      const groups = await cognito.send(new AdminListGroupsForUserCommand({ UserPoolId, Username: u.Username! }));
      users.push({
        username: u.Username, id: attr("sub"), email: attr("email"), name: attr("name"),
        role: roleFromGroups((groups.Groups ?? []).map((g) => g.GroupName!)),
        enabled: u.Enabled, status: u.UserStatus, created: u.UserCreateDate,
      });
    }
    token = res.PaginationToken;
  } while (token);
  return c.json(users.sort((a, b) => String(a.name ?? a.email).localeCompare(String(b.name ?? b.email))));
});

app.post("/users", async (c) => {
  const body = z.object({ email: z.string().email(), name: z.string().min(1), role: z.enum(ROLES) }).parse(await c.req.json());
  const email = body.email.toLowerCase();
  await cognito.send(new AdminCreateUserCommand({
    UserPoolId, Username: email, DesiredDeliveryMediums: ["EMAIL"],
    UserAttributes: [
      { Name: "email", Value: email }, { Name: "email_verified", Value: "true" }, { Name: "name", Value: body.name },
    ],
  }));
  await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username: email, GroupName: body.role }));
  return c.json({ ok: true }, 201);
});

app.patch("/users/:username", async (c) => {
  const Username = c.req.param("username");
  const body = z.object({ role: z.enum(ROLES).optional(), enabled: z.boolean().optional() }).parse(await c.req.json());
  if (body.role) {
    for (const g of ROLES) {
      if (g !== body.role) await cognito.send(new AdminRemoveUserFromGroupCommand({ UserPoolId, Username, GroupName: g })).catch(() => {});
    }
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId, Username, GroupName: body.role }));
  }
  if (body.enabled === true) await cognito.send(new AdminEnableUserCommand({ UserPoolId, Username }));
  if (body.enabled === false) await cognito.send(new AdminDisableUserCommand({ UserPoolId, Username }));
  return c.json({ ok: true });
});

app.onError((err, c) => {
  if (err instanceof z.ZodError) return c.json({ error: "invalid input", issues: err.issues }, 400);
  if (err.name === "UsernameExistsException") return c.json({ error: "That user already exists" }, 409);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export const handler = handle(app);
