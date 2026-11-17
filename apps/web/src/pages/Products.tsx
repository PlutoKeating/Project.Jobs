// 已发布的产品：每一行是它此刻在城里的人数
import { Link } from '@tanstack/react-router';
import { Star } from 'lucide-react';
import { useLaunches, useMe } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { useLiveLaunches } from '../lib/stream.ts';
import type { Funnel, Launch, LaunchLive } from '../lib/types.ts';
import { openPublish } from '../components/Publish.tsx';
import { useUsingNow } from '../lib/live.ts';
import { Avatar, Button, Empty, ErrorState, PageHead, Skeleton } from '../components/ui.tsx';

export const FUNNEL_STEPS = ['reached', 'noticed', 'interested', 'opened', 'came_back'] as const;
export type FunnelNums = Pick<Funnel, (typeof FUNNEL_STEPS)[number] | 'using_now'>;

/** 接口返回的漏斗 + 实时帧里更新的人数 */
export function useLiveFunnel<T extends { id: string; funnel: Funnel; intensity: number; status: string }>(l: T): T {
  const live = useLiveLaunches()?.find((x: LaunchLive) => x.id === l.id);
  return live ? { ...l, funnel: { ...l.funnel, reached: live.reached, noticed: live.noticed, interested: live.interested, opened: live.opened, came_back: live.came_back, using_now: live.using_now, rating: live.rating, reviews: live.reviews } } : l;
}

function Row({ launch }: { launch: Launch }) {
  const { t } = useT();
  const l = useLiveFunnel(launch); const f = l.funnel; const who = useUsingNow(l.app_id);
  return (
    <li className="border-t border-border">
      <Link to="/products/$id" params={{ id: l.id }} className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 py-4 md:grid-cols-[minmax(0,1fr)_repeat(5,4.75rem)_4rem]">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-fg-display group-hover:text-accent">{l.name}</span>
            {who.length > 0 && <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-accent" title={who.map((p) => p.name).join('、')}><span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />{t('using_n', { n: who.length })}<span className="hidden -space-x-1.5 sm:flex">{who.slice(0, 5).map((p) => <Avatar key={p.id} id={p.id} size={18} className="ring-2 ring-bg" />)}</span></span>}
            {l.status !== 'live' && <span className="chip shrink-0">{t(l.status === 'paused' ? 'st_paused' : 'st_ended')}</span>}
          </span>
          <span className="mt-0.5 block truncate text-sm text-fg-muted">{l.tagline}</span>
        </span>
        {FUNNEL_STEPS.map((k) => <span key={k} className={`tabular hidden text-right text-base md:block ${f[k] ? 'text-fg-display' : 'text-fg-subtle'}`}>{f[k]}</span>)}
        <span className="tabular hidden items-center justify-end gap-1 text-sm text-fg-muted md:flex">{f.rating ? <><Star size={12} className="text-fg-subtle" />{f.rating.toFixed(1)}</> : '—'}</span>
        <span className="tabular text-right text-sm text-fg-muted md:hidden"><span className="text-base text-fg-display">{f.opened}</span> / {f.reached}</span>
      </Link>
    </li>
  );
}

export function ProductsPage() {
  const q = useLaunches(); const { t } = useT(); const me = useMe().data;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <div>
      <PageHead title={t('nav.products')} aside={<span className="chip" title={t('simulated_hint')}>{t('simulated')}</span>} />
      {!q.data ? <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
        : !q.data.length ? <Empty title={t('no_products')} action={me?.admin && <Button onClick={openPublish}>{t('publish')}</Button>} />
        : (
          <div>
            <div className="hidden grid-cols-[minmax(0,1fr)_repeat(5,4.75rem)_4rem] gap-x-6 pb-2 text-right text-xs text-fg-subtle md:grid">
              <span />{FUNNEL_STEPS.map((k) => <span key={k}>{t(`f_${k}`)}</span>)}<span>{t('rating')}</span>
            </div>
            <ul className="border-b border-border">{q.data.map((l) => <Row key={l.id} launch={l} />)}</ul>
          </div>
        )}
    </div>
  );
}
