// 人作为有生理本能、有社会需求的生物：需求由规则推进，并且真的驱动行为（纯计算，不调用模型）。
// 世界服务用它推进每个人的状态；引擎用同一套函数算出「这个人此时此地的处境」，作为他使用产品时的上下文。
import type { PersonaSpec } from '@pux/core';
import type { AgendaItemRow, NeedsRow } from '@pux/db';
import type { PlaceKindT } from './town.ts';

/** 这段时间在做哪一类事 */
export type ActKind = 'sleep' | 'routine' | 'commute' | 'work' | 'study' | 'meal' | 'errand' | 'care' | 'leisure' | 'phone' | 'rest';
export const ACT_KINDS: ActKind[] = ['sleep', 'routine', 'commute', 'work', 'study', 'meal', 'errand', 'care', 'leisure', 'phone', 'rest'];
export type Needs = Omit<NeedsRow, 'at'>;

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));

/** 世界分钟：自 2026-01-01 00:00 起的分钟数（本地日历日 + 当日分钟） */
export const EPOCH = Date.UTC(2026, 0, 1);
export const dayIndex = (date: string) => Math.round((Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) - EPOCH) / 86_400_000);
export const absMinute = (date: string, minute: number) => dayIndex(date) * 1440 + Math.floor(minute);
export const dateOfAbs = (abs: number) => { const d = new Date(EPOCH + Math.floor(abs / 1440) * 86_400_000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };

export function initialNeeds(p: PersonaSpec, at: number): NeedsRow {
  const s = p.state_defaults;
  return { hunger: s.hunger, energy: clamp(1 - s.fatigue), social: 0.6, stress: s.stress, mood: s.mood, at };
}

/** 每分钟的需求变化率，随正在做的事而不同 */
export function needRates(kind: ActKind, o: { companions: number; placeKind?: string }): { hunger: number; energy: number; social: number; stress: number } {
  const withPeople = o.companions > 0;
  // 一天的量级：睡一晚回满精力；清醒 16 小时、其中上班 8 小时后，睡前还剩两成多
  const base = { hunger: 1 / 300, energy: -1 / 1400, social: withPeople ? 1 / 240 : -1 / 720, stress: 0 };
  switch (kind) {
    case 'sleep': return { hunger: 1 / 900, energy: 1 / 420, social: 0, stress: -1 / 300 };
    case 'routine': return { ...base, hunger: -1 / 80 };                 // 起床收拾、做家务的时候顺便吃了东西
    case 'work': return { ...base, energy: -1 / 1100, social: withPeople ? 1 / 600 : -1 / 900, stress: 1 / 900 };
    case 'study': return { ...base, energy: -1 / 1150, stress: 1 / 1200 };
    case 'commute': return { ...base, energy: -1 / 1200, stress: o.placeKind === 'subway' ? 1 / 500 : 1 / 800 };
    case 'meal': return { hunger: -1 / 25, energy: 1 / 1500, social: withPeople ? 1 / 120 : -1 / 900, stress: -1 / 400 };
    case 'care': return { ...base, energy: -1 / 1000, social: 1 / 300, stress: 1 / 1000 };
    case 'leisure': return { ...base, social: withPeople ? 1 / 150 : -1 / 900, stress: -1 / 240 };
    case 'phone': return { ...base, energy: -1 / 1600, social: 1 / 900, stress: -1 / 500 };
    case 'rest': return { ...base, energy: 1 / 900, stress: -1 / 300 };
    case 'errand': return { ...base, energy: -1 / 1200, stress: 1 / 2000 };
    default: return base;
  }
}

/** 需求推进：饿、累、孤单、压力按规则变化；心情跟着它们走，并慢慢回到这个人平常的水平 */
export function tickNeeds(n: NeedsRow, minutes: number, kind: ActKind, p: PersonaSpec, o: { companions: number; placeKind?: string }): NeedsRow {
  if (minutes <= 0) return n;
  const r = needRates(kind, o); const N = p.psychology.ocean.N; const E = p.psychology.ocean.E;
  const hunger = clamp(n.hunger + r.hunger * minutes);
  const energy = clamp(n.energy + r.energy * minutes);
  const social = clamp(n.social + r.social * minutes * (r.social < 0 ? 0.5 + E : 1));      // 外向的人更容易觉得孤单
  const stress = clamp(n.stress + r.stress * minutes * (r.stress > 0 ? 0.6 + N * 0.8 : 1));
  const target = clamp(p.state_defaults.mood - (hunger > 0.75 ? 0.25 : 0) - (energy < 0.25 ? 0.25 : 0) - (social < 0.2 ? 0.15 : 0) - Math.max(0, stress - 0.5) * 0.6, -1, 1);
  const mood = clamp(n.mood + (target - n.mood) * Math.min(1, minutes / 90), -1, 1);
  return { hunger, energy, social, stress, mood, at: n.at + minutes };
}

export type Override = { kind: ActKind; place_kind: PlaceKindT | 'here'; minutes: number; activity: { zh: string; en: string }; reason: 'hungry' | 'exhausted' | 'lonely'; cost?: number };

/**
 * 需求驱动的行为：饿极了去吃东西，困得不行提前睡，太久没跟人说话就找人聊——日程不是铁板一块。
 * 返回要临时插入的活动；没有需要处理的需求时返回 undefined。
 */
export function needOverride(n: Needs, cur: { kind: ActKind; place_kind: string; minuteOfDay: number; minutesToNextMeal: number }, o: { wallet: number; mealCost: number; tight: boolean }): Override | undefined {
  const flexible = ['work', 'study', 'leisure', 'errand', 'phone', 'rest', 'routine'].includes(cur.kind);
  if (n.hunger > 0.85 && flexible && cur.minutesToNextMeal > 45) {
    const atHome = cur.place_kind === 'home';
    const canPay = o.wallet >= o.mealCost && !o.tight;
    if (atHome || !canPay) return { kind: 'meal', place_kind: atHome ? 'here' : 'shop', minutes: 15, activity: atHome ? { zh: '饿了，在家随便吃点', en: 'Hungry — grabbing a bite at home' } : { zh: '饿了，买个面包垫一垫', en: 'Hungry — buying a cheap snack' }, reason: 'hungry', cost: atHome ? o.mealCost * 0.3 : o.mealCost * 0.35 };
    return { kind: 'meal', place_kind: 'restaurant', minutes: 25, activity: { zh: '饿得不行，先去吃点东西', en: 'Starving — going to get food first' }, reason: 'hungry', cost: o.mealCost };
  }
  if (n.energy < 0.12 && cur.kind !== 'sleep') {
    if (cur.minuteOfDay >= 21 * 60 || cur.minuteOfDay < 5 * 60) return { kind: 'sleep', place_kind: 'home', minutes: 24 * 60, activity: { zh: '太累了，提前睡了', en: 'Exhausted — went to bed early' }, reason: 'exhausted' };
    if (['leisure', 'phone', 'rest', 'errand'].includes(cur.kind)) return { kind: 'rest', place_kind: 'here', minutes: 30, activity: { zh: '累得不想动，歇一会儿', en: 'Worn out — resting for a bit' }, reason: 'exhausted' };
  }
  if (n.social < 0.12 && ['leisure', 'rest', 'routine'].includes(cur.kind)) return { kind: 'phone', place_kind: 'here', minutes: 20, activity: { zh: '有点闷，找人聊聊天', en: 'Feeling lonely — messaging someone' }, reason: 'lonely' };
  return undefined;
}

/** 这个时候手机（或电脑）在不在手边、有没有空看：0 完全没空，1 正拿着刷 */
export function phoneAffinity(kind: ActKind, placeKind: string, p: PersonaSpec, driving = false): number {
  if (kind === 'sleep' || driving) return 0;
  const age = p.identity.age;
  if (p.kind === 'child' || age < 14) return ['leisure', 'phone', 'rest'].includes(kind) && placeKind === 'home' ? 0.35 : 0.02;
  const base: Record<ActKind, number> = { sleep: 0, routine: 0.3, commute: placeKind === 'subway' || placeKind === 'bus_stop' ? 0.8 : 0.25, work: placeKind === 'office' ? 0.22 : 0.1, study: 0.3, meal: 0.55, errand: 0.3, care: 0.18, leisure: 0.5, phone: 1, rest: 0.6 };
  return clamp(base[kind] * (0.55 + p.capability.digital_literacy * 0.6));
}

/** 这段日程属于哪一类事（agenda.yaml 可以用 k 显式标注；旧日程按地点和文字推断） */
export function actKindOf(it: Pick<AgendaItemRow, 'kind' | 'place_kind' | 'activity'>): ActKind {
  if (it.kind && (ACT_KINDS as string[]).includes(it.kind)) return it.kind as ActKind;
  const a = it.activity;
  if (/睡|补觉|sleep/i.test(a)) return 'sleep';
  if (/饭|吃|午餐|lunch|breakfast|dinner|咖啡|coffee/i.test(a) && it.place_kind !== 'home') return 'meal';
  if (/通勤|上班路|回家路|commut|heading/i.test(a) || ['subway', 'road', 'bus_stop'].includes(it.place_kind)) return 'commute';
  if (/刷手机|追剧|scroll|phone|shows/i.test(a)) return 'phone';
  if (/接|送|孩子|kid|pick-up|drop-off/i.test(a)) return 'care';
  if (/上课|自习|作业|复习|class|study|homework|assignment/i.test(a)) return 'study';
  if (/上班|工作|夜班|干活|赶稿|work|shift|deadline/i.test(a)) return 'work';
  if (/买菜|超市|医院|复查|grocery|market|shopping|check-up/i.test(a)) return 'errand';
  if (/公园|散步|晨练|跑步|玩|walk|park|run|exercise|play/i.test(a)) return 'leisure';
  if (it.place_kind === 'home') return 'routine';
  return 'leisure';
}

// ---------------------------------------------------------------- 此时此地的处境 → 使用产品时的约束
export interface Channels { hands: 'both' | 'one' | 'none'; eyes: 'full' | 'glance' | 'none'; ears: 'free' | 'busy' | 'noisy'; mouth: 'free' | 'busy' | 'quiet_required' }
export interface Network { down_kbps: number; up_kbps: number; rtt_ms: number; loss: number; offline: boolean }
export interface PlaceContext { motion: 'still' | 'walking' | 'vehicle'; channels: Channels; device: 'phone' | 'computer'; network: Network; constraints: string[]; posture: { zh: string; en: string } }

const NET = { wifi: { down_kbps: 30000, up_kbps: 8000, rtt_ms: 30, loss: 0, offline: false }, cell: { down_kbps: 12000, up_kbps: 3000, rtt_ms: 70, loss: 0, offline: false }, crowded: { down_kbps: 2500, up_kbps: 600, rtt_ms: 220, loss: 0.01, offline: false }, tunnel: { down_kbps: 900, up_kbps: 250, rtt_ms: 450, loss: 0.03, offline: false } };

/** 人在这个地方、做着这件事时，手、眼、耳、嘴各自有没有空，手边是什么设备，网络怎么样 */
export function placeContext(kind: ActKind, placeKind: string, p: PersonaSpec, o: { hashSeed?: number; atDesk?: boolean; staff?: boolean } = {}): PlaceContext {
  const h = o.hashSeed ?? 0;
  const at = (zh: string, en: string) => ({ zh, en });
  // 在店里、餐馆里上班的人：站着招呼客人，只能抽空瞄一眼手机
  if (o.staff && kind === 'work' && ['restaurant', 'cafe', 'shop'].includes(placeKind)) return { motion: 'still', channels: { hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'busy' }, device: 'phone', network: NET.wifi, constraints: ['one_handed'], posture: at('在店里上班，趁没客人的间隙', 'working at the shop, in a gap between customers') };
  if (placeKind === 'subway') { const inCar = h % 3 !== 0; return { motion: 'vehicle', channels: { hands: 'one', eyes: inCar ? 'glance' : 'full', ears: 'noisy', mouth: 'quiet_required' }, device: 'phone', network: inCar ? NET.tunnel : NET.crowded, constraints: ['one_handed', ...(inCar ? ['bumpy_ride', 'weak_network'] : [])], posture: inCar ? at('在地铁车厢里站着，一只手抓着扶手', 'standing in a subway car, one hand on the rail') : at('在地铁站台等车', 'waiting on the subway platform') }; }
  if (placeKind === 'road') return { motion: 'vehicle', channels: { hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'free' }, device: 'phone', network: NET.cell, constraints: ['one_handed', 'bumpy_ride'], posture: at('坐在车后座上', 'in the back seat of a car') };
  if (placeKind === 'bus_stop') return { motion: 'still', channels: { hands: 'one', eyes: 'full', ears: 'noisy', mouth: 'free' }, device: 'phone', network: NET.cell, constraints: ['one_handed'], posture: at('在公交站等车', 'waiting at the bus stop') };
  if (placeKind === 'street' || (placeKind === 'park' && kind === 'leisure' && h % 2 === 0)) return { motion: 'walking', channels: { hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'free' }, device: 'phone', network: NET.cell, constraints: ['one_handed'], posture: at('边走边看手机', 'walking while looking at the phone') };
  if (placeKind === 'park') return { motion: 'still', channels: { hands: 'both', eyes: 'full', ears: 'free', mouth: 'free' }, device: 'phone', network: NET.cell, constraints: [], posture: at('坐在公园长椅上', 'sitting on a park bench') };
  if (['restaurant', 'cafe'].includes(placeKind)) { const eating = kind === 'meal'; return { motion: 'still', channels: { hands: eating ? 'one' : 'both', eyes: 'full', ears: 'noisy', mouth: eating ? 'busy' : 'free' }, device: kind === 'work' ? 'computer' : 'phone', network: NET.wifi, constraints: eating ? ['one_handed'] : [], posture: eating ? at('一边吃饭一边看手机', 'eating with the phone in one hand') : at('坐在店里靠窗的位置', 'sitting by the window') }; }
  if (placeKind === 'shop') return { motion: 'still', channels: { hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'free' }, device: 'phone', network: NET.crowded, constraints: ['one_handed'], posture: at('在超市里，一只手拎着东西', 'in the store, carrying things in one hand') };
  if (placeKind === 'hospital') return { motion: 'still', channels: { hands: 'both', eyes: 'full', ears: 'noisy', mouth: 'quiet_required' }, device: 'phone', network: NET.crowded, constraints: [], posture: kind === 'work' ? at('在医院值班的间隙', 'between tasks on shift at the hospital') : at('在医院候诊区等着', 'waiting in the hospital lobby') };
  if (placeKind === 'office' || placeKind === 'library' || placeKind === 'school') {
    const desk = kind === 'work' || kind === 'study';
    const computer = desk && (placeKind === 'office' || p.capability.digital_literacy > 0.55);
    return { motion: 'still', channels: { hands: 'both', eyes: 'full', ears: placeKind === 'office' ? 'busy' : 'free', mouth: 'quiet_required' }, device: computer ? 'computer' : 'phone', network: NET.wifi, constraints: [], posture: placeKind === 'office' ? at('坐在工位上', 'at the office desk') : placeKind === 'library' ? at('在图书馆的座位上', 'at a library desk') : at('在学校里', 'at school') };
  }
  if (placeKind === 'factory') return { motion: 'still', channels: { hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'free' }, device: 'phone', network: NET.cell, constraints: ['one_handed'], posture: at('在车间休息的间隙', 'on a short break on the shop floor') };
  if (kind === 'sleep') return { motion: 'still', channels: { hands: 'none', eyes: 'none', ears: 'free', mouth: 'quiet_required' }, device: 'phone', network: NET.wifi, constraints: [], posture: at('在床上睡着', 'asleep in bed') };
  // 家里
  const desk = o.atDesk ?? (['work', 'study'].includes(kind) && p.capability.digital_literacy > 0.5);
  if (desk) return { motion: 'still', channels: { hands: 'both', eyes: 'full', ears: 'free', mouth: 'free' }, device: 'computer', network: NET.wifi, constraints: [], posture: at('在家里的书桌前', 'at the desk at home') };
  if (kind === 'care') return { motion: 'still', channels: { hands: 'one', eyes: 'glance', ears: 'noisy', mouth: 'free' }, device: 'phone', network: NET.wifi, constraints: ['one_handed'], posture: at('在家里，一边照看孩子', 'at home, minding the kids') };
  if (kind === 'phone' && h % 2 === 0) return { motion: 'still', channels: { hands: 'one', eyes: 'full', ears: 'free', mouth: 'quiet_required' }, device: 'phone', network: NET.wifi, constraints: ['one_handed'], posture: at('躺在床上', 'lying in bed') };
  return { motion: 'still', channels: { hands: 'both', eyes: 'full', ears: 'free', mouth: 'free' }, device: 'phone', network: NET.wifi, constraints: [], posture: at('在家里沙发上', 'on the couch at home') };
}

/** 城里的事件落到正在那个地点的人身上 */
export const EVENT_EFFECT: Record<string, { network?: Network; interrupt?: { minutes: number; kind: 'switch_away' }; stress: number; attention: number; text: { zh: string; en: string }; outdoorOnly?: boolean }> = {
  weak_network: { network: { down_kbps: 300, up_kbps: 100, rtt_ms: 900, loss: 0.05, offline: false }, stress: 0.05, attention: 0, text: { zh: '这里的网络突然变得很卡', en: 'the network here suddenly got very slow' } },
  power_cut: { network: { down_kbps: 0, up_kbps: 0, rtt_ms: 0, loss: 1, offline: true }, interrupt: { minutes: 2, kind: 'switch_away' }, stress: 0.15, attention: -0.2, text: { zh: '突然停电了，周围一片漆黑，Wi-Fi 也断了', en: 'the power went out — everything is dark and the Wi-Fi is down' } },
  noise: { stress: 0.08, attention: -0.2, text: { zh: '旁边突然很吵，很难集中注意力', en: 'it suddenly got very loud nearby and hard to focus' } },
  crowd: { stress: 0.1, attention: -0.1, text: { zh: '人一下子多了起来，被挤来挤去', en: 'a crowd poured in and you are being jostled' } },
  rain: { interrupt: { minutes: 3, kind: 'switch_away' }, stress: 0.1, attention: -0.15, text: { zh: '突然下起了雨，得先找地方躲一下', en: 'it started raining — you need to find shelter first' }, outdoorOnly: true },
};
export const OUTDOOR = ['park', 'street', 'bus_stop', 'road'];
