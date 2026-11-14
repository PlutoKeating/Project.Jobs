import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { Check, Frown, RotateCcw, Smile, Sparkles, X } from 'lucide-react';
import { evidenceUrl, post, queryClient, useAppReport, useMe, usePersonas, useVerdict } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import type { AppReport, GroupStat, IssueRow, Quote } from '../lib/types.ts';
import { Chart, SERIES, useThemeMode } from '../components/Chart.tsx';
import { Button, Empty, ErrorState, num, pct, PersonLink, Section, Seg, Sev, Skeleton, Stat } from '../components/ui.tsx';

const RATING_TONE: Record<string, string> = { recommend: 'text-success', promising: 'text-accent', mixed: 'text-warning', not_ready: 'text-danger' };

function TrustLine({ r }: { r: AppReport }) {
  const { t } = useT(); const L = useLabel();
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="chip">{t('trust')} · {L(r.trust.level)}</span>
      <span className="chip">{t('simulated')}</span>
      {r.trust.isolation_warning && <span className="chip">{t('single_vendor')}</span>}
      {r.trust.recall != null && <span className="chip tabular">recall {pct(r.trust.recall)}{r.trust.fpr != null ? ` · FPR ${pct(r.trust.fpr)}` : ''}</span>}
    </span>
  );
}

function VerdictBlock({ id, r }: { id: string; r: AppReport }) {
  const { t, lang } = useT(); const L = useLabel(); const me = useMe().data;
  const q = useVerdict(id, lang);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const basis = `${r.overview.sessions}:${r.issues.length}:${r.overview.issues.confirmed}`;
  const make = async () => { setBusy(true); setErr(null); try { await post(`/apps/${id}/verdict`, { lang }); await queryClient.invalidateQueries({ queryKey: ['verdict', id, lang] }); } catch (e) { setErr(String((e as Error).message)); } finally { setBusy(false); } };
  const v = q.data?.verdict;
  if (busy || q.isLoading) return <div className="space-y-3 py-2"><Skeleton className="h-9 w-3/4" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></div>;
  if (!v) return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-dashed border-border-strong px-6 py-8">
      <TrustLine r={r} />
      {me?.admin && r.overview.sessions > 0 && <Button variant="primary" onClick={make}><Sparkles size={15} />{t('make_verdict')}</Button>}
      {err && <p className="w-full text-sm text-danger">{err}</p>}
    </div>
  );
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <span className={`text-sm font-semibold ${RATING_TONE[v.rating]}`}>{L(v.rating)}</span>
        <h2 className="max-w-4xl text-3xl font-semibold leading-tight">{v.headline}</h2>
      </div>
      <p className="mt-4 max-w-[70ch] leading-relaxed text-fg-muted">{v.summary}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <TrustLine r={r} />
        {me?.admin && <Button size="sm" variant="ghost" onClick={make}><RotateCcw size={13} />{q.data!.basis !== basis ? t('stale') : t('regen')}</Button>}
      </div>
      <dl className="mt-8 grid gap-x-10 gap-y-6 sm:grid-cols-2 xl:grid-cols-4">
        {([['best_for', v.best_for, 'text-success'], ['struggles_for', v.struggles_for, 'text-danger'], ['strengths', v.strengths, ''], ['weaknesses', v.weaknesses, '']] as const).map(([k, xs, tone]) => (
          <div key={k}><dt className={`text-xs font-medium ${tone || 'text-fg-subtle'}`}>{t(k)}</dt><dd><ul className="mt-2 space-y-1.5 text-sm leading-relaxed">{xs.map((x) => <li key={x}>{x}</li>)}</ul></dd></div>
        ))}
      </dl>
      {v.next_steps.length > 0 && <div className="mt-6 text-sm"><span className="text-xs text-fg-subtle">{t('next_steps')}</span><ol className="mt-2 list-decimal space-y-1 pl-5 marker:text-fg-subtle">{v.next_steps.map((x) => <li key={x}>{x}</li>)}</ol></div>}
    </div>
  );
}

const DIMS = ['segment', 'age', 'digital_literacy', 'ai_familiarity', 'scenario', 'mode', 'target_user', 'gender'];

