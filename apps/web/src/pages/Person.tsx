import { useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowUpRight, MapPin } from 'lucide-react';
import { usePersona, useTown } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import { useSnapshot } from '../lib/stream.ts';
import type { AgendaItem, Memory, PersonaSession } from '../lib/types.ts';
import { Avatar, ErrorState, Meter, Section, Seg, Skeleton } from '../components/ui.tsx';

export const PLACE_COLOR: Record<string, string> = {
  home: '#7d8f8a', office: '#5d7883', school: '#94504a', park: '#55724a', subway: '#c2cfcb', road: '#8d877f', street: '#8d877f', cafe: '#8a6a46', restaurant: '#b07850',
  shop: '#d9b96a', library: '#a99f8f', hospital: '#d9d4ca', factory: '#6d7378', bus_stop: '#7d8f8a',
};
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };

function DayLane({ items, minute, placeName }: { items: AgendaItem[]; minute: number | null; placeName: (id: string) => string }) {
  const L = useLabel();
  const [hover, setHover] = useState<number | null>(null);
  const cur = minute === null ? -1 : items.findIndex((i) => minute >= toMin(i.from) && minute < toMin(i.to));
  const show = hover ?? (cur >= 0 ? cur : 0);
  const it = items[show];
  return (
    <div>
      <div className="relative h-12 overflow-hidden rounded-md bg-surface" onMouseLeave={() => setHover(null)}>
        {items.map((i, k) => {
          const a = toMin(i.from), b = toMin(i.to);
          return <button key={k} onMouseEnter={() => setHover(k)} onFocus={() => setHover(k)} aria-label={`${i.from} ${i.activity}`}
            className={`absolute inset-y-0 border-r border-bg transition-opacity ${show === k ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
            style={{ left: `${(a / 1440) * 100}%`, width: `${((b - a) / 1440) * 100}%`, background: PLACE_COLOR[i.place_kind] ?? '#6f6b65' }} />;
        })}
        {minute !== null && <span className="absolute inset-y-0 w-0.5 bg-accent shadow-[0_0_10px_var(--color-accent)]" style={{ left: `${(minute / 1440) * 100}%` }} />}
      </div>
      <div className="tabular mt-1.5 flex justify-between text-[11px] text-fg-subtle">{['00', '06', '12', '18', '24'].map((h) => <span key={h}>{h}:00</span>)}</div>
      {it && (
        <div className="mt-4 grid grid-cols-[6.5rem_1fr] gap-3">
          <div className="tabular text-sm text-fg-muted">{it.from}–{it.to}{show === cur && <span className="mt-1 block text-xs text-accent">●</span>}</div>
          <div className="min-w-0">
            <p className="text-fg-display">{it.activity}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-fg-subtle"><MapPin size={12} />{placeName(it.place_id) || L(it.place_kind)}{it.with && ` · ${it.with}`}</p>
            {it.intent && <p className="mt-2 text-sm leading-relaxed text-fg-muted">{it.intent}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function MemoryList({ items, apps }: { items: Memory[]; apps: Map<string, string> }) {
  const L = useLabel(); const { t } = useT();
  const [kind, setKind] = useState('all');
  const kinds = [...new Set(items.map((m) => m.kind))];
  const list = items.filter((m) => kind === 'all' || m.kind === kind);
  return (
    <>
      <div className="mb-4"><Seg size="sm" value={kind} onChange={setKind} options={[{ value: 'all', label: t('all') }, ...kinds.map((k) => ({ value: k, label: L(k) }))]} /></div>
      <ul className="divide-y divide-border">
        {list.slice(0, 40).map((m) => (
          <li key={m.id} className="grid grid-cols-[0.5rem_1fr_auto] items-start gap-3 py-3">
            <span className="mt-2 h-2 w-2 rounded-full" style={{ background: m.valence < -0.2 ? 'var(--color-danger)' : m.valence > 0.2 ? 'var(--color-success)' : 'var(--color-fg-subtle)', opacity: 0.4 + m.importance * 0.6 }} />
            <p className="text-sm leading-relaxed">{m.content}</p>
            <span className="text-right text-[11px] text-fg-subtle"><span className="block">{L(m.kind)}</span>{m.app_id && <span className="block truncate">{apps.get(m.app_id) ?? ''}</span>}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function History({ sessions }: { sessions: PersonaSession[] }) {
  const L = useLabel();
  const byApp = useMemo(() => { const m = new Map<string, PersonaSession[]>(); for (const s of sessions) m.set(s.app, [...(m.get(s.app) ?? []), s]); return [...m.entries()]; }, [sessions]);
  return (
    <div className="space-y-6">
      {byApp.map(([app, ss]) => (
        <div key={app}>
          <Link to="/apps/$id" params={{ id: ss[0].app_id }} className="inline-flex items-center gap-1 font-medium text-fg-display hover:text-accent">{app}<ArrowUpRight size={13} /></Link>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {ss.map((s) => (
              <li key={s.id}>
                <Link to="/sessions/$id" params={{ id: s.id }} title={`${s.started_at ? new Date(s.started_at).toLocaleString() : ''} · ${L(s.world)} · ${L(s.mode)}`}
                  className={`tabular inline-flex h-7 items-center gap-1.5 rounded border px-2 text-xs transition-colors hover:border-accent ${s.outcome === 'success' ? 'border-success/40 text-success' : s.outcome ? 'border-danger/40 text-danger' : 'border-border text-fg-muted'}`}>
                  {s.revisit_day ? `D${s.revisit_day}` : s.started_at ? new Date(s.started_at).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' }) : '—'}
                  <span className="text-fg-subtle">{L(s.outcome ?? s.status)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function PersonPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = usePersona(id); const town = useTown().data; const snap = useSnapshot();
  const { t, lang } = useT(); const L = useLabel();
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>;
  const d = q.data; const s = d.spec; const id0 = s.identity;
  const live = snap?.personas.find((p) => p.id === id) ?? d.live;
  const placeName = (pid: string) => { const p = town?.places.find((x) => x.id === pid); return p ? (lang === 'zh' ? p.name.zh : p.name.en) : ''; };
  const minute = snap?.clock && d.agenda && snap.clock.date === d.agenda.sim_date ? snap.clock.minute : null;
  const apps = new Map(d.sessions.map((x) => [x.app_id, x.app]));
  const okRate = d.sessions.length ? d.sessions.filter((x) => x.outcome === 'success').length / d.sessions.length : null;

  return (
    <article>
      <header className="flex flex-wrap items-start gap-6">
        <Avatar id={id} size={136} ring={!!live?.session} className="!rounded-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold">{id0.name}</h1>
          <p className="mt-1 text-fg-muted">{id0.age} · {id0.gender} · {id0.region} · {id0.occupation}</p>
          <div className="mt-3 flex flex-wrap gap-1.5"><span className="chip">{L(d.segment)}</span><span className="chip">{L(d.kind)}</span>{d.target_user && <span className="chip border-secondary text-secondary-fg">{t('target_user')}</span>}{id0.income_band && <span className="chip">{id0.income_band}</span>}</div>
          {live && (
            <Link to="/" search={{ focus: id }} className="mt-4 inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition-colors hover:border-accent">
              <span className={`h-2 w-2 shrink-0 rounded-full ${live.session ? 'bg-accent live-dot' : 'bg-secondary'}`} />
              <span className="truncate">{placeName(live.place_id) || L(live.place_kind)} · {live.session ? `${t('using')} ${live.session.app}` : live.activity}</span>
              <MapPin size={14} className="shrink-0 text-fg-subtle" />
            </Link>
          )}
        </div>
        <dl className="tabular grid grid-cols-3 gap-6 text-right">
          <div><dt className="text-xs text-fg-muted">{t('nav.apps')}</dt><dd className="text-2xl font-semibold text-fg-display">{apps.size}</dd></div>
          <div><dt className="text-xs text-fg-muted">{t('sessions')}</dt><dd className="text-2xl font-semibold text-fg-display">{d.sessions.length}</dd></div>
          <div><dt className="text-xs text-fg-muted">{t('completion')}</dt><dd className="text-2xl font-semibold text-fg-display">{okRate === null ? '—' : `${Math.round(okRate * 100)}%`}</dd></div>
        </dl>
      </header>

      <div className="mt-4 grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {d.agenda && <Section title={t('today')} aside={<span className="tabular text-xs text-fg-subtle">{d.agenda.sim_date}</span>}><DayLane items={d.agenda.items} minute={minute} placeName={placeName} /></Section>}
          <Section title={t('history')}>{d.sessions.length ? <History sessions={d.sessions} /> : <p className="text-sm text-fg-subtle">—</p>}</Section>
          <Section title={t('memories')} aside={<span className="tabular text-xs text-fg-subtle">{d.memories.length}</span>}>{d.memories.length ? <MemoryList items={d.memories} apps={apps} /> : <p className="text-sm text-fg-subtle">—</p>}</Section>
        </div>
        <aside className="min-w-0">
          <Section title={t('profile')}>
            <dl className="space-y-4 text-sm">
              <div><dt className="text-xs text-fg-subtle">{t('story')}</dt><dd className="mt-1 leading-relaxed text-fg">{id0.life_story}</dd></div>
              {id0.family.length > 0 && <div><dt className="text-xs text-fg-subtle">{t('family')}</dt><dd className="mt-1">{id0.family.join(lang === 'zh' ? '、' : ', ')}</dd></div>}
              <div><dt className="text-xs text-fg-subtle">{t('motivations')}</dt><dd className="mt-1">{s.psychology.motivations.join(lang === 'zh' ? '、' : ', ')}</dd></div>
              <div><dt className="text-xs text-fg-subtle">{t('values')}</dt><dd className="mt-1">{s.psychology.values.join(lang === 'zh' ? '、' : ', ')}</dd></div>
              {s.psychology.beliefs.length > 0 && <div><dt className="text-xs text-fg-subtle">{t('beliefs')}</dt><dd className="mt-1">{s.psychology.beliefs.join(lang === 'zh' ? '；' : '; ')}</dd></div>}
            </dl>
            <div className="mt-6 space-y-2.5">
              <Meter label={t('digital_literacy')} value={s.capability.digital_literacy} />
              <Meter label={t('ai_familiarity')} value={s.capability.ai_familiarity} />
              <Meter label={t('trust_in_ai')} value={d.trust?.ai_trust ?? s.psychology.trust_in_ai} tone="accent" />
              <Meter label={t('privacy')} value={s.psychology.privacy_sensitivity} />
              <Meter label={t('price')} value={s.psychology.price_sensitivity} />
              <Meter label={t('patience')} value={s.behavior_policy.patience_base} max={100} fmt={(v) => v.toFixed(0)} />
            </div>
            <div className="mt-6 grid grid-cols-5 gap-2 text-center">
              {(['O', 'C', 'E', 'A', 'N'] as const).map((k) => (
                <div key={k}><div className="relative mx-auto h-16 w-2 overflow-hidden rounded-full bg-border"><span className="absolute inset-x-0 bottom-0 rounded-full bg-secondary" style={{ height: `${s.psychology.ocean[k] * 100}%` }} /></div><span className="mt-1 block text-[11px] text-fg-subtle">{k}</span></div>
              ))}
            </div>
            {s.behavior_policy.abandonment_rules.length > 0 && <ul className="mt-6 space-y-1.5 text-xs text-fg-muted">{s.behavior_policy.abandonment_rules.map((r) => <li key={r}>— {r}</li>)}</ul>}
          </Section>
        </aside>
      </div>
    </article>
  );
}
