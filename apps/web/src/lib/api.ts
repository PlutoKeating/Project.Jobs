import { QueryClient, keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Engineering, HumanTask, Launch, LaunchDetail, LaunchReport, Me, PersonaDetail, PersonaListItem, SessionDetail, Snapshot, TownLayout } from './types.ts';

export class ApiError extends Error { constructor(public status: number, public code: string, public body?: Record<string, unknown>) { super(code); } }

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(path, { ...init, credentials: 'same-origin', headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers }, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body });
  if (!r.ok) {
    let code = String(r.status); let body: Record<string, unknown> | undefined;
    try { const b = await r.json(); code = b.error ?? code; body = b; } catch { /* 非 JSON */ }
    if (r.status === 401 && !path.endsWith('/me')) window.dispatchEvent(new CustomEvent('jw:auth'));
    throw new ApiError(r.status, code, body);
  }
  return r.json() as Promise<T>;
}
export const get = <T,>(p: string) => req<T>(`/api/v1${p}`);
export const post = <T,>(p: string, json?: unknown, headers?: Record<string, string>) => req<T>(`/api/v1${p}`, { method: 'POST', json: json ?? {}, headers });

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } } });

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/me'), staleTime: 60_000 });
export const useTown = () => useQuery({ queryKey: ['town'], queryFn: () => get<TownLayout>('/world/town'), staleTime: Infinity });
export const useOverview = (enabled = true) => useQuery({ enabled, queryKey: ['overview'], queryFn: () => get<{ personas: number; sessions: number; issues: number; live: number; launches: number; spend_usd: number; human_pending: number; snapshot: Snapshot | null }>('/overview'), refetchInterval: 20_000 });
export const usePersonas = () => useQuery({ queryKey: ['personas'], queryFn: () => get<PersonaListItem[]>('/personas'), refetchInterval: 30_000 });
export const usePersona = (id: string) => useQuery({ queryKey: ['persona', id], queryFn: () => get<PersonaDetail>(`/personas/${id}`), refetchInterval: 20_000 });
export const useLaunches = () => useQuery({ queryKey: ['launches'], queryFn: () => get<Launch[]>('/launches'), refetchInterval: 30_000 });
export const useLaunch = (id: string) => useQuery({ queryKey: ['launch', id], queryFn: () => get<LaunchDetail>(`/launches/${id}`), refetchInterval: 10_000 });
/** 一页结论由模型归纳，首次要等一会儿。basis 是已结束的使用次数：有人用完了才重新取，期间先显示上一版 */
export const useLaunchReport = (id: string, lang: string, enabled: boolean, basis: number) => useQuery({ queryKey: ['launch-report', id, lang, basis], queryFn: () => get<LaunchReport>(`/launches/${id}/report?lang=${lang}`), enabled, staleTime: 300_000, retry: false, placeholderData: keepPreviousData, refetchInterval: (q) => (q.state.data?.refreshing ? 20_000 : false) });
export const useEngineering = (id: string, enabled: boolean) => useQuery({ queryKey: ['launch-eng', id], queryFn: () => get<Engineering>(`/launches/${id}/engineering`), enabled });
export const useSession = (id: string) => useQuery({ queryKey: ['session', id], queryFn: () => get<SessionDetail>(`/sessions/${id}`), refetchInterval: (q) => (q.state.data && ['running', 'waiting_human', 'planned'].includes(q.state.data.session.status) ? 4000 : false) });
export const useHuman = () => useQuery({ queryKey: ['human'], queryFn: () => get<HumanTask[]>('/human'), refetchInterval: 8000 });

export function useAction<I, O>(fn: (input: I) => Promise<O>, invalidate: unknown[][] = []) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { for (const k of invalidate) void qc.invalidateQueries({ queryKey: k }); } });
}

export const evidenceUrl = (id: string) => `/api/v1/evidence/${id}`;
export const avatarUrl = (id: string) => `/api/v1/personas/${id}/avatar`;
