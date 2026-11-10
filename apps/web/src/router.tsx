import { createRootRoute, createRoute, createRouter, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Layout } from "./components/Layout";
import { ErrorBox, Loading } from "./components/ui";
import { authDisabled, completeSignIn, getUser, signIn } from "./lib/auth";
import { Overview } from "./routes/Overview";
import { Pipeline } from "./routes/Pipeline";
import { DealPage } from "./routes/DealPage";
import { Accounts } from "./routes/Accounts";
import { AccountPage } from "./routes/AccountPage";
import { Team } from "./routes/Team";
import { Admin } from "./routes/Admin";
import { Signals } from "./routes/Signals";

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const rootRoute = createRootRoute({ component: Outlet });

function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    completeSignIn().then((to) => navigate({ to, replace: true })).catch(setError);
  }, [navigate]);
  return error ? <div className="p-8"><ErrorBox error={error} /></div> : <Loading />;
}
const callbackRoute = createRoute({ getParentRoute: () => rootRoute, path: "/auth/callback", component: Callback });

// Everything else requires a signed-in Cognito user
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async () => {
    if (authDisabled) return;
    if (!(await getUser())) { await signIn(); throw new Promise(() => {}); }
  },
  pendingComponent: Loading,
  component: Layout,
});

const overviewRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: Overview,
  validateSearch: (s: Record<string, unknown>): { owner?: string; segment?: string } => ({ owner: str(s.owner), segment: str(s.segment) }) });
const pipelineRoute = createRoute({ getParentRoute: () => appRoute, path: "/pipeline", component: Pipeline,
  validateSearch: (s: Record<string, unknown>): Partial<Record<"status" | "stage" | "segment" | "owner" | "offering" | "q", string>> => ({
    status: str(s.status), stage: str(s.stage), segment: str(s.segment), owner: str(s.owner), offering: str(s.offering), q: str(s.q),
  }) });
const dealRoute = createRoute({ getParentRoute: () => appRoute, path: "/deals/$id", component: DealPage });
const accountsRoute = createRoute({ getParentRoute: () => appRoute, path: "/accounts", component: Accounts,
  validateSearch: (s: Record<string, unknown>): { segment?: string; q?: string } => ({ segment: str(s.segment), q: str(s.q) }) });
const accountRoute = createRoute({ getParentRoute: () => appRoute, path: "/accounts/$id", component: AccountPage });
const signalsRoute = createRoute({ getParentRoute: () => appRoute, path: "/signals", component: Signals,
  validateSearch: (s: Record<string, unknown>): Partial<Record<"status" | "type" | "deal_status" | "segment" | "min_fit" | "q", string>> => ({
    status: str(s.status), type: str(s.type), deal_status: str(s.deal_status), segment: str(s.segment), min_fit: str(s.min_fit), q: str(s.q),
  }) });
const teamRoute = createRoute({ getParentRoute: () => appRoute, path: "/team", component: Team });
const adminRoute = createRoute({ getParentRoute: () => appRoute, path: "/admin", component: Admin });

const routeTree = rootRoute.addChildren([
  callbackRoute,
  appRoute.addChildren([overviewRoute, pipelineRoute, dealRoute, accountsRoute, accountRoute, signalsRoute, teamRoute, adminRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router }
}
