// 第七层「出门与吃喝玩乐」：由规则从已经确定的人口学属性、性格与价格敏感度推导（纯计算，不调用模型）。
// 词表与依据编号在 config/population/leisure.json；依据的调研与检查结论见 docs/research/README.md。
// 同一个人每次推导结果相同（随机数以人物 id 为种子），所以随包数据与新生成的居民一致可复现。
import { configPath, langOf, LeisureSchema, readJson, Rng, shortHash, type Leisure, type PersonaSpec } from '@pux/core';

type Lang = 'zh' | 'en';
interface When {
  role?: Leisure['group_role'][]; voice?: Leisure['voice'][]; pace?: Leisure['pace'][]; budget?: Leisure['budget'][]; split?: Leisure['split'][];
  transport?: Leisure['transport'][]; choose_by?: Leisure['dining']['choose_by'][]; solo_ok?: boolean; has_restrictions?: boolean; adult?: boolean;
  min_age?: number; max_age?: number; max_battery?: number; min_trip_days?: number; max_agreeableness?: number; travels?: boolean;
}
interface Item { zh: string; en: string; src?: string[]; if?: When; w?: number }
interface Mem extends Item { valence: number; importance: number; who?: 'ties' }  // who=ties：{who} 只从熟人圈子里挑（不熟的饭局、被劝着去的局、AA 聚餐）
interface Vocab {
  places: Record<'nearby' | 'domestic' | 'abroad' | 'quiet' | 'museum', Record<Lang, string[]>>;
  activities: { slow: Item[]; balanced: Item[]; packed: Item[]; child: Item[]; hobby: Record<string, { zh: string; en: string }> };
  restrictions: Item[]; dislikes: Item[]; pet_peeves: Item[]; habits: Item[]; memories: Mem[]; child_memories: Mem[];
  roles: Record<Leisure['group_role'], Item>;
}
let cached: Vocab | undefined;
export const leisureVocab = (): Vocab => (cached ??= readJson<Vocab>(configPath('population', 'leisure.json')));

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 月收入（当地货币）：从 income_band 里读出数字；读不出时按地区给一个中位数 */
function monthlyIncome(p: PersonaSpec): number {
  const s = (p.identity.income_band ?? '').replace(/,/g, '');
  const n = Number(/(\d+(?:\.\d+)?)/.exec(s)?.[1] ?? NaN);
  if (!Number.isFinite(n)) return p.locale === 'zh-CN' ? 7000 : 4000;
  let v = /万/.test(s) ? n * 10_000 : /k/i.test(s) ? n * 1000 : n;
  if (/year|年/i.test(s)) v /= 12;
  return v;
}
/** 收入在当地算低、中、高（0–1） */
function incomeLevel(p: PersonaSpec): number {
  const m = monthlyIncome(p);
  const [lo, hi] = p.locale === 'zh-CN' ? [2500, 15000] : [1500, 9000];
  return clamp((m - lo) / (hi - lo));
}
const BIG_TRANSIT_CITIES = /New York|Brooklyn|Queens|Bronx|San Francisco|Chicago|Boston|Washington|Philadelphia|Seattle|Jersey City/i;

/** 不住在一起、不在本地的亲人（「在老家的母亲」「sister living in Baltimore」） */
const FAR = /老家|外地|异地|在外|在[\u4e00-\u9fa5]{1,6}(?:工作|读书|上学|生活|打工|定居)|living in|lives in|back in|away at|overseas|\bin [A-Z]/;
function companions(p: PersonaSpec, rng: Rng, n: number, local = false): string[] {
  const zh = p.locale === 'zh-CN';
  const fam = p.identity.family.filter((f) => !/去世|已故|passed|late /i.test(f) && !(local && FAR.test(f)));
  const ties = p.identity.social_ties;
  const pool = [...fam.slice(0, 2), ...rng.shuffle(ties).slice(0, 2)];
  return pool.length ? pool.slice(0, n) : [zh ? '几个老朋友' : 'a couple of old friends'];
}

