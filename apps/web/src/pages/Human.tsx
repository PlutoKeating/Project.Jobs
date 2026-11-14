import { Link } from '@tanstack/react-router';
import { Check, Hand, MonitorPlay } from 'lucide-react';
import { post, useHuman, useMe } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import { Button, Empty, ErrorState, PageHead, Skeleton } from '../components/ui.tsx';

export function HumanPage() {
  const { t } = useT(); const L = useLabel(); const q = useHuman(); const me = useMe().data;
  const pending = (q.data ?? []).filter((x) => x.status === 'pending');
  const rest = (q.data ?? []).filter((x) => x.status !== 'pending');
  return (
    <>
      <PageHead title={t('nav.human')} />
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : q.isLoading ? <Skeleton className="h-40 w-full" /> : (
        <>
          {pending.length === 0 ? <Empty icon={<Hand size={28} />} title={t('no_tasks')} /> : (
            <ul className="space-y-3">
              {pending.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-accent/50 bg-accent-glow-faint px-5 py-4">
                  <span className="h-2 w-2 rounded-full bg-accent live-dot" />
                  <div className="min-w-0 flex-1"><p className="font-medium text-fg-display">{x.reason}</p><p className="truncate text-xs text-fg-muted">{x.url}</p></div>
                  {x.cdp_url && <a href={x.cdp_url} target="_blank" rel="noreferrer"><Button variant="primary"><MonitorPlay size={14} />{t('takeover')}</Button></a>}
                  {me?.admin && <Button onClick={async () => { await post(`/human/${x.id}/resolve`); await q.refetch(); }}><Check size={14} />{t('resolved')}</Button>}
                  <Link to="/sessions/$id" params={{ id: x.session_id }} className="text-xs text-link hover:text-accent">Session →</Link>
                </li>
              ))}
            </ul>
          )}
          {rest.length > 0 && (
            <table className="mt-10 w-full text-sm">
              <tbody className="divide-y divide-border border-y border-border">
                {rest.map((x) => <tr key={x.id}><td className="tabular py-2.5 text-xs text-fg-subtle">{new Date(x.created_at).toLocaleString()}</td><td className="py-2.5">{x.reason}</td><td className="py-2.5 text-xs text-fg-muted">{L(x.status)}</td><td className="py-2.5 text-right"><Link to="/sessions/$id" params={{ id: x.session_id }} className="text-xs text-link hover:text-accent">Session →</Link></td></tr>)}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
