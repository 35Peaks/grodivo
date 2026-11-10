import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { authenticate, type AppEnv } from "./lib/auth.js";
import { dashboard } from "./routes/dashboard.js";
import { deals } from "./routes/deals.js";
import { accounts, contacts } from "./routes/accounts.js";
import { activities } from "./routes/activities.js";
import { settings } from "./routes/settings.js";
import { signals } from "./routes/signals.js";

export const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

app.use("*", authenticate);
app.route("/dashboard", dashboard);
app.route("/deals", deals);
app.route("/accounts", accounts);
app.route("/contacts", contacts);
app.route("/activities", activities);
app.route("/settings", settings);
app.route("/signals", signals);

app.onError((err, c) => {
  if (err instanceof ZodError) return c.json({ error: "invalid input", issues: err.issues }, 400);
  if (err instanceof HTTPException) return err.getResponse();
  if ((err as any).code === "22P02") return c.json({ error: "invalid id" }, 400);
  if ((err as any).code === "23503") return c.json({ error: "referenced record not found" }, 400);
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});
