import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppListItem, AppReport, AppVersionRow, HumanTask, Me, PersonaDetail, PersonaListItem, SessionDetail, Snapshot, StudyDetail, StudyRow, TownLayout, Verdict } from './types.ts';

export class ApiError extends Error { constructor(public status: number, public code: string) { super(code); } }

async function req<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const r = await fetch(path, { ...init, credentials: 'same-origin', headers: { ...(init?.json !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers }, body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body });
  if (!r.ok) {
    let code = String(r.status);
    try { const b = await r.json(); code = b.error ?? code; } catch { /* 非 JSON */ }
    if (r.status === 401 && !path.endsWith('/me')) window.dispatchEvent(new CustomEvent('jw:auth'));
    throw new ApiError(r.status, code);
  }
  return r.json() as Promise<T>;
}
export const get = <T,>(p: string) => req<T>(`/api/v1${p}`);
export const post = <T,>(p: string, json?: unknown, headers?: Record<string, string>) => req<T>(`/api/v1${p}`, { method: 'POST', json: json ?? {}, headers });

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 } } });

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/me'), staleTime: 60_000 });
export const useTown = () => useQuery({ queryKey: ['town'], queryFn: () => get<TownLayout>('/world/town'), staleTime: Infinity });
export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => get<{ personas: number; sessions: number; issues: number; live: number; apps_tested: number; human_pending: number; snapshot: Snapshot | null }>('/overview'), refetchInterval: 20_000 });
export const usePersonas = () => useQuery({ queryKey: ['personas'], queryFn: () => get<PersonaListItem[]>('/personas'), refetchInterval: 30_000 });
export const usePersona = (id: string) => useQuery({ queryKey: ['persona', id], queryFn: () => get<PersonaDetail>(`/personas/${id}`), refetchInterval: 20_000 });
export const useApps = () => useQuery({ queryKey: ['apps'], queryFn: () => get<AppListItem[]>('/apps') });
export const useAppReport = (id: string) => useQuery({ queryKey: ['app', id], queryFn: () => get<AppReport>(`/apps/${id}/report`) });
export const useVerdict = (id: string, lang: string) => useQuery({ queryKey: ['verdict', id, lang], queryFn: () => get<Verdict | null>(`/apps/${id}/verdict?lang=${lang}`) });
export const useStudies = () => useQuery({ queryKey: ['studies'], queryFn: () => get<StudyRow[]>('/studies'), refetchInterval: 10_000 });
export const useStudy = (id: string) => useQuery({ queryKey: ['study', id], queryFn: () => get<StudyDetail>(`/studies/${id}`), refetchInterval: (q) => (q.state.data && ['done', 'failed', 'cancelled'].includes(q.state.data.study.status) ? false : 5000) });
export const useSession = (id: string) => useQuery({ queryKey: ['session', id], queryFn: () => get<SessionDetail>(`/sessions/${id}`), refetchInterval: (q) => (q.state.data && ['running', 'waiting_human', 'planned'].includes(q.state.data.session.status) ? 4000 : false) });
export const useAppVersions = () => useQuery({ queryKey: ['app-versions'], queryFn: () => get<AppVersionRow[]>('/app-versions') });
export const useHuman = () => useQuery({ queryKey: ['human'], queryFn: () => get<HumanTask[]>('/human'), refetchInterval: 8000 });

export function useAction<I, O>(fn: (input: I) => Promise<O>, invalidate: unknown[][] = []) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => { for (const k of invalidate) void qc.invalidateQueries({ queryKey: k }); } });
}

export const evidenceUrl = (id: string) => `/api/v1/evidence/${id}`;
export const avatarUrl = (id: string) => `/api/v1/personas/${id}/avatar`;
