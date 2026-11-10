import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";

const env = import.meta.env;
export const authDisabled = env.VITE_AUTH_DISABLED === "true";

export const userManager = authDisabled
  ? null
  : new UserManager({
      authority: env.VITE_COGNITO_AUTHORITY,
      client_id: env.VITE_COGNITO_CLIENT_ID,
      redirect_uri: `${window.location.origin}/auth/callback`,
      post_logout_redirect_uri: window.location.origin,
      response_type: "code",
      scope: "openid email profile",
      automaticSilentRenew: true,
      userStore: new WebStorageStateStore({ store: window.localStorage }),
    });

export async function getUser(): Promise<User | null> {
  if (!userManager) return null;
  const user = await userManager.getUser();
  if (user && user.expired) {
    try { return await userManager.signinSilent(); } catch { return null; }
  }
  return user;
}

/** API Gateway's JWT authorizer validates the Cognito ID token (aud = client id). */
export async function getIdToken(): Promise<string | null> {
  if (authDisabled) return "dev";
  return (await getUser())?.id_token ?? null;
}

export async function signIn(returnTo = window.location.pathname + window.location.search) {
  await userManager?.signinRedirect({ state: { returnTo } });
}

export async function completeSignIn(): Promise<string> {
  const user = await userManager!.signinRedirectCallback();
  return ((user.state as { returnTo?: string } | undefined)?.returnTo) || "/";
}

export async function signOut() {
  await userManager?.removeUser();
  const domain = env.VITE_COGNITO_DOMAIN;
  if (domain) {
    const url = new URL("/logout", domain);
    url.searchParams.set("client_id", env.VITE_COGNITO_CLIENT_ID);
    url.searchParams.set("logout_uri", window.location.origin);
    window.location.href = url.toString();
  } else {
    window.location.href = "/";
  }
}
