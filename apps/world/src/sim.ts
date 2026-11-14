// 人物位置模拟（规则驱动，不调用模型）：日程 → 地点 → 落脚点；通勤段在地铁隧道或街道上移动
import type { PersonaSpec } from '@pux/core';
import { agendaAt, hashNum, matchPlaceKind, placeForKind, toMin, type Agenda, type PersonaLive, type SessionLive, type Spot, type Town, type TownLayout } from '@pux/jobsworld';

export interface Target { place_id: string; place_kind: string; x: number; y: number; floor: number; pose: PersonaLive['pose']; mode: PersonaLive['mode'] }

export class Placement {
  private spotsByPlace = new Map<string, Spot[]>();
  constructor(readonly layout: TownLayout, readonly town: Town) {
    for (const s of layout.spots) { const a = this.spotsByPlace.get(s.place_id) ?? []; a.push(s); this.spotsByPlace.set(s.place_id, a); }
  }
  place(id: string) { return this.layout.places.find((p) => p.id === id); }
  centerX(placeId: string) { const p = this.place(placeId); return p ? p.x + Math.floor(p.w / 2) : this.layout.width / 2; }

  spot(placeId: string, seed: string, filter?: (s: Spot) => boolean): Spot | undefined {
    const all = this.spotsByPlace.get(placeId) ?? [];
    const c = filter ? all.filter(filter) : all;
    const list = c.length ? c : all;
    return list.length ? list[hashNum(seed) % list.length] : undefined;
  }

  homeSpot(a: Agenda): Spot | undefined { return this.layout.spots.find((s) => s.unit === a.home_unit) ?? this.spot(a.home_place_id, String(a.home_unit)); }

  /** 正在使用软件：放到 Session 世界模板对应的地点 */
  forSession(p: PersonaSpec, a: Agenda, s: SessionLive): Target {
    const kind = matchPlaceKind(this.town, s.world_place);
    if (kind === 'home') { const h = this.homeSpot(a); if (h) return { place_id: a.home_place_id, place_kind: 'home', x: h.x, y: h.y, floor: h.floor, pose: /床|bed/i.test(s.world_place ?? '') ? 'lie' : /沙发|sofa|couch/i.test(s.world_place ?? '') ? 'sit' : 'stand', mode: s.replay ? 'replay' : 'session' }; }
    if (kind === 'road' || kind === 'street') {
      const x = (hashNum(s.id) % (this.layout.width - 40)) + 20;
      return { place_id: 'street', place_kind: kind, x, y: 0, floor: 0, pose: kind === 'road' ? 'ride' : 'walk', mode: s.replay ? 'replay' : 'session' };
    }
    const placeId = placeForKind(this.layout, kind, p.id);
    const inCar = kind === 'subway' && /车厢|train|carriage/i.test(s.world_place ?? '');
    const sp = this.spot(placeId, `${p.id}:${s.id}`, kind === 'subway' ? (x) => x.floor === (inCar ? -2 : -1) : undefined);
    return { place_id: placeId, place_kind: kind, x: sp?.x ?? this.centerX(placeId), y: sp?.y ?? 0, floor: sp?.floor ?? 0, pose: sp?.pose ?? 'stand', mode: s.replay ? 'replay' : 'session' };
  }

  /** 合并世界里正在使用产品的人：就在他处境里的那个地点 */
  forPlace(p: PersonaSpec, a: Agenda, placeId: string, placeKind: string, seed: string): Target {
    if (placeKind === 'home') { const h = this.homeSpot(a); return { place_id: a.home_place_id, place_kind: 'home', x: h?.x ?? 0, y: h?.y ?? 0, floor: h?.floor ?? 0, pose: 'sit', mode: 'session' }; }
    if (placeId === 'street' || placeKind === 'road' || placeKind === 'street') { const x = (hashNum(seed) % (this.layout.width - 40)) + 20; return { place_id: 'street', place_kind: placeKind, x, y: 0, floor: 0, pose: placeKind === 'road' ? 'ride' : 'stand', mode: 'session' }; }
    const sp = this.spot(placeId, `${p.id}:${seed}`, placeKind === 'subway' ? (x) => x.floor < 0 : undefined);
    return { place_id: placeId, place_kind: placeKind, x: sp?.x ?? this.centerX(placeId), y: sp?.y ?? 0, floor: sp?.floor ?? 0, pose: sp?.pose ?? 'stand', mode: 'session' };
  }

