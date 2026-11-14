import { useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowRight, Check, Timer, Globe2, MapPin, Send, X, Zap } from 'lucide-react';
import { evidenceUrl, post, useSession } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import type { StepRow } from '../lib/types.ts';
import { Avatar, Button, ErrorState, Section, Skeleton, Stat } from '../components/ui.tsx';

const moodColor = (m: number) => (m < -0.15 ? `color-mix(in srgb, var(--color-danger) ${Math.min(100, 35 + -m * 80)}%, var(--color-surface))` : m > 0.15 ? `color-mix(in srgb, var(--color-success) ${Math.min(100, 35 + m * 80)}%, var(--color-surface))` : 'var(--color-border-strong)');

function MoodStrip({ steps }: { steps: StepRow[] }) {
  return (
    <div className="flex h-6 gap-[2px]" role="list">
      {steps.map((s) => {
        const m = Number((s.dynamic_state as { mood?: number } | null)?.mood ?? 0);
        return <a key={s.idx} role="listitem" href={`#s${s.idx}`} title={`#${s.idx + 1} ${s.sim_clock ?? ''} · mood ${m.toFixed(2)}`} className="relative flex-1 rounded-[3px] transition-transform hover:-translate-y-0.5" style={{ background: moodColor(m) }}>{s.expectation_violated && <span className="absolute -top-1.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-danger" />}</a>;
      })}
    </div>
  );
}

function Step({ s, events }: { s: StepRow; events: { text: string; source: string }[] }) {
  const { t } = useT(); const L = useLabel();
  const err = s.result?.error;
  return (
    <li id={`s${s.idx}`} className="grid scroll-mt-24 gap-5 border-t border-border py-6 md:grid-cols-[minmax(0,22rem)_1fr]">
      <div>{s.screenshot_ev ? <a href={evidenceUrl(s.screenshot_ev)} target="_blank" rel="noreferrer"><img src={evidenceUrl(s.screenshot_ev)} alt="" loading="lazy" className="w-full rounded-md border border-border object-cover object-top transition-opacity hover:opacity-90" /></a> : <div className="aspect-video rounded-md bg-surface" />}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
          <span className="tabular font-medium text-fg-display">#{s.idx + 1}</span><span className="tabular">{s.sim_clock}</span>
          {s.place && <span className="inline-flex items-center gap-1"><MapPin size={11} />{s.place}</span>}
          {s.resources?.battery_pct !== undefined && <span className="tabular">{Math.round(s.resources.battery_pct)}%</span>}
          {s.url && <span className="max-w-[20rem] truncate">{s.url}</span>}
        </div>
        {events.map((e, i) => <p key={i} className="mt-2 flex items-start gap-1.5 text-sm text-secondary-fg"><Globe2 size={14} className="mt-0.5 shrink-0" />{e.text}</p>)}
        {s.monologue && <p className={`mt-3 text-[15px] leading-relaxed ${s.expectation_violated ? 'text-danger' : 'text-fg-display'}`}>“{s.monologue}”</p>}
        {(s.intent || s.action?.verb) && (
          <p className="mt-3 flex items-start gap-1.5 text-sm text-fg-muted"><ArrowRight size={14} className="mt-0.5 shrink-0" /><span>{s.intent || s.action?.operator?.target_description}{s.action?.operator?.text ? <span className="text-fg"> 「{s.action.operator.text}」</span> : null}</span></p>
        )}
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          <span>{L(s.action?.verb ?? s.decision)}</span>
          {s.result?.status && <span className={s.result.status === 'success' ? 'text-success' : ''}>· {L(s.result.status)}</span>}
          {err && <span className="text-danger">· {err.code}</span>}
          {s.expectation_violated && <span className="inline-flex items-center gap-1 text-danger"><Zap size={11} />{t('expectation_broken')}</span>}
        </p>
        {s.expectation_violated && s.expectation && <p className="mt-1 text-xs text-fg-subtle line-through decoration-danger/60">{s.expectation}</p>}
      </div>
    </li>
  );
}

