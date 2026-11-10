// Local development server: `npm run dev -w services/api` with DATABASE_URL and LOCAL_DEV_USER set.
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { app } from "./app.js";

const dev = new Hono();
dev.use("*", cors({ origin: "http://localhost:5173", allowHeaders: ["authorization", "content-type"] }));
dev.route("/", app as any);
serve({ fetch: dev.fetch, port: 8787 }, () => console.log("API on http://localhost:8787"));
