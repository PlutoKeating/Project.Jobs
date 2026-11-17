// 「此刻在用」只有一个定义：使用已经开始、还没结束（running，或卡在需要人介入的地方）。排队（planned）不算，回放不算
import { useMemo } from 'react';
import { useSnapshot } from './stream.ts';
import type { PersonaLive, TownLayout } from './types.ts';

export const USING = new Set(['running', 'waiting_human']);
export const isUsing = (status: string | undefined) => !!status && USING.has(status);
export const isQueued = (status: string | undefined) => status === 'planned';
/** 城里这个人此刻是不是正拿着某个产品在用 */
export const usingNow = (p: PersonaLive) => !!p.session && !p.session.replay && isUsing(p.session.status);

/** 此刻正在用某个产品（按 app_id）的人；不给 appId 时是此刻在用任何产品的人 */
export function useUsingNow(appId?: string): PersonaLive[] {
  const snap = useSnapshot();
  return useMemo(() => (snap?.personas ?? []).filter((p) => usingNow(p) && (!appId || p.session!.app_id === appId))
    .sort((a, b) => a.name.localeCompare(b.name)), [snap, appId]);
}

/** 地点 id → 名字（城的布局里查；street 是「街上」） */
export const placeName = (town: TownLayout | undefined, id: string | undefined, lang: string) => {
  if (!id) return '';
  const p = town?.places.find((x) => x.id === id);
  return p ? (lang === 'zh' ? p.name.zh : p.name.en) : id === 'street' ? (lang === 'zh' ? '街上' : 'Street') : id;
};
