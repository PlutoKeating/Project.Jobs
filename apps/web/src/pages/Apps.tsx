import { Link } from '@tanstack/react-router';
import { useApps } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { ErrorState, PageHead, pct, Skeleton } from '../components/ui.tsx';

export function AppsPage() {
  const { t } = useT();
  const q = useApps();
  const list = [...(q.data ?? [])].sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));
  return (
    <>
      <PageHead title={t('nav.apps')} />
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead><tr className="text-left text-xs text-fg-subtle"><th className="pb-3 font-normal">{t('app')}</th><th className="pb-3 text-right font-normal">{t('used_by')}</th><th className="pb-3 text-right font-normal">{t('sessions')}</th><th className="w-48 pb-3 pl-6 font-normal">{t('completion')}</th><th className="pb-3 text-right font-normal">{t('sus')}</th><th className="pb-3 text-right font-normal">P0 / P1</th></tr></thead>
            <tbody className="divide-y divide-border border-t border-border">
              {q.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={6} className="py-3"><Skeleton className="h-6 w-full" /></td></tr>)}
              {list.map((a) => (
                <tr key={a.id} className={`group transition-colors hover:bg-surface ${a.sessions ? '' : 'text-fg-subtle'}`}>
                  <td className="py-3 pr-4">
                    <Link to="/apps/$id" params={{ id: a.id }} className="block">
                      <span className={`font-medium ${a.sessions ? 'text-fg-display' : ''} group-hover:text-accent`}>{a.name}</span>
                      <span className="block max-w-[34rem] truncate text-xs text-fg-muted">{a.description}</span>
                    </Link>
                  </td>
                  <td className="tabular py-3 text-right">{a.personas || '—'}</td>
                  <td className="tabular py-3 text-right">{a.sessions || '—'}</td>
                  <td className="py-3 pl-6">{a.completion !== null && <span className="flex items-center gap-2"><span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border"><span className="absolute inset-y-0 left-0 rounded-full bg-fg-muted" style={{ width: pct(a.completion) }} /></span><span className="tabular w-9 text-right text-xs">{pct(a.completion)}</span></span>}</td>
                  <td className="tabular py-3 text-right">{a.sus === null ? '—' : a.sus.toFixed(0)}</td>
                  <td className="tabular py-3 text-right">{a.issues.total ? <><span className={a.issues.P0 ? 'text-danger' : ''}>{a.issues.P0}</span> / {a.issues.P1}</> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
