// 此刻正在用某个产品的人：一行一个人，带此刻的屏幕、在想什么、第几步；点开直接看这次使用（进行中会自己往下走）
import { Link } from '@tanstack/react-router';
import { ArrowRight, Hand } from 'lucide-react';
import { evidenceUrl, useTown } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { placeName } from '../lib/live.ts';
import type { PersonaLive } from '../lib/types.ts';
import { Avatar } from './ui.tsx';

export function UsingRow({ p, shot = true, onPick }: { p: PersonaLive; shot?: boolean; onPick?: (id: string) => void }) {
  const { t, lang } = useT(); const town = useTown().data;
  const s = p.session!;
  const stuck = s.status === 'waiting_human';
  const meta = [placeName(town, p.place_id, lang), t('step', { n: s.step_idx + 1 }), s.sim_clock].filter(Boolean).join(' · ');
  const body = (
    <>
      {shot && (s.screenshot_ev
        ? <img src={evidenceUrl(s.screenshot_ev)} alt="" loading="lazy" className="aspect-[4/3] w-24 rounded-xs border border-border bg-bg object-cover object-top sm:w-28" />
        : <span className="aspect-[4/3] w-24 rounded-xs bg-surface sm:w-28" />)}
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <Avatar id={p.id} size={22} />
          <span className="truncate text-sm font-medium text-fg-display group-hover:text-accent">{p.name}</span>
          {stuck && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-warning"><Hand size={11} />{t('needs_you')}</span>}
        </span>
        <span className="tabular mt-0.5 block truncate text-xs text-fg-subtle">{p.age} · {p.occupation}{meta && ` · ${meta}`}</span>
        {s.monologue && <span className={`mt-1 line-clamp-2 block text-sm leading-snug ${s.expectation_violated || (s.mood ?? 0) < -0.3 ? 'text-danger' : 'text-fg-muted'}`}>“{s.monologue}”</span>}
      </span>
      <ArrowRight size={14} className="mt-0.5 text-fg-subtle group-hover:text-accent" />
    </>
  );
  const cls = `group grid w-full items-start gap-3 py-3 text-left transition-colors hover:bg-surface-hover ${shot ? 'grid-cols-[auto_minmax(0,1fr)_auto] px-3' : 'grid-cols-[minmax(0,1fr)_auto] px-5'}`;
  return <li className="border-t border-border first:border-t-0">{onPick
    ? <button type="button" onClick={() => onPick(p.id)} className={cls}>{body}</button>
    : <Link to="/sessions/$id" params={{ id: s.id }} className={cls}>{body}</Link>}</li>;
}

/** 产品页顶上的「此刻在用」：在用的人一览；没人在用时一行说清楚，排队的人只给个数 */
export function UsingNowPanel({ people, queued, status }: { people: PersonaLive[]; queued: number; status: string }) {
  const { t } = useT();
  return (
    <section id="now" className="scroll-mt-24 rounded-lg border border-border bg-bg-elevated">
      <header className="flex items-center justify-between gap-3 px-3 py-2.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className={`h-1.5 w-1.5 rounded-full ${people.length ? 'bg-accent live-dot' : 'bg-border-strong'}`} />
          {t('using_now_title')}<span className="tabular font-normal text-fg-muted">{people.length}</span>
        </h2>
        {queued > 0 && <span className="tabular text-xs text-fg-subtle" title={t('queued_hint')}>{t('queued_n', { n: queued })}</span>}
      </header>
      {people.length
        ? <ul className="border-t border-border">{people.map((p) => <UsingRow key={p.id} p={p} />)}</ul>
        : <p className="border-t border-border px-3 py-3 text-sm text-fg-subtle">{status === 'live' ? t('nobody_using_this') : t(status === 'paused' ? 'st_paused' : 'st_ended')}</p>}
    </section>
  );
}
