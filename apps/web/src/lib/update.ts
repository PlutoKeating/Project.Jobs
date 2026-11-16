// 版本与升级的共享状态：顶栏的新版本提示和「设置 › 版本」用同一份。点了升级之后记下当时的版本与时间（存在 sessionStorage，刷新页面也不丢），
// 服务换上新版本后（版本号变了）刷新页面。
import { useEffect, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, get, post } from './api.ts';

export interface VersionInfo {
  version: string; check: boolean; checked_at: string | null; error: string | null; update_available: boolean;
  latest: { version: string; url: string; published_at: string | null } | null;
  can_update?: boolean; command?: string; update?: { requested: boolean; host: { state: 'running' | 'ok' | 'failed'; at: string | null } | null; log: string | null };
}
type Started = { from: string; at: number } | null;

const KEY = 'jw.updating';
let started: Started = (() => { try { const x = sessionStorage.getItem(KEY); return x ? JSON.parse(x) as Started : null; } catch { return null; } })();
const subs = new Set<() => void>();
const setStarted = (v: Started) => { started = v; try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch { /* */ } for (const f of subs) f(); };

export function useUpdate(enabled = true) {
  const s = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => started);
  const q = useQuery({ queryKey: ['version'], queryFn: () => get<VersionInfo>('/version'), enabled, staleTime: 300_000, refetchInterval: s ? 3000 : 900_000, refetchOnWindowFocus: true, retry: s ? false : 2 });
  const d = q.data;
  const host = d?.update?.host;
  const failed = !!s && host?.state === 'failed' && !!host.at && Date.parse(host.at) >= s.at - 5000;
  const slow = !!s && !failed && Date.now() - s.at > 15 * 60_000;
  const running = !failed && (!!s || host?.state === 'running' || !!d?.update?.requested);
  useEffect(() => { if (s && d && d.version !== s.from) { setStarted(null); location.reload(); } }, [s, d]);
  const go = async () => {
    if (!d) return;
    setStarted(null);
    try { await post('/update'); setStarted({ from: d.version, at: Date.now() }); }
    catch (e) { if (e instanceof ApiError && e.status === 409) void q.refetch(); }
  };
  return { q, d, failed, slow, running, go };
}
