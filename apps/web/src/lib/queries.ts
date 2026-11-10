import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { Account, AccountDetail, Deal, DealDetail, Meta, Scorecard, Summary } from "./types";

const qs = (p: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : "";
};

export const useMeta = () => useQuery({ queryKey: ["meta"], queryFn: () => api<Meta>("/settings/meta"), staleTime: 5 * 60_000 });
export const useSummary = (f: { owner?: string; segment?: string }) =>
  useQuery({ queryKey: ["summary", f], queryFn: () => api<Summary>(`/dashboard/summary${qs(f)}`), placeholderData: (p) => p });
export const useScorecards = () => useQuery({ queryKey: ["scorecards"], queryFn: () => api<Scorecard[]>("/dashboard/scorecards") });
export const useDeals = (f: Record<string, string | undefined>) =>
  useQuery({ queryKey: ["deals", f], queryFn: () => api<Deal[]>(`/deals${qs(f)}`), placeholderData: (p) => p });
export const useDeal = (id: string) => useQuery({ queryKey: ["deal", id], queryFn: () => api<DealDetail>(`/deals/${id}`) });
export const useAccounts = (f: Record<string, string | undefined> = {}) =>
  useQuery({ queryKey: ["accounts", f], queryFn: () => api<Account[]>(`/accounts${qs(f)}`), placeholderData: (p) => p });
export const useAccount = (id: string) => useQuery({ queryKey: ["account", id], queryFn: () => api<AccountDetail>(`/accounts/${id}`) });

/** Any write invalidates everything derived from deals, so the numbers always agree. */
export function useSave<T = any>() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: "POST" | "PATCH" | "DELETE" | "PUT"; json?: unknown }) =>
      api<T>(path, { method, json }),
    onSuccess: () => qc.invalidateQueries(),
  });
}

export { qs };