export function SessionPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useSession(id); const { t } = useT(); const L = useLabel(); const nav = useNavigate();
  const [ask, setAsk] = useState(''); const [busy, setBusy] = useState(false);
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const d = q.data; const s = d.session;
  const post0 = d.interviews.find((i) => i.kind === 'post_session');
  const qa = d.interviews.flatMap((i) => i.qa);
  const judgeKeys = [...new Set(d.judgments.flatMap((j) => Object.keys(j.scores)))];
  const finished = !['running', 'waiting_human', 'planned'].includes(s.status);

  return (
    <article>
      <header className="flex flex-wrap items-start gap-5">
        {d.persona && <Link to="/people/$id" params={{ id: d.persona.id }}><Avatar id={d.persona.id} size={72} className="!rounded-xl" /></Link>}
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">{d.persona && <Link to="/people/$id" params={{ id: d.persona.id }} className="hover:text-accent">{d.persona.name}</Link>} · {d.persona?.occupation}</p>
          <h1 className="mt-1 text-2xl font-semibold">{d.app ? <Link to="/apps/$id" params={{ id: d.app.app_id }} className="hover:text-accent">{d.app.app}</Link> : '—'} <span className="text-fg-subtle">{d.app?.version}</span></h1>
          <p className="mt-1 text-sm text-fg-muted">{L(s.world_template_id)} · {L(s.mode)}{s.revisit_day ? ` · D${s.revisit_day}` : ''} · <span className={s.outcome === 'success' ? 'text-success' : s.outcome ? 'text-danger' : 'text-accent'}>{L(s.outcome ?? s.status)}</span></p>
          {s.end_reason && <p className="mt-1 max-w-[70ch] text-xs text-fg-subtle">{s.end_reason}</p>}
        </div>
        <div className="flex gap-2">
          <Button onClick={async () => { const r = await post<{ persona_id: string }>('/world/replay', { session_id: id, speed: 1 }); void nav({ to: '/', search: { focus: r.persona_id } }); }}><Globe2 size={14} />{t('replay')}</Button>
        </div>
      </header>

      <div className="mt-8 flex flex-wrap gap-x-12 gap-y-4 border-y border-border py-5">
        <Stat label={t('steps')} value={s.steps_count} />
        {post0?.questionnaire?.sus_score_simulated !== undefined && <Stat label="SUS" value={post0.questionnaire.sus_score_simulated.toFixed(0)} sub={t('simulated')} />}
        {post0?.questionnaire?.umux_lite_simulated !== undefined && <Stat label="UMUX-Lite" value={post0.questionnaire.umux_lite_simulated.toFixed(0)} />}
        {post0?.questionnaire?.would_use_again !== undefined && <Stat label={t('again')} value={post0.questionnaire.would_use_again ? <Check size={20} className="text-success" /> : <X size={20} className="text-danger" />} />}
        {s.summary?.objective?.real_seconds !== undefined && <Stat label={<Timer size={13} aria-label="time" />} value={`${Math.round(s.summary.objective.real_seconds / 60)}′`} />}
      </div>
      {d.steps.length > 0 && <div className="mt-6"><MoodStrip steps={d.steps} /></div>}

      <div className="grid gap-x-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Section title={t('timeline')}>
          {s.video_ev && <video controls preload="metadata" poster={d.steps.find((x) => x.screenshot_ev)?.screenshot_ev ? evidenceUrl(d.steps.find((x) => x.screenshot_ev)!.screenshot_ev!) : undefined} src={evidenceUrl(s.video_ev)} className="mb-6 max-h-[420px] w-full rounded-lg border border-border bg-bg-elevated object-contain" />}
          <ol>{d.steps.map((x) => <Step key={x.idx} s={x} events={d.events.filter((e) => e.step_idx === x.idx)} />)}</ol>
        </Section>
        <aside className="min-w-0">
          <Section title={t('interview')}>
            <div className="space-y-5 xl:max-h-[70vh] xl:overflow-y-auto xl:pr-2">
              {qa.map((x, i) => <div key={i}><p className="text-xs text-fg-subtle">{x.q}</p><p className="mt-1 text-sm leading-relaxed">{x.a}</p></div>)}
            </div>
            {finished && (
              <form className="mt-5 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!ask.trim()) return; setBusy(true); try { await post(`/sessions/${id}/ask`, { q: ask }); setAsk(''); await q.refetch(); } finally { setBusy(false); } }}>
                <input className="field h-9" placeholder={t('ask_placeholder')} value={ask} onChange={(e) => setAsk(e.target.value)} />
                <Button disabled={busy || !ask.trim()} aria-label={t('ask')}><Send size={14} className={busy ? 'live-dot' : ''} /></Button>
              </form>
            )}
          </Section>
          {d.judgments.length > 0 && (
            <Section title={t('judges')}>
              <table className="w-full text-xs">
                <thead><tr className="text-fg-subtle"><th className="pb-2 text-left font-normal" />{d.judgments.map((j) => <th key={j.id} className="pb-2 text-right font-normal">{j.evaluator_role.replace('judge_', 'J')}{j.phase === 'with_monologue' ? '′' : ''}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">{judgeKeys.map((k) => <tr key={k}><td className="py-1.5 text-fg-muted">{k}</td>{d.judgments.map((j) => <td key={j.id} className="tabular py-1.5 text-right">{j.scores[k] ?? '—'}</td>)}</tr>)}</tbody>
              </table>
            </Section>
          )}
        </aside>
      </div>
    </article>
  );
}