function FitChart({ groups }: { groups: GroupStat[] }) {
  const { t } = useT(); const L = useLabel(); const mode = useThemeMode();
  const [dim, setDim] = useState('segment');
  const rows = groups.filter((g) => g.dim === dim && g.fit !== null).sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
  const [ca, cb] = SERIES[mode];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">{DIMS.filter((d) => groups.some((g) => g.dim === d)).map((d) => <button key={d} onClick={() => setDim(d)} className={`rounded-md px-2.5 py-1 text-xs transition-colors ${dim === d ? 'bg-surface-hover text-fg-display' : 'text-fg-muted hover:text-fg'}`}>{L(d)}</button>)}</div>
        <span className="flex items-center gap-4 text-xs text-fg-muted"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: ca }} />{t('target')}</span><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: cb }} />{L('general')}</span></span>
      </div>
      <ul className="space-y-1">
        {rows.map((g) => (
          <li key={g.key} className="group grid grid-cols-[minmax(6rem,10rem)_1fr_7rem] items-center gap-4 rounded-md px-2 py-1.5 hover:bg-surface"
            title={`${t('completion')} ${pct(g.completion)} · SUS ${num(g.sus)} · ${t('again')} ${pct(g.again)} · ${t('satisfaction')} ${num(g.sat, 1)}/7`}>
            <span className="truncate text-sm">{L(g.key)}{g.target && <span className="ml-1.5 text-[11px] text-fg-subtle">◆</span>}</span>
            <span className="relative h-3"><span className="absolute inset-y-0 left-0 rounded-r-[4px]" style={{ width: `${(g.fit ?? 0) * 100}%`, background: g.target ? ca : cb, opacity: g.n < 3 ? 0.5 : 1 }} /></span>
            <span className="tabular text-right text-xs"><span className="text-fg-display">{Math.round((g.fit ?? 0) * 100)}</span><span className="ml-2 text-fg-subtle">n={g.n}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuoteWall({ quotes, names }: { quotes: Quote[]; names: Map<string, string> }) {
  const { t } = useT();
  const [kind, setKind] = useState<'all' | Quote['kind']>('all');
  const list = quotes.filter((q) => kind === 'all' || q.kind === kind);
  const tone = (q: Quote) => (q.kind === 'rant' ? 'text-danger' : q.kind === 'praise' ? 'text-success' : 'text-fg-subtle');
  return (
    <>
      <div className="mb-4"><Seg size="sm" value={kind} onChange={setKind} options={[{ value: 'all', label: t('all') }, { value: 'rant', label: <Frown size={14} className="inline" /> }, { value: 'praise', label: <Smile size={14} className="inline" /> }, { value: 'interview', label: t('interview') }]} /></div>
      <div className="columns-1 gap-6 md:columns-2 xl:columns-3">
        {list.map((q, i) => (
          <figure key={`${q.session_id}:${q.step_idx ?? i}:${q.kind}`} className="mb-6 break-inside-avoid">
            {q.screenshot_ev && <Link to="/sessions/$id" params={{ id: q.session_id }} hash={q.step_idx !== undefined ? `s${q.step_idx}` : undefined}><img src={evidenceUrl(q.screenshot_ev)} alt="" loading="lazy" className="mb-3 max-h-40 w-full rounded-md border border-border object-cover object-top" /></Link>}
            {q.q && <p className="mb-1 text-xs text-fg-subtle">{q.q}</p>}
            <blockquote className="leading-relaxed"><span className={`mr-1 font-semibold ${tone(q)}`}>“</span>{q.text}</blockquote>
            <figcaption className="mt-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
              <PersonLink id={q.persona_id} name={names.get(q.persona_id) ?? q.persona_id} size={20} />
              <Link to="/sessions/$id" params={{ id: q.session_id }} hash={q.step_idx !== undefined ? `s${q.step_idx}` : undefined} className="tabular text-fg-subtle hover:text-accent">{q.sim_clock ?? ''}{q.sus != null ? ` SUS ${q.sus.toFixed(0)}` : ''} →</Link>
            </figcaption>
          </figure>
        ))}
      </div>
    </>
  );
}

export function IssueTable({ issues, admin, onChange }: { issues: IssueRow[]; admin: boolean; onChange: () => void }) {
  const { t, lang } = useT(); const L = useLabel();
  const triage = async (id: string, status: string) => { await post(`/issues/${id}/triage`, { status }); onChange(); };
  if (!issues.length) return <p className="text-sm text-fg-subtle">—</p>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {issues.map((i) => (
        <li key={i.id} className="grid grid-cols-[2rem_1fr_auto] items-start gap-3 py-3">
          <Sev s={i.severity} />
          <div className="min-w-0">
            <p className={`text-sm ${i.status === 'rejected' ? 'text-fg-subtle line-through' : 'text-fg-display'}`}>{lang === 'en' && i.title_en ? i.title_en : i.title}</p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-subtle">
              <span>{i.category}</span><span>{t('trust')} {L(i.trust)}</span>{i.segments.length > 0 && <span>{i.segments.map((s) => L(s)).join(' · ')}</span>}<span className="tabular">{t('n_sessions', { n: i.sessions })}</span>{i.seeded_match && <span>≈ {i.seeded_match}</span>}
            </p>
            {i.recommendation && <p className="mt-1.5 text-xs leading-relaxed text-fg-muted">{i.recommendation}</p>}
          </div>
          <div className="flex items-center gap-1">
            <span className={`text-xs ${i.status === 'confirmed' ? 'text-success' : i.status === 'rejected' ? 'text-fg-subtle' : 'text-fg-muted'}`}>{L(i.status)}</span>
            {admin && i.status !== 'confirmed' && <Button size="sm" variant="ghost" aria-label={t('confirm')} title={t('confirm')} onClick={() => void triage(i.id, 'confirmed')}><Check size={14} /></Button>}
            {admin && i.status !== 'rejected' && <Button size="sm" variant="ghost" aria-label={t('reject')} title={t('reject')} onClick={() => void triage(i.id, 'rejected')}><X size={14} /></Button>}
            {admin && i.status !== 'open' && <Button size="sm" variant="ghost" aria-label={t('reopen')} title={t('reopen')} onClick={() => void triage(i.id, 'open')}><RotateCcw size={13} /></Button>}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function AppReportPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useAppReport(id); const people = usePersonas().data; const me = useMe().data;
  const { t } = useT(); const L = useLabel();
  const names = useMemo(() => new Map((people ?? []).map((p) => [p.id, p.name])), [people]);
  const r = q.data;
  const trendOpt = useCallback((tk: ReturnType<typeof import('../components/Chart.tsx').tokens>, s: string[]) => ({
    grid: { left: 36, right: 12, top: 36, bottom: 28 },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: tk.muted } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: tk.subtle } }, backgroundColor: tk.surface, borderColor: tk.border, textStyle: { color: tk.fg } },
    xAxis: { type: 'category', data: (r?.trend ?? []).map((x, i) => `${x.version} #${i + 1}`), axisLine: { lineStyle: { color: tk.border } }, axisTick: { show: false }, axisLabel: { color: tk.subtle } },
    yAxis: { type: 'value', min: 0, max: 100, splitLine: { lineStyle: { color: tk.border } }, axisLabel: { color: tk.subtle } },
    series: [
      { name: 'SUS', type: 'line', data: (r?.trend ?? []).map((x) => (x.sus === null ? null : Math.round(x.sus))), lineStyle: { width: 2, color: s[0] }, itemStyle: { color: s[0] }, symbolSize: 8, connectNulls: true },
      { name: `${t('completion')} %`, type: 'line', data: (r?.trend ?? []).map((x) => (x.completion === null ? null : Math.round(x.completion * 100))), lineStyle: { width: 2, color: s[1] }, itemStyle: { color: s[1] }, symbolSize: 8, connectNulls: true },
    ],
  }), [r, t]);
  const issueOpt = useCallback((tk: ReturnType<typeof import('../components/Chart.tsx').tokens>) => ({
    grid: { left: 36, right: 12, top: 36, bottom: 28 },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: tk.muted } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: tk.surface, borderColor: tk.border, textStyle: { color: tk.fg } },
    xAxis: { type: 'category', data: (r?.trend ?? []).map((x, i) => `${x.version} #${i + 1}`), axisLine: { lineStyle: { color: tk.border } }, axisTick: { show: false }, axisLabel: { color: tk.subtle } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: tk.border } }, axisLabel: { color: tk.subtle } },
    series: (['P0', 'P1', 'P2', 'P3'] as const).map((k, i) => ({ name: k, type: 'bar', stack: 'sev', barMaxWidth: 28, data: (r?.trend ?? []).map((x) => x.issues[k]), itemStyle: { color: [tk.danger, tk.accent, tk.warning, tk.subtle][i], borderColor: tk.surface, borderWidth: 1, borderRadius: i === 3 ? [4, 4, 0, 0] : 0 } })),
  }), [r]);

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!r) return <div className="space-y-4"><Skeleton className="h-10 w-1/3" /><Skeleton className="h-40 w-full" /><Skeleton className="h-64 w-full" /></div>;
  const o = r.overview;
  return (
    <article>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">{r.app.name}</h1>
        <p className="mt-1 max-w-[70ch] text-fg-muted">{r.app.description}</p>
      </header>
      {o.sessions === 0 ? <Empty title={t('empty_sessions')} /> : (
        <>
          <VerdictBlock id={id} r={r} />
          <div className="mt-10 grid grid-cols-2 gap-6 border-y border-border py-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label={t('used_by')} value={o.personas} sub={t('n_people', { n: '' }).trim()} />
            <Stat label={t('sessions')} value={o.sessions} />
            <Stat label={t('completion')} value={pct(o.completion)} />
            <Stat label={t('sus')} value={num(o.sus)} sub="/100" />
            <Stat label={t('again')} value={pct(o.again)} />
            <Stat label={t('satisfaction')} value={num(o.sat, 1)} sub="/7" />
          </div>

          <div className="grid gap-x-12 lg:grid-cols-[18rem_minmax(0,1fr)]">
            <Section title={t('target')}>
              <div className="flex flex-wrap gap-1.5">{r.targets.segments.map((s) => <span key={s} className="chip">{L(s)}</span>)}</div>
              <ul className="mt-6 space-y-2">
                {r.used_by.slice(0, 12).map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                    <PersonLink id={u.id} name={u.name} />
                    <span className="tabular shrink-0 text-xs text-fg-subtle">{u.sessions}× · {pct(u.completion)}{u.sus !== null ? ` · ${u.sus.toFixed(0)}` : ''}</span>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title={t('fit')}><FitChart groups={r.groups} /></Section>
          </div>

          <Section title={t('voices')}><QuoteWall quotes={r.quotes} names={names} /></Section>

          <Section title={t('issues')} aside={<span className="tabular text-xs text-fg-subtle">P0 {o.issues.P0} · P1 {o.issues.P1} · P2 {o.issues.P2} · P3 {o.issues.P3}</span>}>
            <IssueTable issues={r.issues} admin={!!me?.admin} onChange={() => void q.refetch()} />
          </Section>

          {r.trend.length > 0 && (
            <Section title={t('trend')}>
              <div className="grid gap-8 lg:grid-cols-2">
                <Chart label="SUS & completion" option={trendOpt} />
                <Chart label="issues" option={issueOpt} />
              </div>
              <ul className="mt-4 flex flex-wrap gap-2 text-xs">{r.trend.map((x, i) => <li key={x.study_id}><Link to="/studies/$id" params={{ id: x.study_id }} className="chip tabular hover:border-accent hover:text-fg">#{i + 1} {x.version} · {x.sessions}</Link></li>)}</ul>
            </Section>
          )}
          <div className="mt-10 flex flex-wrap gap-2">{r.app.versions.map((v) => <a key={v.id} href={v.url} target="_blank" rel="noreferrer" className="chip hover:border-accent hover:text-fg">{v.version} ↗</a>)}</div>
        </>
      )}
    </article>
  );
}
