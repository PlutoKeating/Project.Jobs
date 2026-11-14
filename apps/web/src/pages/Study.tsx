import { Link, useParams } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useMe, useStudy } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import { ErrorState, PersonLink, Section, Skeleton, Stat } from '../components/ui.tsx';
import { IssueTable } from './AppReport.tsx';

export function StudyPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useStudy(id); const me = useMe().data; const { t } = useT(); const L = useLabel();
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-64 w-full" />;
  const d = q.data; const s = d.study;
  const ok = d.sessions.filter((x) => x.outcome === 'success').length;
  return (
    <article>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/apps/$id" params={{ id: d.app_id }} className="text-sm text-fg-muted hover:text-accent">{d.app} · {d.version}</Link>
          <h1 className="tabular mt-1 text-2xl font-semibold">{s.id}</h1>
          <p className="mt-1 text-sm text-fg-muted">{L(s.status)}{s.stop_reason ? ` · ${s.stop_reason}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {d.report && <><a className="chip hover:border-accent hover:text-fg" href={`/reports/${id}/index.html`} target="_blank" rel="noreferrer"><FileText size={12} />HTML</a><a className="chip hover:border-accent hover:text-fg" href={`/reports/${id}/report.zh.md`} target="_blank" rel="noreferrer">MD 中</a><a className="chip hover:border-accent hover:text-fg" href={`/reports/${id}/report.en.md`} target="_blank" rel="noreferrer">MD EN</a></>}
        </div>
      </header>
      <div className="mt-8 grid grid-cols-2 gap-6 border-y border-border py-5 sm:grid-cols-4">
        <Stat label={t('sessions')} value={d.sessions.length} />
        <Stat label={t('completion')} value={d.sessions.length ? `${Math.round((ok / d.sessions.length) * 100)}%` : '—'} />
        <Stat label="Tokens" value={s.tokens.toLocaleString()} />
        <Stat label={t('cost')} value={`$${s.cost_usd.toFixed(2)}`} />
      </div>
      {s.isolation_warning && <p className="mt-3 text-xs text-warning">{s.isolation_warning}</p>}

      <Section title="Session">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <tbody className="divide-y divide-border border-y border-border">
              {d.sessions.map((x) => (
                <tr key={x.id} className="hover:bg-surface">
                  <td className="py-2.5 pr-3"><PersonLink id={x.persona_id} name={x.persona_name} /></td>
                  <td className="py-2.5 text-xs text-fg-muted">{L(x.world_template_id)} · {L(x.mode)}{x.revisit_day ? ` · D${x.revisit_day}` : ''}{x.is_expert_baseline ? ` · ${L('expert')}` : ''}</td>
                  <td className={`py-2.5 text-xs ${x.outcome === 'success' ? 'text-success' : x.outcome ? 'text-danger' : x.status === 'running' ? 'text-accent' : 'text-fg-muted'}`}>{L(x.outcome ?? x.status)}</td>
                  <td className="tabular py-2.5 text-right text-xs text-fg-subtle">{x.steps_count}</td>
                  <td className="max-w-[18rem] truncate py-2.5 pl-4 text-xs text-fg-subtle">{x.end_reason ?? ''}</td>
                  <td className="py-2.5 text-right"><Link to="/sessions/$id" params={{ id: x.id }} className="text-xs text-link hover:text-accent">{t('timeline')} →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={t('issues')} aside={<span className="tabular text-xs text-fg-subtle">{d.issues.length}</span>}><IssueTable issues={d.issues} admin={!!me?.admin} onChange={() => void q.refetch()} /></Section>
      {d.job && (
        <Section title={t('log')}>
          <pre className="max-h-80 overflow-auto rounded-lg bg-code-bg p-4 font-mono text-xs leading-relaxed text-code-fg">{d.job.log.join('\n')}{d.job.error ? `\n${d.job.error}` : ''}</pre>
        </Section>
      )}
    </article>
  );
}