/** 名单里的一位同伴，用在记忆里：「妻子李秀梅」→「李秀梅」；圈子描述原样用 */
function whoOf(s: string, zh: boolean): string {
  if (zh) { const m = /(?:妻子|丈夫|老公|老婆|女儿|儿子|母亲|父亲|妈妈|爸爸|室友|男朋友|女朋友|对象|伴侣|岳母|岳父|婆婆|公公|哥哥|姐姐|弟弟|妹妹|奶奶|爷爷|外婆|外公|孙子|孙女|外孙女|外孙)([一-龥]{2,3})(?:[（(].*)?$/.exec(s); return m ? m[1] : s; }
  const m = /\b(?:wife|husband|partner|son|daughter|roommate|boyfriend|girlfriend|mother|father|mom|dad|sister|brother|aunt|uncle|niece|nephew|cousin|grandson|granddaughter|grandmother|grandfather)\s+([A-Z][\p{L}'-]+)/u.exec(s); return m ? m[1] : s;
}

function matches(w: When | undefined, f: Facts): boolean {
  if (!w) return true;
  const inList = <T>(xs: T[] | undefined, v: T) => !xs || xs.includes(v);
  return inList(w.role, f.group_role) && inList(w.voice, f.voice) && inList(w.pace, f.pace) && inList(w.budget, f.budget) && inList(w.split, f.split)
    && inList(w.transport, f.transport) && inList(w.choose_by, f.choose_by)
    && (w.solo_ok === undefined || w.solo_ok === f.solo_ok) && (w.has_restrictions === undefined || w.has_restrictions === f.restrictions.length > 0)
    && (w.adult === undefined || w.adult === f.age >= 18) && (w.min_age === undefined || f.age >= w.min_age) && (w.max_age === undefined || f.age <= w.max_age)
    && (w.max_battery === undefined || f.social_battery <= w.max_battery) && (w.min_trip_days === undefined || f.days[1] >= w.min_trip_days)
    && (w.max_agreeableness === undefined || f.A <= w.max_agreeableness) && (w.travels === undefined || w.travels === (f.range !== 'none'));
}

interface Facts {
  age: number; A: number; group_role: Leisure['group_role']; voice: Leisure['voice']; pace: Leisure['pace']; budget: Leisure['budget']; split: Leisure['split'];
  transport: Leisure['transport']; choose_by: Leisure['dining']['choose_by']; solo_ok: boolean; restrictions: string[]; social_battery: number; days: [number, number]; range: Leisure['trips']['range'];
}

/** 带权重、按条件挑 n 条（不重复） */
function pickItems<T extends Item>(rng: Rng, pool: T[], f: Facts, n: number): T[] {
  const ok = pool.filter((x) => matches(x.if, f)); const out: T[] = [];
  while (out.length < n && out.length < ok.length) {
    const left = ok.filter((x) => !out.includes(x));
    out.push(rng.weighted(left.map((x) => ({ item: x, weight: x.w ?? 1 }))));
  }
  return out;
}

/**
 * 推导一个人的出门与吃喝玩乐习惯。规则依据（编号见 docs/research/README.md）：
 * - 同行角色：有条理又外向的人多半拿主意（C0011、C0017），随和而不爱操心的跟着走（C0013、C0023），内向、爱新鲜、独居的人更愿意自己去（C0001、C0005），其余希望一起商量（C0007、C0008）。
 * - 定方案时：内向又敏感的人提议被否几次后就不再说（C0004）；不随和也不操心的人嘴上随便、事后挑（P0002、C0005）；很随和的人都可以；其余会提前说（C0003）。
 * - 节奏：精力低（内向、焦虑、年纪大、累）的人想慢慢逛、放空（P0004），精力高的人一天跑好几个点；作息分歧见 P0002。
 * - 分账：很随和又不太在乎钱的人常替大家垫（P0009）；很在乎钱或很有条理的人按人头算清。
 * - 出行：大城市年轻人多坐地铁；开车的人会被停车费劝退（P0011）。
 * - 选店：爱比较的人看点评（会被「照片好看、人均偏低」坑，P0008、C0060），差不多就行的人就近或去熟店，跟着走的人让别人定。
 */
export function deriveLeisure(p: PersonaSpec, o: { hobbies?: string[]; householdType?: string } = {}): Leisure {
  const V = leisureVocab(); const lang: Lang = langOf(p.locale) === 'en' ? 'en' : 'zh'; const zh = lang === 'zh';
  const rng = new Rng(parseInt(shortHash(`leisure:${p.id}`, 7), 16));
  const { O, C, E, A, N } = p.psychology.ocean; const age = p.identity.age;
  const child = p.kind === 'child' || age < 14;
  const inc = incomeLevel(p); const ps = p.psychology.price_sensitivity;
  const single = o.householdType === 'single' || (!o.householdType && p.identity.family.length === 0);
  const kids = p.identity.family.some((f) => /儿子|女儿|孩子|宝宝|son|daughter|kid|child|baby/i.test(f) && !/外孙|孙子|孙女|grand/i.test(f));
  const j = () => (rng.next() - 0.5) * 0.16;

  // 同行角色与定方案时的样子
  let group_role: Leisure['group_role'];
  if (child) group_role = 'follower';
  else {
    // 以人群中位数为中心（C≈0.58、E≈0.5、A≈0.54、O≈0.51），让四种角色都有相当比例
    const score = { planner: (C - 0.58) * 1.0 + (E - 0.5) * 0.45 + (kids ? 0.05 : 0) + j(), follower: (A - 0.54) * 0.7 + (0.58 - C) * 0.7 + j(), solo: (0.5 - E) * 0.9 + (O - 0.51) * 0.3 + (single ? 0.1 : 0) + j(), co_planner: 0.07 + j() };
    group_role = (Object.entries(score).sort((a, b) => b[1] - a[1])[0][0]) as Leisure['group_role'];
  }
  const voice: Leisure['voice'] = child ? 'goes_along' : group_role === 'planner' ? 'speaks_up'
    : E < 0.42 && N > 0.5 ? 'withdrawn' : A < 0.42 && C < 0.55 ? 'vetoes_later' : A > 0.62 ? 'goes_along' : 'speaks_up';

  // 节奏与社交电量
  const youth = age < 30 ? 0.2 : age < 45 ? 0.12 : age < 60 ? 0.05 : -0.05;
  const energy = E * 0.35 + (1 - N) * 0.2 + O * 0.2 + youth - p.state_defaults.fatigue * 0.2 + j();
  const pace: Leisure['pace'] = child ? 'balanced' : energy > 0.55 ? 'packed' : energy < 0.36 ? 'slow' : 'balanced';
  const social_battery = r2(clamp(E * 0.65 + A * 0.2 + 0.08 + j() * 0.5));

  // 钱、分账、出行
  const budget: Leisure['budget'] = ps > 0.82 || (inc < 0.08 && ps > 0.5) ? 'frugal' : ps < 0.42 && inc > 0.55 ? 'splurge' : ps < 0.58 && inc > 0.3 ? 'comfort' : 'value';
  const split: Leisure['split'] = child ? 'take_turns' : A > 0.64 && ps < 0.6 ? 'often_pays' : ps > 0.8 || C > 0.76 ? 'aa_exact' : E > 0.58 && A > 0.48 ? 'take_turns' : 'aa_rough';
  let transport: Leisure['transport'];
  if (child) transport = zh ? 'transit' : 'drive';
  else if (zh) {
    const bigCity = /一线|新一线/.test(p.identity.city_tier ?? '');
    transport = age >= 65 ? (rng.bool(0.6) ? 'walk_bike' : 'transit') : (inc > 0.55 && (kids || age > 35) && rng.bool(0.6)) ? 'drive' : bigCity ? (inc > 0.5 && rng.bool(0.3) ? 'taxi' : 'transit') : rng.bool(0.4) ? 'walk_bike' : 'transit';
  } else {
    transport = BIG_TRANSIT_CITIES.test(p.identity.region) ? (rng.bool(0.7) ? 'transit' : 'taxi') : age >= 80 ? 'taxi' : 'drive';
  }

  // 吃饭
  const restrictions = child ? [] : V.restrictions.filter((r) => matches(r.if, { age } as Facts) && rng.bool((r.w ?? 0.05) * (zh ? 1 : 0.8))).slice(0, 2).map((r) => r[lang]);
  const choose_by: Leisure['dining']['choose_by'] = child ? 'others' : group_role === 'follower' && rng.bool(0.6) ? 'others' : p.behavior_policy.decision_style === 'maximizer' && rng.bool(0.7) ? 'reviews' : O > 0.6 && rng.bool(0.4) ? 'reviews' : rng.bool(0.5) ? 'familiar' : 'nearby';
  const solo_ok = !child && (group_role === 'solo' || E < 0.5 || rng.bool(0.4));

  // 时间尺度：本地（小时）与异地（天/周）
  const range: Leisure['trips']['range'] = child ? (inc > 0.3 ? 'domestic' : 'nearby')
    : budget === 'frugal' ? (age > 72 || inc < 0.05 || rng.bool(0.3) ? 'none' : 'nearby') : age > 80 ? 'none' : budget === 'splurge' && rng.bool(0.7) ? 'abroad' : budget === 'comfort' && rng.bool(0.3) ? 'abroad' : rng.bool(0.65) ? 'domestic' : 'nearby';
  const days: [number, number] = range === 'none' ? [1, 1] : range === 'nearby' ? [2, 3] : range === 'domestic' ? [3, rng.int(5, 7)] : [rng.int(5, 7), rng.int(9, 14)];
  const per_year = range === 'none' ? 0 : range === 'abroad' ? rng.int(1, 2) : rng.int(1, 3);
  const hours = pace === 'slow' ? rng.pick([2, 2.5, 3]) : pace === 'balanced' ? rng.pick([3, 4, 5]) : rng.pick([5, 6, 8]);
  const per_month = Math.round(clamp((social_battery * 6 + (pace === 'packed' ? 2 : 0) + (kids ? -1 : 0) + (age >= 65 ? 1 : 0) + rng.int(0, 2)) / 1, 1, 12));

  const facts: Facts = { age, A, group_role, voice, pace, budget, split, transport, choose_by, solo_ok, restrictions, social_battery, days, range };
  const hobbyActs = (o.hobbies ?? []).map((h) => V.activities.hobby[h]?.[lang]).filter((x): x is string => !!x);
  const paceActs = pickItems(rng, child ? V.activities.child : V.activities[pace], facts, 2);
  const activities = [...new Set([...hobbyActs.slice(0, 2), ...paceActs.map((x) => x[lang])])].slice(0, 4);
  const withLocal = group_role === 'solo' && !child ? [] : companions(p, rng, 2, true);
  const withTrips = range === 'none' ? [] : companions(p, rng, 2);

  const dislikes = child ? [] : pickItems(rng, V.dislikes, facts, 2);
  const peeves = child ? [] : pickItems(rng, V.pet_peeves, facts, 2);
  const habits = child ? [] : pickItems(rng, V.habits, facts, 2);

  // 往事：2–3 件（儿童 1 件），落到这个人自己的家人、熟人和去过的地方上
  const placeOf = (k: 'nearby' | 'domestic' | 'abroad' | 'quiet' | 'museum') => rng.pick(V.places[k][lang].filter((x) => !p.identity.region.includes(x)));
  const tripPlace = placeOf(range === 'none' ? 'nearby' : range);
  const people = [...withTrips, ...withLocal, ...companions(p, rng, 3)];
  const ties = p.identity.social_ties.length ? p.identity.social_ties : [zh ? '几个同事' : 'some coworkers'];
  const fill = (t: string, who: 'ties' | undefined) => t.replace(/\{who\}/g, () => whoOf(rng.pick(who === 'ties' ? ties : people), zh)).replace(/\{place\}/g, tripPlace).replace(/\{days\}/g, String(days[1]))
    .replace(/\{quiet\}/g, placeOf('quiet')).replace(/\{museum\}/g, placeOf('museum'));
  const memPicks = child ? pickItems(rng, V.child_memories, facts, 1) : pickItems(rng, V.memories, facts, rng.int(2, 3));
  const memories = memPicks.map((m) => ({ text: fill(m[lang], m.who), valence: m.valence, importance: m.importance, ago_days: rng.int(30, 900) }));

  const used = [V.roles[group_role], ...paceActs, ...dislikes, ...peeves, ...habits, ...memPicks, ...V.restrictions.filter((r) => restrictions.includes(r[lang]))];
  const sources = [...new Set(used.flatMap((x) => x.src ?? []))].sort();
  return LeisureSchema.parse({
    local: { activities, hours, per_month, with: withLocal }, trips: { per_year, days, range, with: withTrips },
    group_role, voice, pace, social_battery, budget, split, transport,
    dining: { restrictions, choose_by, solo_ok, dislikes: dislikes.map((x) => x[lang]) },
    pet_peeves: peeves.map((x) => x[lang]), habits: habits.map((x) => x[lang]), memories, sources: child ? [] : sources,
  });
}

/** 没有这一层的人物补上（已经有的原样返回） */
export function withLeisure(p: PersonaSpec, o?: { hobbies?: string[]; householdType?: string }): PersonaSpec {
  return p.leisure ? p : { ...p, leisure: deriveLeisure(p, o) };
}

// ---------------------------------------------------------------- 给人物看的文字（第一人称描述、钉住的自我）

const L = {
  role: { planner: ['和别人出去时，一般是你拿主意：攻略、订票、选店都是你', 'when you go out with others, you are usually the one who plans, books and picks the places'], co_planner: ['和别人出去时，你希望大家一起商量、一起分担', 'when you go out with others, you want everyone to decide and pitch in together'], follower: ['和别人出去时，你习惯跟着别人的安排走', 'when you go out with others, you go along with whoever plans'], solo: ['你更喜欢一个人出去，或者只跟合得来的人', 'you prefer going out alone, or only with people you really click with'] },
  voice: { speaks_up: ['有想法会在定方案时就说', 'you say what you want while the plan is being made'], goes_along: ['定方案时多半说「都可以」', 'you mostly say "either is fine" when plans are made'], withdrawn: ['以前提议总被否，现在不太爱提了', 'your ideas used to get shot down, so you rarely suggest anything now'], vetoes_later: ['嘴上说随便，到了现场才发现这也不想那也不想', 'you say "whatever works", then find you don\'t like much once you\'re there'] },
  pace: { packed: ['喜欢一天跑好几个地方', 'you like to pack a day with stops'], balanced: ['节奏不紧不慢', 'you like an easy-but-full pace'], slow: ['喜欢慢慢逛、能坐下来发呆，不想赶场打卡', 'you like to wander slowly and sit, not rush from sight to sight'] },
  budget: { frugal: ['能省则省', 'you spend as little as possible'], value: ['要花得值', 'you want value for money'], comfort: ['舒服比省钱重要', 'comfort matters more than saving'], splurge: ['玩的时候不太看价钱', 'you rarely check prices when having fun'] },
  split: { aa_exact: ['分账算得清清楚楚', 'you split bills to the cent'], aa_rough: ['大致 AA 就行', 'you split bills roughly'], take_turns: ['这次你请、下次我请', 'you take turns treating'], often_pays: ['常常是你先垫钱', 'you often end up fronting the bill'] },
  transport: { walk_bike: ['走路或骑车', 'walk or bike'], transit: ['坐地铁公交', 'take the subway or bus'], taxi: ['打车', 'take a cab or rideshare'], drive: ['开车', 'drive'] },
  choose: { reviews: ['看点评和网上的照片挑店', 'you pick places by reviews and photos online'], familiar: ['去吃熟了的店', 'you go to places you already know'], nearby: ['附近随便找一家', 'you go wherever is nearby'], others: ['让别人定', 'you let others choose'] },
  range: { none: ['基本不出远门', 'you hardly ever travel'], nearby: ['去周边', 'nearby'], domestic: ['国内', 'within the country'], abroad: ['国内国外都去', 'at home and abroad'] },
} as const;
const pick2 = (x: readonly [string, string], en: boolean) => x[en ? 1 : 0];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** 人物第一人称描述里的一段（personaBio 使用） */
export function leisureBio(p: PersonaSpec): string {
  const l = p.leisure; if (!l) return '';
  const en = langOf(p.locale) === 'en';
  const sep = en ? ', ' : '、';
  const withL = l.local.with.length ? l.local.with.join(sep) : en ? 'on your own' : '自己';
  const tripLine = l.trips.range === 'none' ? pick2(L.range.none, en)
    : en ? `you travel ${pick2(L.range[l.trips.range], en)} about ${l.trips.per_year === 1 ? 'once' : `${l.trips.per_year} times`} a year, ${l.trips.days[0]}–${l.trips.days[1]} days each${l.trips.with.length ? `, usually with ${l.trips.with.join(sep)}` : ''}`
      : `一年出远门 ${l.trips.per_year} 次左右（${pick2(L.range[l.trips.range], en)}），每次 ${l.trips.days[0]}–${l.trips.days[1]} 天${l.trips.with.length ? `，多半和${l.trips.with.join(sep)}` : ''}`;
  const d = l.dining;
  if (en) {
    return `Going out: on free days you like ${l.local.activities.join(sep) || 'staying close to home'} (about ${l.local.hours} hours, ${l.local.per_month} times a month, with ${withL}); ${tripLine}. ${cap(pick2(L.role[l.group_role], en))}; ${pick2(L.voice[l.voice], en)}; ${pick2(L.pace[l.pace], en)}. Money: ${pick2(L.budget[l.budget], en)}; ${pick2(L.split[l.split], en)}. You usually ${pick2(L.transport[l.transport], en)}. Eating out: ${pick2(L.choose[d.choose_by], en)}${d.restrictions.length ? `; ${d.restrictions.join(sep)}` : ''}${d.solo_ok ? '; eating alone is fine' : ''}${d.dislikes.length ? `; you can't stand ${d.dislikes.join(sep)}` : ''}.${l.pet_peeves.length ? ` With others, what wears you down: ${l.pet_peeves.join('; ')}.` : ''}${l.habits.length ? ` Lessons learned: ${l.habits.join('; ')}.` : ''}`;
  }
  return `出门与吃喝：有空时你常${l.local.activities.join(sep) || '待在家附近'}（一次 ${l.local.hours} 小时左右，一个月 ${l.local.per_month} 次，多半和${withL}）；${tripLine}。${pick2(L.role[l.group_role], en)}；${pick2(L.voice[l.voice], en)}；${pick2(L.pace[l.pace], en)}。钱：${pick2(L.budget[l.budget], en)}，${pick2(L.split[l.split], en)}；出门多${pick2(L.transport[l.transport], en)}。吃饭：${pick2(L.choose[d.choose_by], en)}${d.restrictions.length ? `；${d.restrictions.join(sep)}` : ''}${d.solo_ok ? '；一个人吃饭也自在' : ''}${d.dislikes.length ? `；最受不了${d.dislikes.join(sep)}` : ''}。${l.pet_peeves.length ? `和别人一起出去最怕：${l.pet_peeves.join('；')}。` : ''}${l.habits.length ? `吃过亏之后的做法：${l.habits.join('；')}。` : ''}`;
}

/** 钉住的自我里关于出门的一两句（coreStatements 使用） */
export function leisureCore(p: PersonaSpec): string[] {
  const l = p.leisure; if (!l || p.kind === 'child') return [];
  const en = langOf(p.locale) === 'en'; const r = leisureVocab().roles[l.group_role];
  return [en ? r.en : r.zh, ...l.habits.slice(0, 1).map((h) => (en ? `What I've learned about going out with people: ${h}` : `出去玩我学到的：${h}`))];
}
