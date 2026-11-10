import { getIdToken, signIn } from "./auth";

const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) { super(message); }
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const token = await getIdToken();
  if (!token) { await signIn(); throw new ApiError(401, "Signing in"); }
  const { json, ...rest } = init;
  const res = await fetch(base + path, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401) { await signIn(); throw new ApiError(401, "Session expired"); }
  if (res.status === 204) return undefined as T;
  const body = res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === "object" && body && "error" in body ? String((body as any).error) : `Request failed (${res.status})`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export async function downloadCsv(path: string) {
  const token = await getIdToken();
  const res = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, "Export failed");
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "export.csv";
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}