  /** 按日程：通勤段在路上移动，其余在地点内的落脚点（每 20 模拟分钟换一个位置） */
  forAgenda(p: PersonaSpec, a: Agenda, minute: number): Target & { idx: number } {
    const at = agendaAt(a, minute);
    const it = at.current ?? a.items[0];
    if (it.place_kind === 'subway' || it.place_kind === 'road') {
      const from = at.prev?.place_id ?? a.home_place_id; const to = at.next?.place_id ?? a.home_place_id;
      const t0 = toMin(it.from); const t1 = toMin(it.to); const k = Math.min(1, Math.max(0, (minute - t0) / Math.max(1, t1 - t0)));
      const x0 = this.centerX(from); const x1 = this.centerX(to);
      const x = Math.round(x0 + (x1 - x0) * k);
      const under = it.place_kind === 'subway' && k > 0.15 && k < 0.85;
      const y = under ? this.layout.subway_line.y + this.layout.subway_line.h : 0;
      return { idx: at.idx, place_id: under ? 'subway' : 'street', place_kind: it.place_kind, x, y, floor: under ? -2 : 0, pose: under || it.place_kind === 'road' ? 'ride' : 'walk', mode: 'travel' };
    }
    const sleeping = (it.kind === 'sleep' || /睡|sleep/i.test(it.activity)) && it.place_kind === 'home';
    if (it.place_kind === 'home') {
      const h = this.homeSpot(a);
      const wobble = sleeping ? 0 : ((hashNum(`${p.id}:${Math.floor(minute / 20)}`) % 7) - 3);
      return { idx: at.idx, place_id: a.home_place_id, place_kind: 'home', x: (h?.x ?? 0) + wobble, y: h?.y ?? 0, floor: h?.floor ?? 0, pose: sleeping ? 'lie' : 'stand', mode: 'idle' };
    }
    const sp = this.spot(it.place_id, `${p.id}:${at.idx}:${Math.floor(minute / 20)}`);
    return { idx: at.idx, place_id: it.place_id, place_kind: it.place_kind, x: sp?.x ?? this.centerX(it.place_id), y: sp?.y ?? 0, floor: sp?.floor ?? 0, pose: sp?.pose ?? 'stand', mode: 'idle' };
  }
}

/** 头顶气泡语气 */
export function toneOf(s: SessionLive): NonNullable<PersonaLive['say']>['tone'] {
  const mood = s.mood ?? 0; const stress = s.stress ?? 0;
  if (s.expectation_violated || mood < -0.25) return stress > 0.5 || mood < -0.5 ? 'angry' : 'confused';
  if (mood > 0.3 || s.decision === 'done') return 'happy';
  return 'neutral';
}

export const shorten = (t: string, n = 56) => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

/** 世界事件发生时，地点里的人的即时反应（规则，不调模型） */
export const REACTIONS: Record<string, { zh: string[]; en: string[] }> = {
  weak_network: { zh: ['信号怎么又没了…', '转圈转半天了', '这破网'], en: ['No signal again…', 'Still loading…', 'Ugh, this network'] },
  crowd: { zh: ['人太多了，挤死了', '手机都拿不稳'], en: ['So crowded', 'Can barely hold my phone'] },
  rain: { zh: ['下雨了，没带伞', '先躲一下雨'], en: ['It’s raining, no umbrella', 'Waiting out the rain'] },
  power_cut: { zh: ['停电了？', '电量不多了，得省着用'], en: ['Power cut?', 'Battery’s low, need to save it'] },
  noise: { zh: ['好吵，听不清', '这也太吵了'], en: ['Too loud, can’t hear', 'So noisy here'] },
};
