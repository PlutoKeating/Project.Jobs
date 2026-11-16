// 一个产品在城里过得怎么样：一页人话（每句都能点开看是谁说的）、人数、宣发、口碑；技术信号单独放在工程附录
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, ChevronDown, Minus, Pause, Play, Plus, PowerOff, RefreshCw, RotateCcw, Square, Star } from 'lucide-react';
import { ApiError, del, evidenceUrl, get, post, queryClient, useEngineering, useLaunch, useLaunchReport, useMe } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import type { Audience, Cited, Launch, LaunchDetail, LaunchReport, LaunchStatus, Use } from '../lib/types.ts';
import { Avatar, Button, ErrorState, PersonLink, Seg, Sev, Skeleton } from '../components/ui.tsx';
import { FUNNEL_STEPS, useLiveFunnel, type FunnelNums } from './Products.tsx';

type Tab = 'verdict' | 'people' | 'voices' | 'engineering';
const SEGMENTS = ['office_worker', 'student', 'teen', 'senior', 'professional', 'service_worker', 'blue_collar', 'freelancer', 'homemaker', 'job_seeker'] as const;
const when = (at: string, lang: string) => new Date(at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 漏斗：五层人数，条长按「看到」的人数等比 */
function FunnelBars({ f }: { f: FunnelNums }) {
  const { t } = useT();
  const max = Math.max(1, f.reached);
  return (
    <dl className="space-y-2">
      {FUNNEL_STEPS.map((k) => (
        <div key={k} className="grid grid-cols-[4.5rem_1fr_2.75rem] items-center gap-3">
          <dt className="truncate text-xs text-fg-muted">{t(`f_${k}`)}</dt>
          <dd className="relative h-4"><span className="absolute inset-y-0 left-0 rounded-xs bg-secondary transition-[width] duration-500" style={{ width: f[k] ? `max(2px, ${(f[k] / max) * 100}%)` : 0 }} /></dd>
          <dd className={`tabular text-right text-base font-semibold ${f[k] ? 'text-fg-display' : 'text-fg-subtle'}`}>{f[k]}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <section className="border-t border-border py-5"><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{title}</h2>{aside}</div>{children}</section>;
}

function Promotion({ l, admin }: { l: LaunchDetail; admin: boolean }) {
  const { t } = useT(); const L = useLabel(); const qc = useQueryClient();
  const [v, setV] = useState(Math.round(l.intensity * 100));
  const touching = useRef(false);
  useEffect(() => { if (!touching.current) setV(Math.round(l.intensity * 100)); }, [l.intensity]);
  const a = l.audience ?? {};
  const [ages, setAges] = useState<[string, string]>([a.age_min?.toString() ?? '', a.age_max?.toString() ?? '']);
  const save = async (patch: { intensity?: number; audience?: Audience }) => {
    const out = await post<Launch>(`/launches/${l.id}/promotion`, patch);
    qc.setQueryData<LaunchDetail>(['launch', l.id], (d) => (d ? { ...d, intensity: out.intensity, audience: out.audience, status: out.status } : d));
    void qc.invalidateQueries({ queryKey: ['launches'] });
  };
  const audience = (patch: Audience) => {
    const n: Audience = { ...a, ...patch };
    for (const k of Object.keys(n) as (keyof Audience)[]) { const x = n[k]; if (x === undefined || (Array.isArray(x) && !x.length) || (typeof x === 'number' && Number.isNaN(x))) delete n[k]; }
    void save({ audience: n });
  };
  const commit = () => { touching.current = false; if (v !== Math.round(l.intensity * 100)) void save({ intensity: v / 100 }); };
  const commitAges = () => { const num = (s: string) => (s.trim() === '' ? undefined : Math.max(0, Math.min(120, Number(s)))); const [lo, hi] = [num(ages[0]), num(ages[1])]; if (lo !== a.age_min || hi !== a.age_max) audience({ age_min: lo, age_max: hi }); };
  const locale = a.locales?.length === 1 ? a.locales[0] : 'all';
  const segs = new Set(a.segments ?? []);
  return (
    <>
      <Block title={t('promotion')} aside={<span className="tabular text-sm text-fg-display">{v}%</span>}>
        <input type="range" min={0} max={100} step={5} value={v} disabled={!admin} aria-label={t('promotion')} className="range" style={{ ['--v' as string]: `${v}%` }}
          onChange={(e) => { touching.current = true; setV(Number(e.target.value)); }} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      </Block>
      <Block title={t('audience')}>
        <fieldset disabled={!admin} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Seg size="sm" value={locale} onChange={(x) => audience({ locales: x === 'all' ? undefined : [x] })} options={[{ value: 'all', label: t('everyone') }, { value: 'zh-CN', label: '中文' }, { value: 'en-US', label: 'English' }]} />
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <input aria-label={t('age_min')} inputMode="numeric" placeholder="0" className="field tabular h-7 w-12 px-2 py-0 text-center text-xs" value={ages[0]} onChange={(e) => setAges([e.target.value.replace(/\D/g, ''), ages[1]])} onBlur={commitAges} onKeyDown={(e) => { if (e.key === 'Enter') commitAges(); }} />
              <span aria-hidden>–</span>
              <input aria-label={t('age_max')} inputMode="numeric" placeholder="99" className="field tabular h-7 w-12 px-2 py-0 text-center text-xs" value={ages[1]} onChange={(e) => setAges([ages[0], e.target.value.replace(/\D/g, '')])} onBlur={commitAges} onKeyDown={(e) => { if (e.key === 'Enter') commitAges(); }} />
              <span>{t('years_old')}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SEGMENTS.map((s) => { const on = segs.has(s); return (
              <button key={s} type="button" aria-pressed={on} onClick={() => { const n = new Set(segs); if (on) n.delete(s); else n.add(s); audience({ segments: [...n] }); }}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${on ? 'border-fg-display bg-fg-display text-bg' : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'}`}>{L(s)}</button>
            ); })}
          </div>
        </fieldset>
      </Block>
    </>
  );
}

function Invite({ l }: { l: LaunchDetail }) {
  const { t } = useT(); const L = useLabel(); const qc = useQueryClient();
  const [n, setN] = useState(3); const [seg, setSeg] = useState(''); const [want, setWant] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'err' | number>('idle');
  return (
    <Block title={t('hand_phone')}>
      <form className="space-y-2.5" onSubmit={async (e) => {
        e.preventDefault(); setState('busy');
        try { const r = await post<{ invited: number }>(`/launches/${l.id}/invite`, { n, segment: seg || undefined, want: want.trim() || undefined }); setState(r.invited); setWant(''); void qc.invalidateQueries({ queryKey: ['launch', l.id] }); setTimeout(() => setState('idle'), 2400); }
        catch { setState('err'); setTimeout(() => setState('idle'), 2400); }
      }}>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 items-center rounded-md border border-border">
            <button type="button" aria-label="−" disabled={n <= 1} onClick={() => setN(n - 1)} className="grid h-full w-8 place-items-center text-fg-muted hover:text-fg"><Minus size={13} /></button>
            <output className="tabular w-6 text-center text-sm text-fg-display">{n}</output>
            <button type="button" aria-label="+" disabled={n >= 10} onClick={() => setN(n + 1)} className="grid h-full w-8 place-items-center text-fg-muted hover:text-fg"><Plus size={13} /></button>
          </span>
          <select aria-label={t('audience')} value={seg} onChange={(e) => setSeg(e.target.value)} className="field h-9 min-w-0 flex-1 py-0">
            <option value="">{t('anyone')}</option>
            {SEGMENTS.map((s) => <option key={s} value={s}>{L(s)}</option>)}
          </select>
        </div>
        <input className="field h-9" aria-label={t('want')} placeholder={t('want')} maxLength={120} value={want} onChange={(e) => setWant(e.target.value)} />
        <Button type="submit" className="w-full" disabled={state !== 'idle' || l.status === 'ended'}>{state === 'busy' ? '…' : state === 'err' ? t('error') : typeof state === 'number' ? t('invited_n', { n: state }) : t('hand_over')}</Button>
      </form>
    </Block>
  );
}

function Faces({ ids }: { ids: string[] }) {
  return <span className="flex shrink-0 -space-x-1.5">{[...new Set(ids)].slice(0, 4).map((id) => <Avatar key={id} id={id} size={24} className="ring-2 ring-bg" />)}</span>;
}

/** 结论里的一句话：点开是说这话的人、原话和当时的屏幕 */
function CitedItem({ c }: { c: Cited }) {
  const { t } = useT(); const L = useLabel();
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-border">
      <button aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-start gap-4 py-4 text-left">
        <span className="min-w-0 flex-1 text-[15px] leading-relaxed text-fg-display">{c.text}</span>
        <Faces ids={[...c.moments.map((m) => m.persona_id), ...c.passersby.map((p) => p.persona_id)]} />
        <ChevronDown size={16} className={`mt-1 shrink-0 text-fg-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="animate-reveal space-y-5 pb-6">
          {c.moments.map((m) => (
            <li key={m.ref} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3 gap-y-2 sm:grid-cols-[2rem_minmax(0,1fr)_10rem]">
              <Link to="/people/$id" params={{ id: m.persona_id }}><Avatar id={m.persona_id} size={32} /></Link>
              <div className="min-w-0">
                <p className="text-xs text-fg-muted"><Link to="/people/$id" params={{ id: m.persona_id }} className="font-medium text-fg hover:text-accent">{m.persona}</Link> · {m.who}</p>
                <p className="mt-1 text-sm leading-relaxed text-fg">“{m.quote}”</p>
                {m.session_id && <Link to="/sessions/$id" params={{ id: m.session_id }} hash={`s${m.step_idx}`} className="mt-1.5 inline-flex items-center gap-1 text-xs text-link hover:text-accent">{t('open_session')}<ArrowRight size={12} /></Link>}
              </div>
              {m.screenshot_ev && m.session_id && <Link to="/sessions/$id" params={{ id: m.session_id }} hash={`s${m.step_idx}`} className="col-start-2 sm:col-start-3"><img src={evidenceUrl(m.screenshot_ev)} alt="" loading="lazy" className="aspect-[4/3] w-40 rounded-md border border-border object-cover object-top transition-opacity hover:opacity-85" /></Link>}
            </li>
          ))}
          {c.passersby.map((p) => (
            <li key={p.ref} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-3">
              <Link to="/people/$id" params={{ id: p.persona_id }}><Avatar id={p.persona_id} size={32} /></Link>
              <div className="min-w-0">
                <p className="text-xs text-fg-muted"><Link to="/people/$id" params={{ id: p.persona_id }} className="font-medium text-fg hover:text-accent">{p.persona}</Link> · {p.who} · {L(`ch_${p.channel}`)}</p>
                <p className="mt-1 text-sm leading-relaxed text-fg">“{p.thought}”</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Group({ title, items }: { title: string; items: Cited[] }) {
  if (!items.length) return null;
  return <section className="mt-10"><h2 className="mb-3 text-lg font-semibold">{title}</h2><ul className="border-b border-border">{items.map((c, i) => <CitedItem key={i} c={c} />)}</ul></section>;
}

const VERDICT_TONE: Record<LaunchReport['verdict'], string> = { works: 'bg-success', mixed: 'bg-warning', not_yet: 'bg-danger', too_early: 'bg-fg-subtle' };

function VerdictTab({ id, basis, admin }: { id: string; basis: number; admin: boolean }) {
  const { t, lang } = useT(); const L = useLabel(); const qc = useQueryClient();
  const q = useLaunchReport(id, lang, true, basis);
  const [busy, setBusy] = useState(false);
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="py-2"><p className="flex items-center gap-2 text-sm text-fg-muted"><span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />{t('summarizing')}</p><Skeleton className="mt-5 h-9 w-3/4" /><Skeleton className="mt-4 h-20 w-full max-w-[65ch]" /></div>;
  const r = q.data;
  return (
    <div className={q.isPlaceholderData ? 'opacity-70 transition-opacity' : 'transition-opacity'}>
      <h2 className="max-w-[40ch] text-3xl font-semibold leading-tight sm:text-4xl">{r.headline}</h2>
      <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
        <span className={`h-2 w-2 rounded-full ${VERDICT_TONE[r.verdict]}`} /><span className="text-fg">{L(`v_${r.verdict}`)}</span>
        <span>· {t('used_n', { n: r.people_used })}</span>
        {r.refreshing && <span className="flex items-center gap-1.5">· <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />{t('refreshing_report')}</span>}
        {admin && <button aria-label={t('resummarize')} title={t('resummarize')} disabled={busy} onClick={async () => { setBusy(true); try { const fresh = await get<LaunchReport>(`/launches/${id}/report?lang=${lang}&force=1`); qc.setQueryData(['launch-report', id, lang, basis], fresh); } finally { setBusy(false); } }} className="ml-1 rounded-xs p-1 text-fg-subtle hover:bg-surface-hover hover:text-fg"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /></button>}
      </p>
      <p className="mt-5 max-w-[65ch] text-base leading-relaxed text-fg">{r.summary}</p>
      {r.next && <div className="mt-8 border-y border-border-strong py-5"><h2 className="text-sm font-semibold text-fg-muted">{t('one_thing')}</h2><p className="mt-2 max-w-[60ch] text-xl font-medium leading-snug text-fg-display">{r.next}</p></div>}
      <Group title={t('hurts')} items={r.hurts} />
      <Group title={t('delights')} items={r.delights} />
      <Group title={t('who_stays')} items={r.who_stays} />
      <Group title={t('who_leaves')} items={r.who_leaves} />
      <Group title={t('why_not_opened')} items={r.why_not_opened} />
    </div>
  );
}

function UseRow({ u }: { u: Use }) {
  const { t } = useT(); const L = useLabel();
  const running = ['running', 'waiting_human', 'planned'].includes(u.status);
  return (
    <li className="border-t border-border">
      <Link to="/sessions/$id" params={{ id: u.session_id }} className="group grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-3 py-3.5">
        <Avatar id={u.persona_id} size={36} ring={running} />
        <span className="min-w-0">
          <span className="flex flex-wrap items-baseline gap-x-2"><span className="font-medium text-fg-display group-hover:text-accent">{u.name}</span><span className="text-xs text-fg-muted">{u.age} · {u.occupation}</span></span>
          <span className="mt-0.5 block truncate text-xs text-fg-subtle">{[u.where, u.when, u.device && L(u.device), u.invited ? L('ch_invite') : u.channel && L(`ch_${u.channel}`), u.visit > 1 && t('visit_n', { n: u.visit })].filter(Boolean).join(' · ')}</span>
          {u.end_reason && <span className="mt-1.5 line-clamp-2 block text-sm leading-relaxed text-fg-muted">{u.end_reason}</span>}
        </span>
        <span className={`text-xs ${running ? 'text-accent' : u.outcome === 'success' ? 'text-success' : u.outcome ? 'text-danger' : 'text-fg-muted'}`}>{L(running ? 'running' : u.outcome ?? u.status)}</span>
      </Link>
    </li>
  );
}

function PeopleTab({ d }: { d: LaunchDetail }) {
  const { t } = useT(); const L = useLabel();
  const [all, setAll] = useState(false);
  const passers = all ? d.passersby : d.passersby.slice(0, 12);
  return (
    <div className="space-y-10">
      <section>
        <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold">{t('used_it')}<span className="tabular text-sm font-normal text-fg-subtle">{d.uses.length}</span></h2>
        {d.uses.length ? <ul className="border-b border-border">{d.uses.map((u) => <UseRow key={u.session_id} u={u} />)}</ul> : <p className="text-sm text-fg-subtle">{t('empty_sessions')}</p>}
      </section>
      {d.passersby.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-baseline gap-2 text-lg font-semibold">{t('walked_past')}<span className="tabular text-sm font-normal text-fg-subtle">{d.passersby.length}</span></h2>
          <ul className="border-b border-border">
            {passers.map((p, i) => (
              <li key={i} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-x-3 border-t border-border py-3">
                <Link to="/people/$id" params={{ id: p.persona_id }}><Avatar id={p.persona_id} size={36} /></Link>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-x-2"><Link to="/people/$id" params={{ id: p.persona_id }} className="font-medium text-fg-display hover:text-accent">{p.name}</Link><span className="text-xs text-fg-muted">{p.age} · {p.occupation}</span></span>
                  {p.thought && <span className="mt-1 block text-sm leading-relaxed text-fg-muted">“{p.thought}”</span>}
                </span>
                <span className="text-right text-xs text-fg-subtle"><span className="block">{L(`ch_${p.channel}`)}</span><span className="block">{L(`re_${p.reaction}`)}</span></span>
              </li>
            ))}
          </ul>
          {!all && d.passersby.length > passers.length && <Button size="sm" variant="ghost" className="mt-3" onClick={() => setAll(true)}>{t('show_all', { n: d.passersby.length })}</Button>}
        </section>
      )}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return <span className="inline-flex gap-0.5" role="img" aria-label={`${n}/5`}>{[1, 2, 3, 4, 5].map((i) => <Star key={i} size={12} className={i <= n ? 'text-fg-display' : 'text-border-strong'} fill={i <= n ? 'currentColor' : 'none'} />)}</span>;
}

function VoicesTab({ d }: { d: LaunchDetail }) {
  const { t, lang } = useT();
  return (
    <div className="space-y-10">
      <section className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">{t('store_page')}</h2>
          <p className="mt-3 font-medium text-fg-display">{d.name}</p>
          <p className="text-sm text-fg-muted">{d.tagline}</p>
          {d.description && <p className="mt-2 max-w-[60ch] text-sm leading-relaxed text-fg-muted">{d.description}</p>}
          <p className="tabular mt-3 flex items-center gap-2 text-sm">{d.funnel.rating ? <><span className="text-2xl font-semibold text-fg-display">{d.funnel.rating.toFixed(1)}</span><Stars n={Math.round(d.funnel.rating)} /><span className="text-fg-subtle">{d.reviews.length}</span></> : <span className="text-fg-subtle">{t('no_rating')}</span>}</p>
        </div>
        {d.shots.length > 0 && <div className="flex gap-2 overflow-x-auto">{d.shots.map((ev) => <a key={ev} href={evidenceUrl(ev)} target="_blank" rel="noreferrer" className="shrink-0"><img src={evidenceUrl(ev)} alt="" loading="lazy" className="h-44 w-auto rounded-md border border-border" /></a>)}</div>}
      </section>
      <section>
        <h2 className="mb-3 text-lg font-semibold">{t('reviews')}</h2>
        {d.reviews.length ? (
          <ul className="border-b border-border">
            {d.reviews.map((r) => (
              <li key={r.id} className="border-t border-border py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><PersonLink id={r.persona_id} name={r.name} /><Stars n={r.rating} /><span className="tabular text-xs text-fg-subtle">{when(r.at, lang)}</span></div>
                <p className="mt-2 max-w-[70ch] text-sm leading-relaxed">{r.body}</p>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-fg-subtle">{t('no_reviews')}</p>}
      </section>
      {d.posts.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('posts')}</h2>
          <ul className="border-b border-border">
            {d.posts.map((p) => (
              <li key={p.id} className="border-t border-border py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><PersonLink id={p.persona_id} name={p.name} /><span className="tabular text-xs text-fg-subtle">{when(p.at, lang)}</span></div>
                <p className="mt-2 max-w-[70ch] text-sm leading-relaxed">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function EngineeringTab({ id }: { id: string }) {
  const { t, lang } = useT(); const L = useLabel();
  const q = useEngineering(id, true);
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  const { experienced, appendix } = q.data;
  const title = (i: { title: string; title_en?: string | null }) => (lang === 'en' && i.title_en ? i.title_en : i.title);
  if (!experienced.length && !appendix.length) return <p className="text-sm text-fg-subtle">{t('no_issues')}</p>;
  return (
    <div className="space-y-10">
      {experienced.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('experienced')}</h2>
          <ul className="border-b border-border">
            {experienced.map((i) => (
              <li key={i.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-t border-border py-4">
                <Sev s={i.severity} />
                <div className="min-w-0">
                  <p className="font-medium text-fg-display">{title(i)}</p>
                  <p className="tabular mt-0.5 text-xs text-fg-subtle">{[t('n_people', { n: i.people }), i.reproduced && t('reproduced'), i.where].filter(Boolean).join(' · ')}</p>
                  {i.description && <p className="mt-2 max-w-[75ch] text-sm leading-relaxed text-fg-muted">{i.description}</p>}
                  {i.steps.length > 0 && <ol className="mt-2 list-decimal space-y-0.5 pl-5 font-mono text-xs text-fg-muted">{i.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {appendix.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">{t('unseen')}</h2>
          <ul className="border-b border-border">
            {appendix.map((i) => (
              <li key={i.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-t border-border py-4">
                <Sev s={i.severity} />
                <div className="min-w-0">
                  <p className="font-medium text-fg-display">{title(i)}</p>
                  <p className="mt-0.5 text-xs text-fg-subtle">{[L(i.category), i.where].filter(Boolean).join(' · ')}</p>
                  {i.recommendation && <p className="mt-2 max-w-[75ch] text-sm leading-relaxed text-fg-muted">{i.recommendation}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** 清零（经历归零、产品留着、此刻重新上线）与下线（可选是否连经历一起删）。都要确认 */
function Lifecycle({ d }: { d: LaunchDetail }) {
  const { t } = useT(); const nav = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'reset' | 'remove' | null>(null);
  const [keep, setKeep] = useState(true); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const x = ref.current; if (!x) return; if (mode && !x.open) x.showModal(); else if (!mode && x.open) x.close(); }, [mode]);
  const close = () => { if (!busy) { setMode(null); setErr(null); } };
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === 'reset') {
        await post(`/launches/${d.id}/reset`);
        await queryClient.invalidateQueries({ predicate: (q) => ['launch', 'launch-report', 'launch-eng', 'launches', 'overview', 'personas', 'persona'].includes(String(q.queryKey[0])) });
        setMode(null);
      } else {
        await del(`/launches/${d.id}${keep ? '' : '?history=delete'}`);
        await queryClient.invalidateQueries({ queryKey: ['launches'] });
        setMode(null); void nav({ to: '/products' });
      }
    } catch (e) { setErr(e instanceof ApiError ? e.code : t('error')); } finally { setBusy(false); }
  };
  const Choice = ({ v, title, hint }: { v: boolean; title: string; hint: string }) => (
    <label className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 transition-colors ${keep === v ? 'border-fg-subtle bg-surface' : 'border-border hover:border-border-strong'}`}>
      <input type="radio" name="lc-keep" className="mt-1 accent-[var(--color-accent)]" checked={keep === v} onChange={() => setKeep(v)} disabled={busy} />
      <span><span className="block text-sm text-fg-display">{title}</span><span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{hint}</span></span>
    </label>
  );
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setMode('reset')}><RotateCcw size={13} />{t('lc_reset')}</Button>
      <Button size="sm" variant="ghost" onClick={() => { setKeep(true); setMode('remove'); }}><PowerOff size={13} />{t('lc_remove')}</Button>
      <dialog ref={ref} onClose={close} onCancel={(e) => { if (busy) e.preventDefault(); }} onClick={(e) => { if (e.target === ref.current) close(); }}
        className="m-auto w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-border-strong bg-bg-elevated p-0 text-fg backdrop:bg-overlay">
        {mode && (
          <div className="p-6">
            <h2 className="text-lg font-semibold">{t(mode === 'reset' ? 'lc_reset_title' : 'lc_remove_title', { n: d.name })}</h2>
            <p className="mt-3 text-sm leading-relaxed text-fg-muted">{t(mode === 'reset' ? 'lc_reset_body' : 'lc_remove_body')}</p>
            {mode === 'remove' && (
              <div className="mt-4 space-y-2" role="radiogroup">
                <Choice v title={t('lc_keep')} hint={t('lc_keep_hint')} />
                <Choice v={false} title={t('lc_wipe')} hint={t('lc_wipe_hint')} />
              </div>
            )}
            {err && <p role="alert" className="mt-3 break-words text-xs text-danger">{err}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="ghost" disabled={busy} onClick={close}>{t('cancel')}</Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void run()}>{busy ? t('lc_doing') : t(mode === 'reset' ? 'lc_reset' : 'lc_remove')}</Button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

export function LaunchPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const search = useSearch({ strict: false }) as { tab?: Tab };
  const nav = useNavigate(); const qc = useQueryClient();
  const q = useLaunch(id); const me = useMe().data; const { t, lang } = useT();
  const tab: Tab = search.tab ?? 'verdict';
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <div className="space-y-4"><Skeleton className="h-16 w-2/3" /><Skeleton className="h-72 w-full" /></div>;
  return <Loaded d={q.data} tab={tab} admin={!!me?.admin} lang={lang} t={t}
    onTab={(x) => void nav({ to: '/products/$id', params: { id }, search: x === 'verdict' ? {} : { tab: x }, replace: true })}
    onStatus={async (status) => { const out = await post<Launch>(`/launches/${id}/promotion`, { status }); qc.setQueryData<LaunchDetail>(['launch', id], (x) => (x ? { ...x, status: out.status } : x)); void qc.invalidateQueries({ queryKey: ['launches'] }); }} />;
}

function Loaded({ d: raw, tab, admin, lang, t, onTab, onStatus }: { d: LaunchDetail; tab: Tab; admin: boolean; lang: string; t: ReturnType<typeof useT>['t']; onTab: (t: Tab) => void; onStatus: (s: LaunchStatus) => Promise<void> }) {
  const d = useLiveFunnel(raw); const f = d.funnel;
  const finished = d.uses.filter((u) => !['running', 'waiting_human', 'planned'].includes(u.status)).length;
  return (
    <article>
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-x-3 text-2xl font-semibold">{d.name}{d.status !== 'live' && <span className="chip font-normal">{t(d.status === 'paused' ? 'st_paused' : 'st_ended')}</span>}</h1>
          <p className="mt-1 text-fg-muted">{d.tagline}</p>
          <p className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
            <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[18rem] items-center gap-1 truncate text-link hover:text-accent">{d.url.replace(/^https?:\/\//, '')}<ArrowUpRight size={12} className="shrink-0" /></a>
            <span>{when(d.created_at, lang)}</span>
            <span title={`${d.spend.tokens.toLocaleString()} tokens`}>{t('spent')} ${d.spend.usd.toFixed(2)}</span>
          </p>
        </div>
        {admin && (
          <div className="flex flex-wrap gap-2">
            {d.status === 'live' ? <Button size="sm" onClick={() => void onStatus('paused')}><Pause size={13} />{t('pause')}</Button> : <Button size="sm" onClick={() => void onStatus('live')}><Play size={13} />{t('resume')}</Button>}
            {d.status !== 'ended' && <Button size="sm" variant="ghost" onClick={() => void onStatus('ended')}><Square size={12} />{t('end')}</Button>}
            <Lifecycle d={d} />
          </div>
        )}
      </header>

      <div className="mt-8 grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_21rem] lg:grid-rows-[auto_1fr]">
        <aside className="lg:col-start-2 lg:row-start-1">
          <Block title={<span className="flex items-center gap-2">{t('funnel')}<span className="chip font-normal" title={t('simulated_hint')}>{t('simulated')}</span></span>}
            aside={f.using_now > 0 && <span className="inline-flex items-center gap-1.5 text-xs text-accent"><span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />{t('using_n', { n: f.using_now })}</span>}>
            <FunnelBars f={f} />
          </Block>
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 lg:border-t-0 lg:pt-0">
            <Seg value={tab === 'engineering' ? ('' as Tab) : tab} onChange={onTab} options={[{ value: 'verdict', label: t('verdict') }, { value: 'people', label: t('nav.people') }, { value: 'voices', label: t('voices') }]} />
            <button role="tab" aria-selected={tab === 'engineering'} onClick={() => onTab('engineering')} className={`rounded-md px-2.5 py-1 text-sm transition-colors ${tab === 'engineering' ? 'bg-surface-hover text-fg-display' : 'text-fg-subtle hover:text-fg'}`}>{t('engineering')}</button>
          </div>
          {tab === 'verdict' && <VerdictTab id={d.id} basis={finished} admin={admin} />}
          {tab === 'people' && <PeopleTab d={d} />}
          {tab === 'voices' && <VoicesTab d={d} />}
          {tab === 'engineering' && <EngineeringTab id={d.id} />}
        </div>

        <aside className="mt-10 lg:col-start-2 lg:row-start-2 lg:mt-0">
          <div className="lg:sticky lg:top-[calc(var(--ds-header-height)+1.5rem)]">
            <Promotion l={d} admin={admin} />
            {admin && <Invite l={d} />}
          </div>
        </aside>
      </div>
    </article>
  );
}
