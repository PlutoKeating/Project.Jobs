import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowRight, CloudRain, Megaphone, Pause, Play, Send, Users, WifiOff, X, ZapOff, Volume2 } from 'lucide-react';
import { evidenceUrl, post, useLaunches, useMe, useTown } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import { seedSnapshot, useSnapshot } from '../lib/stream.ts';
import type { Launch, PersonaLive, TownLayout } from '../lib/types.ts';
import { CityCanvas, toScreen } from '../components/city/CityCanvas.tsx';
import { Avatar, Button, Seg } from '../components/ui.tsx';
import { useLiveFunnel } from './Products.tsx';
import { useOverview } from '../lib/api.ts';
import { placeName, usingNow } from '../lib/live.ts';
import { UsingRow } from '../components/UsingNow.tsx';

function PersonCard({ p, town, onClose }: { p: PersonaLive; town?: TownLayout; onClose: () => void }) {
  const { t, lang } = useT(); const L = useLabel();
  const [q, setQ] = useState(''); const [ans, setAns] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { setAns(null); setQ(''); }, [p.id]);
  const s = p.session;
  const live = usingNow(p);
  return (
    <article className="animate-reveal border-b border-border p-5">
      <div className="flex items-start gap-3">
        <Avatar id={p.id} size={56} ring={live} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><h2 className="truncate text-lg font-semibold">{p.name}</h2>{p.target_user && <span className="h-1.5 w-1.5 rounded-full bg-secondary" title={t('target_user')} />}</div>
          <p className="truncate text-xs text-fg-muted">{p.age} · {p.occupation}</p>
          <p className="mt-1 text-xs text-fg-subtle">{placeName(town, p.place_id, lang)} · {L(p.mode)}</p>
        </div>
        <button onClick={onClose} aria-label="close" className="rounded-xs p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"><X size={16} /></button>
      </div>

      {s && (
        <div className="mt-4 overflow-hidden rounded-lg border border-border bg-bg-elevated">
          <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-fg-display"><span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-accent live-dot' : 'bg-secondary'}`} />{live ? t('using') : s.replay ? t('replay') : L(s.status)} <b className="font-semibold">{s.app}</b></span>
            <span className="tabular text-fg-subtle">{t('step', { n: s.step_idx + 1 })}{s.steps_total ? ` / ${s.steps_total}` : ''}{s.sim_clock ? ` · ${s.sim_clock}` : ''}</span>
          </div>
          {s.screenshot_ev && <Link to="/sessions/$id" params={{ id: s.id }}><img src={evidenceUrl(s.screenshot_ev)} alt="" className="max-h-56 w-full border-y border-border bg-bg object-cover object-top" /></Link>}
          <dl className="space-y-2 px-3 py-3 text-sm">
            {s.monologue && <div><dt className="text-xs text-fg-subtle">{t('thinking')}</dt><dd className={`mt-0.5 leading-relaxed ${s.expectation_violated || (s.mood ?? 0) < -0.3 ? 'text-danger' : 'text-fg'}`}>“{s.monologue}”</dd></div>}
            {s.action && <div><dt className="text-xs text-fg-subtle">{t('action')}</dt><dd className="mt-0.5 text-fg-muted">{s.action}</dd></div>}
          </dl>
          <div className="flex gap-2 border-t border-border px-3 py-2">
            <Link to="/sessions/$id" params={{ id: s.id }} className="inline-flex items-center gap-1 text-xs text-link hover:text-accent">{t('open_session')}<ArrowRight size={12} /></Link>
          </div>
        </div>
      )}

      <ol className="mt-4 space-y-3 text-sm">
        {p.prev && <li className="grid grid-cols-[4.5rem_1fr] gap-2 text-fg-muted"><span className="tabular text-xs text-fg-subtle">{p.prev.from}</span><span className="min-w-0 break-words">{p.prev.activity}<span className="text-fg-subtle"> · {placeName(town, p.prev.place_id, lang)}</span></span></li>}
        <li className="grid grid-cols-[4.5rem_1fr] gap-2"><span className="text-xs font-medium text-accent">{t('doing')}</span><span className="min-w-0 break-words text-fg-display">{p.activity}{p.intent && <span className="mt-1 block text-xs leading-relaxed text-fg-muted">{p.intent}</span>}</span></li>
        {p.next && <li className="grid grid-cols-[4.5rem_1fr] gap-2"><span className="tabular text-xs text-fg-subtle">{p.next.from}</span><span className="min-w-0 break-words text-fg">{p.next.activity}<span className="text-fg-subtle"> · {placeName(town, p.next.place_id, lang)}</span>{p.next.intent && <span className="mt-1 block text-xs leading-relaxed text-fg-muted">{p.next.intent}</span>}</span></li>}
      </ol>

      {!live && (
        <form className="mt-4 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!q.trim()) return; setBusy(true); try { const r = await post<{ answer: string | null; none?: boolean }>('/world/ask', { persona_id: p.id, question: q }); setAns(r.answer ?? '…'); } catch { setAns('…'); } finally { setBusy(false); } }}>
          <input className="field h-9" placeholder={t('ask_placeholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" disabled={busy || !q.trim()} aria-label={t('ask')}><Send size={14} /></Button>
        </form>
      )}
      {busy && <p className="mt-3 text-xs text-fg-subtle live-dot">…</p>}
      {ans && <p className="mt-3 rounded-lg bg-surface-hover px-3 py-2 text-sm leading-relaxed">{ans}</p>}
      <Link to="/people/$id" params={{ id: p.id }} className="mt-4 inline-flex items-center gap-1 text-xs text-link hover:text-accent">{t('open_person')}<ArrowRight size={12} /></Link>
    </article>
  );
}

/** 「此刻」看板：行按状态排序、原地重排，变化的行亮一下 */
function Board({ people, town, selected, onPick }: { people: PersonaLive[]; town?: TownLayout; selected?: string | null; onPick: (id: string) => void }) {
  const { t, lang } = useT();
  const prev = useRef(new Map<string, string>());
  const rows = useMemo(() => {
    const rank = (p: PersonaLive) => (usingNow(p) ? 0 : p.mode === 'travel' ? 1 : 2);
    return [...people].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [people]);
  const flashes = new Set<string>();
  for (const p of rows) { const sig = `${p.session?.app ?? ''}|${p.session?.step_idx ?? ''}|${p.activity}|${p.place_id}`; if (prev.current.has(p.id) && prev.current.get(p.id) !== sig) flashes.add(p.id); prev.current.set(p.id, sig); }
  if (!rows.length) return <p className="px-5 py-10 text-center text-sm text-fg-subtle">{t('nobody_using')}</p>;
  return (
    <ul>
      {rows.map((p) => (
        <li key={`${p.id}:${flashes.has(p.id) ? Date.now() : ''}`} className={flashes.has(p.id) ? 'row-flash' : ''}>
          <button onClick={() => onPick(p.id)} className={`grid w-full grid-cols-[2rem_1fr_auto] items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-hover ${selected === p.id ? 'bg-surface-hover' : ''}`}>
            <Avatar id={p.id} size={32} />
            <span className="min-w-0">
              <span className="flex items-center gap-2"><span className="truncate text-sm font-medium text-fg-display">{p.name}</span>{usingNow(p) && <span className="truncate rounded-xs bg-accent-soft px-1.5 text-xs font-medium text-accent">{p.session!.app}</span>}</span>
              <span className="block truncate text-xs text-fg-muted">{(usingNow(p) && p.session!.monologue) || p.activity}</span>
            </span>
            <span className="max-w-[7rem] truncate text-right text-xs text-fg-subtle">{placeName(town, p.place_id, lang)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 「此刻 · 按产品」：每个上线中的产品下面列出此刻正在用它的人（排队的不算）；点人在城里找到他 */
function ByProduct({ people, onPick }: { people: PersonaLive[]; onPick: (id: string) => void }) {
  const { t } = useT(); const q = useLaunches();
  const launches = (q.data ?? []).filter((l) => l.status !== 'ended');
  const using = people.filter(usingNow);
  const known = new Set(launches.map((l) => l.app_id));
  // 不属于任何上线中产品的使用（例如已结束的发布还没用完的人）按软件名归到一起
  const other = new Map<string, PersonaLive[]>();
  for (const p of using) if (!known.has(p.session!.app_id)) other.set(p.session!.app, [...(other.get(p.session!.app) ?? []), p]);
  if (!launches.length && !other.size) return <p className="px-5 py-10 text-center text-sm text-fg-subtle">{t('nobody_using')}</p>;
  const rows = launches.map((l) => ({ l, who: using.filter((p) => p.session!.app_id === l.app_id) })).sort((a, b) => b.who.length - a.who.length);
  return (
    <div>
      {rows.map(({ l, who }) => <ProductGroup key={l.id} launch={l} who={who} onPick={onPick} />)}
      {[...other].map(([app, who]) => (
        <section key={app} className="border-b border-border">
          <h3 className="flex items-center gap-2 px-5 pb-1 pt-3 text-sm font-medium text-fg-display">{app}<span className="tabular text-xs text-accent">{who.length}</span></h3>
          <ul>{who.map((p) => <UsingRow key={p.id} p={p} shot={false} onPick={onPick} />)}</ul>
        </section>
      ))}
    </div>
  );
}

function ProductGroup({ launch, who, onPick }: { launch: Launch; who: PersonaLive[]; onPick: (id: string) => void }) {
  const { t } = useT();
  const l = useLiveFunnel(launch); const f = l.funnel;
  return (
    <section className="border-b border-border">
      <Link to="/products/$id" params={{ id: l.id }} className="group grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 px-5 pb-2 pt-3 transition-colors hover:bg-surface-hover">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-fg-display group-hover:text-accent">{l.name}</span>
          {who.length > 0 ? <span className="inline-flex shrink-0 items-center gap-1 text-xs text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />{t('using_n', { n: who.length })}</span>
            : <span className="shrink-0 text-xs text-fg-subtle">{t('nobody_using_this')}</span>}
        </span>
        <span className="tabular text-xs text-fg-muted" title={`${t('f_opened')} / ${t('f_reached')}`}><span className="text-sm text-fg-display">{f.opened}</span> / {f.reached}</span>
      </Link>
      {who.length > 0 && <ul className="pb-1">{who.map((p) => <UsingRow key={p.id} p={p} shot={false} onPick={onPick} />)}</ul>}
    </section>
  );
}

const EVENTS = [
  { kind: 'weak_network', icon: WifiOff }, { kind: 'crowd', icon: Users }, { kind: 'rain', icon: CloudRain }, { kind: 'power_cut', icon: ZapOff }, { kind: 'noise', icon: Volume2 },
] as const;

function PlacePanel({ id, town, people, onPick, onClose, admin }: { id: string; town?: TownLayout; people: PersonaLive[]; onPick: (id: string) => void; onClose: () => void; admin: boolean }) {
  const { t, lang } = useT(); const L = useLabel();
  const pl = town?.places.find((p) => p.id === id);
  const here = people.filter((p) => p.place_id === id);
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="animate-reveal border-b border-border p-5">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="text-lg font-semibold">{placeName(town, id, lang)}</h2><p className="text-xs text-fg-muted">{L(pl?.kind)} · {t('n_people', { n: here.length })}</p></div>
        <button onClick={onClose} aria-label="close" className="rounded-xs p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"><X size={16} /></button>
      </div>
      {here.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{here.map((p) => <button key={p.id} onClick={() => onPick(p.id)} title={p.name} className="rounded-md transition-transform hover:-translate-y-0.5"><Avatar id={p.id} size={36} ring={usingNow(p)} /></button>)}</div>}
      {admin && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Megaphone size={14} className="mr-1 text-fg-subtle" aria-label={t('event')} />
          {EVENTS.map(({ kind, icon: Icon }) => (
            <Button key={kind} size="sm" variant={sent === kind ? 'primary' : 'quiet'} title={L(kind)} onClick={async () => { await post('/world/events', { place_id: id, kind, minutes: 20 }); setSent(kind); setTimeout(() => setSent(null), 1500); }}>
              <Icon size={13} /><span className="hidden sm:inline">{L(kind)}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function ClockControls() {
  const snap = useSnapshot(); const { t } = useT();
  const c = snap?.clock; if (!c) return null;
  const set = (body: object) => void post('/world/clock', body);
  return (
    <div className="absolute left-4 top-4 flex items-center gap-2 rounded-lg border border-border bg-surface-glass p-1.5 shadow-md backdrop-blur-[var(--blur-glass)]">
      <Button size="sm" variant="ghost" aria-label={c.paused ? t('resume') : t('pause')} onClick={() => set({ paused: !c.paused })}>{c.paused ? <Play size={14} /> : <Pause size={14} />}</Button>
      <Seg size="sm" value={String(c.speed)} onChange={(v) => set({ speed: Number(v) })} options={[{ value: '1', label: '1×' }, { value: '10', label: '10×' }, { value: '60', label: '60×' }]} />
    </div>
  );
}

export function WorldPage() {
  const town = useTown().data;
  const ov = useOverview().data;
  useEffect(() => seedSnapshot(ov?.snapshot), [ov?.snapshot]);
  const snap = useSnapshot();
  const me = useMe().data;
  const { t, lang } = useT();
  const search = useSearch({ strict: false }) as { focus?: string; place?: string };
  const nav = useNavigate();
  const [sel, setSel] = useState<string | null>(search.focus ?? null);
  const [place, setPlace] = useState<string | null>(search.place ?? null);
  const [filter, setFilter] = useState<'product' | 'all'>('product');
  useEffect(() => { if (search.focus) { setSel(search.focus); setPlace(null); } }, [search.focus]);
  useEffect(() => { if (search.place) { setPlace(search.place); setSel(null); } }, [search.place]);
  const people = useMemo(() => (snap?.personas ?? []).filter((p) => p.visible), [snap]);
  const selected = people.find((p) => p.id === sel);
  const usingN = (snap?.personas ?? []).filter(usingNow).length;
  const now = Date.now();
  const side = useRef<HTMLDivElement>(null);
  const pick = (id: string) => { setSel(id); setPlace(null); side.current?.scrollTo({ top: 0, behavior: 'smooth' }); void nav({ to: '/', search: { focus: id }, replace: true }); };

  return (
    <div className="flex min-h-0 shrink-0 flex-col overflow-hidden lg:flex-row" style={{ height: 'calc(100dvh - var(--ds-header-height))' }}>
      <div className="relative min-h-[420px] flex-1">
        {town ? (
          <CityCanvas mode="full" layout={town} personas={people} minute={snap?.clock.minute ?? 720} selectedId={sel} focusId={search.focus} focusPlace={search.place} className="absolute inset-0"
            onSelect={pick} onPlace={(id) => { setPlace(id); setSel(null); }}
            overlay={(v) => (
              <div className="pointer-events-none absolute inset-0">
                {(snap?.events ?? []).map((e) => {
                  const pl = town.places.find((x) => x.id === e.place_id); if (!pl) return null;
                  const Icon = EVENTS.find((x) => x.kind === e.kind)?.icon ?? Megaphone;
                  const pos = toScreen(v, pl.x + pl.w / 2, pl.top - 6);
                  return <span key={e.id} className="absolute -translate-x-1/2 -translate-y-full rounded-full bg-warning p-1.5 text-bg shadow-md live-dot" style={pos} title={e.kind}><Icon size={14} /></span>;
                })}
                {v.s >= 3 && town.places.map((p) => { const pos = toScreen(v, p.x + p.w / 2, p.top - 1.5); return <span key={p.id} className="absolute -translate-x-1/2 -translate-y-full whitespace-nowrap text-xs font-medium [text-shadow:0_1px_6px_rgb(0_0_0/0.7)]" style={{ ...pos, color: 'rgb(232 228 221 / 0.85)' }}>{lang === 'zh' ? p.name.zh : p.name.en}</span>; })}
                {people.map((p) => {
                  const pos = toScreen(v, p.x, p.y - 3.8);
                  const bubble = p.say && now - p.say.at < 10_000 ? p.say : null;
                  const shown = usingNow(p) || !!p.session?.replay;
                  const tag = p.id === sel || shown;
                  if (!bubble && !tag) return null;
                  return (
                    <div key={p.id} className="absolute transition-[left,top] duration-1000 ease-linear" style={pos}>
                      {bubble && v.s >= 3 && (
                        <div key={bubble.at} className={`bubble absolute bottom-6 left-0 w-max max-w-[15rem] -translate-x-1/2 rounded-lg px-2.5 py-1.5 text-xs leading-snug shadow-md ${bubble.tone === 'angry' ? 'bg-danger text-bg' : bubble.tone === 'confused' ? 'bg-warning text-bg' : bubble.tone === 'happy' ? 'bg-success text-bg' : 'bg-fg text-bg'}`}>{bubble.text}</div>
                      )}
                      {tag && <span className="absolute bottom-0 left-0 -translate-x-1/2 whitespace-nowrap rounded-xs bg-bg/85 px-1.5 text-xs text-fg-display">{p.name}{shown && <span className="ml-1 text-accent">· {p.session!.app}</span>}</span>}
                    </div>
                  );
                })}
              </div>
            )} />
        ) : <div className="absolute inset-0 animate-pulse bg-surface" />}
        {me?.admin && <ClockControls />}
      </div>
      <aside className="flex max-h-[60dvh] min-h-0 w-full shrink-0 flex-col lg:h-full border-t border-border bg-bg lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
        <div ref={side} className="min-h-0 flex-1 overflow-y-auto">
          {selected && <PersonCard p={selected} town={town} onClose={() => { setSel(null); void nav({ to: '/', search: {}, replace: true }); }} />}
          {place && !selected && <PlacePanel id={place} town={town} people={people} onPick={pick} onClose={() => setPlace(null)} admin={!!me?.admin} />}
          <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-bg/95 px-5 py-3 backdrop-blur">
            <h2 className="flex items-center gap-2 text-sm font-semibold">{t('now')}{usingN > 0 && <span className="tabular rounded-xs bg-accent px-1.5 text-xs text-accent-fg">{usingN}</span>}</h2>
            <Seg size="sm" value={filter} onChange={setFilter} options={[{ value: 'product', label: t('by_product') }, { value: 'all', label: t('everyone') }]} />
          </div>
          {filter === 'product' ? <ByProduct people={snap?.personas ?? []} onPick={pick} /> : <Board people={people} town={town} selected={sel} onPick={pick} />}
        </div>
      </aside>
    </div>
  );
}
