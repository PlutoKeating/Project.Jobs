// 实时世界状态：WebSocket /api/v1/stream → 外部 store（useSyncExternalStore）
import { useSyncExternalStore } from 'react';
import type { SessionLive, Snapshot, Tone } from './types.ts';

export interface FeedItem { key: string; persona_id: string; name?: string; session: SessionLive; ts: number }
export interface SayItem { persona_id: string; name: string; text: string; tone: Tone; ts: number }

interface State { snapshot: Snapshot | null; feed: FeedItem[]; says: SayItem[]; connected: boolean }
let state: State = { snapshot: null, feed: [], says: [], connected: false };
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

let ws: WebSocket | null = null;
let retry = 0;
let started = false;

function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/stream`;
  ws = new WebSocket(url);
  ws.onopen = () => { retry = 0; set({ connected: true }); };
  ws.onclose = (e) => { set({ connected: false }); if (e.code === 4401) return; setTimeout(connect, Math.min(10_000, 800 * 2 ** retry++)); };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data as string) as { type: string; data: unknown };
    if (msg.type === 'snapshot') set({ snapshot: msg.data as Snapshot });
    else if (msg.type === 'live') {
      const d = msg.data as { persona_id: string; session: SessionLive; ts: number };
      const key = `${d.session.id}:${d.session.step_idx}`;
      if (state.feed.some((f) => f.key === key)) return;
      const name = state.snapshot?.personas.find((p) => p.id === d.persona_id)?.name;
      set({ feed: [{ key, persona_id: d.persona_id, name, session: d.session, ts: d.ts }, ...state.feed].slice(0, 80) });
    } else if (msg.type === 'say') set({ says: [msg.data as SayItem, ...state.says].slice(0, 60) });
  };
}

export function startStream() { if (started) return; started = true; connect(); }
export function restartStream() { try { ws?.close(); } catch { /* */ } started = false; startStream(); }

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; };
export function useStream<T>(sel: (s: State) => T): T { return useSyncExternalStore(subscribe, () => sel(state)); }
export const useSnapshot = () => useStream((s) => s.snapshot);
export const useConnected = () => useStream((s) => s.connected);
export const useFeed = () => useStream((s) => s.feed);
export const useSays = () => useStream((s) => s.says);
export const seedSnapshot = (s: Snapshot | null | undefined) => { if (s && !state.snapshot) set({ snapshot: s }); };
