// 人口合成（纯计算，不调用模型）。
// 原则：人口学属性来自统计分布（中国：普查口径的条件抽样表；英语区：Nemotron-Personas-USA 的抽样行）；
// 能力、性格、行为倾向由规则 + 随机扰动推导；模型只负责写叙事（名字、生平、家人、看法），不决定任何数值——
// 让模型「多生成一些」换不来多样性，它会把群体内的差异压平。
import { configPath, readJson, shortHash, type Rng } from '@pux/core';

export type Locale = 'zh-CN' | 'en-US';
export type Role = 'head' | 'spouse' | 'child' | 'grandparent' | 'roommate';
/** 职业大类 → 决定工作地点类型与日程角色 */
export type WorkGroup = 'office' | 'tech' | 'factory' | 'medical' | 'education' | 'retail' | 'food' | 'service' | 'delivery' | 'outdoor' | 'freelance' | 'home' | 'student' | 'retired' | 'none' | 'school_kid';

export interface Skeleton {
  key: string; locale: Locale; role: Role;
  age: number; gender: string; education: string; occupation: string; work_group: WorkGroup;
  income_month: number;            // 月收入（当地货币）
  marital: string; region: string; city_tier?: string;
  life_event: string; hobbies: string[]; attitude?: { tag: string; traits: string[] };
  source: 'census-zh' | 'nemotron-usa' | 'fallback-en';
  seed_text?: string;              // 数据集里的人物描述（只给模型写叙事时参考）
  seed_name?: string;
}
export interface HouseholdPlan { id: string; locale: Locale; type: string; region: string; city_tier?: string; members: Skeleton[] }

interface W<T> { v: T; w: number }
const pick = <T>(rng: Rng, xs: W<T>[]): T => rng.weighted(xs.map((x) => ({ item: x.v, weight: x.w })));
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const between = (rng: Rng, [a, b]: [number, number] | number[]) => a + rng.next() * (b - a);

interface ZhCfg {
  household_types: (W<string> & { members: string[] })[]; head_age: Record<string, W<[number, number]>[]>;
  education_by_age: { max_age: number; dist: W<string>[] }[];
  occupation_by_education: Record<string, (W<string> & { g: WorkGroup; income: [number, number] })[]>;
  student_share: { max_age: number; p: number }[]; retire_age: Record<string, number>; still_working_after_retire: number;
  retired_jobs: W<string>[]; pension: [number, number];
  regions: (W<string> & { tier: string })[]; income_tier_factor: Record<string, number>;
  life_events: W<string>[]; hobbies: string[]; attitudes: (W<never> & { tag: string; traits: string[] })[];
}
interface EnCfg {
  kids_by_marital: Record<string, number>; kids_age_range: [number, number]; roommate_share_never_married_under_32: number;
  income_by_education: Record<string, [number, number]>; retired_income: [number, number];
  life_events: W<string>[]; attitudes: { tag: string; w: number; traits: string[] }[];
  fallback: { age: W<[number, number]>[]; education: W<string>[]; marital: W<string>[]; occupation: W<string>[]; regions: string[] };
}
export const zhConfig = () => readJson<ZhCfg>(configPath('population', 'zh-CN.json'));
export const enConfig = () => readJson<EnCfg>(configPath('population', 'en-US.json'));

const attitudeOf = (rng: Rng, list: { tag: string; w: number; traits: string[] }[]) => { let r = rng.next(); for (const a of list) { if ((r -= a.w) < 0) return { tag: a.tag, traits: [rng.pick(a.traits)] }; } return undefined; };
const hobbiesOf = (rng: Rng, pool: string[], n: number) => rng.shuffle(pool).slice(0, n);

// ---------------------------------------------------------------- 中国：家庭 → 成员 → 条件抽样
function zhAdult(cfg: ZhCfg, rng: Rng, o: { age: number; gender: string; role: Role; region: string; tier: string; key: string; hasYoungKid?: boolean }): Skeleton {
  const edu = pick(rng, cfg.education_by_age.find((e) => o.age <= e.max_age)!.dist);
  let occupation: string; let g: WorkGroup; let income: number;
  const retireAge = cfg.retire_age[o.gender] ?? 60;
  const studentP = cfg.student_share.find((s) => o.age <= s.max_age)?.p ?? 0;
  const factor = cfg.income_tier_factor[o.tier] ?? 1;
  if (o.age >= retireAge && !rng.bool(cfg.still_working_after_retire)) { occupation = pick(rng, cfg.retired_jobs); g = 'retired'; income = between(rng, cfg.pension) * (edu === '初中及以下' ? 0.7 : 1.1) * factor; }
  else if (['大专', '本科', '研究生'].includes(edu) && o.role !== 'spouse' && rng.bool(studentP)) { occupation = edu === '研究生' ? '在读研究生' : '大学生'; g = 'student'; income = between(rng, [1200, 3000]); }
  else {
    let pool = cfg.occupation_by_education[edu];
    if (!o.hasYoungKid) pool = pool.filter((x) => x.g !== 'home' || rng.bool(0.15));
    if (o.gender === '男') pool = pool.map((x) => (x.g === 'home' ? { ...x, w: x.w * 0.15 } : x));
    const oc = rng.weighted(pool.map((x) => ({ item: x, weight: x.w })));
    occupation = oc.v; g = oc.g;
    // 收入在职业区间内偏左（对数均匀），再乘城市层级系数；年资略有加成
    const [lo, hi] = oc.income; const u = Math.pow(rng.next(), 1.6);
    income = (lo + (hi - lo) * u) * factor * (o.age > 35 && g !== 'none' ? 1.1 : 1);
  }
  return {
    key: o.key, locale: 'zh-CN', role: o.role, age: o.age, gender: o.gender, education: edu, occupation, work_group: g, income_month: Math.round(income / 100) * 100,
    marital: o.role === 'spouse' || o.role === 'head' ? '' : '', region: o.region, city_tier: o.tier,
    life_event: pick(rng, cfg.life_events), hobbies: hobbiesOf(rng, cfg.hobbies, rng.int(1, 3)), attitude: attitudeOf(rng, cfg.attitudes as never), source: 'census-zh',
  };
}
function zhChild(cfg: ZhCfg, rng: Rng, o: { parentAge: number; region: string; tier: string; key: string }): Skeleton | undefined {
  const age = clamp(o.parentAge - rng.int(24, 33), 1, 24);
  if (age < 6) return undefined;                 // 学龄前的孩子只出现在家人的描述里，不单独成为世界里的人
  const gender = rng.bool(0.52) ? '男' : '女';
  const grade = age <= 11 ? `小学${['一', '二', '三', '四', '五', '六'][Math.min(5, age - 6)]}年级` : age <= 14 ? `初中${['一', '二', '三'][age - 12]}年级` : age <= 17 ? `高中${['一', '二', '三'][age - 15]}年级` : '大学生';
  return { key: o.key, locale: 'zh-CN', role: 'child', age, gender, education: age <= 17 ? '在读' : '本科', occupation: age <= 17 ? `${grade}学生` : '大学生', work_group: age <= 17 ? 'school_kid' : 'student', income_month: age >= 18 ? 1500 : 0, marital: '', region: o.region, city_tier: o.tier, life_event: age >= 15 && rng.bool(0.25) ? '正在备考，压力不小' : '', hobbies: hobbiesOf(rng, ['打手机游戏', '看动漫', '打篮球', '画画', '刷短视频', '踢足球', '看小说', '玩积木', '追星', '弹钢琴'], 2), source: 'census-zh' };
}

/** 补充特定人群时用：家庭里至少要有一位这样的人才收下（student 大学生与研究生；tech 程序员、工程师、产品、设计、运维、独立开发者） */
export const FOCUS: Record<string, (m: Skeleton) => boolean> = {
  student: (m) => m.work_group === 'student' && m.age >= 18,
  tech: (m) => m.work_group === 'tech' || /工程师|程序|开发|产品经理|运维|算法|设计师/.test(m.occupation),
};

export function sampleHouseholdsZh(rng: Rng, nPeople: number, opts: { focus?: string } = {}): HouseholdPlan[] {
  const cfg = zhConfig(); const out: HouseholdPlan[] = []; let n = 0; let tries = 0;
  const want = opts.focus ? FOCUS[opts.focus] : undefined;
  if (opts.focus && !want) throw new Error(`不认识的人群：${opts.focus}（可选：${Object.keys(FOCUS).join('、')}）`);
  while (n < nPeople) {
    if (++tries > 50_000) throw new Error('抽不出足够的这类人群，检查 config/population/zh-CN.json 里的分布');
    const type = rng.weighted(cfg.household_types.map((t) => ({ item: t, weight: t.w })));
    const region = rng.weighted(cfg.regions.map((x) => ({ item: x, weight: x.w })));
    const id = `hh_zh_${shortHash(`${rng.seed}:${out.length}`, 6)}`;
    const [a0, a1] = pick(rng, cfg.head_age[type.v]); const headAge = rng.int(a0, a1);
    const headGender = type.v === 'single_parent' ? (rng.bool(0.75) ? '女' : '男') : rng.bool(0.5) ? '男' : '女';
    const kidsSlots = type.members.filter((m) => m === 'child').length;
    const members: Skeleton[] = []; let k = 0;
    const key = () => `${id}_${k++}`;
    const youngKid = kidsSlots > 0 && headAge < 40;
    const base = { region: region.v, tier: region.tier };
    for (const m of type.members) {
      if (m === 'head' || m === 'elder') members.push(zhAdult(cfg, rng, { ...base, age: headAge, gender: headGender, role: 'head', key: key(), hasYoungKid: youngKid }));
      else if (m === 'spouse' || m === 'elder_spouse') members.push(zhAdult(cfg, rng, { ...base, age: clamp(headAge + rng.int(-4, 4), 20, 90), gender: headGender === '男' ? '女' : '男', role: 'spouse', key: key(), hasYoungKid: youngKid }));
      else if (m === 'child') { const c = zhChild(cfg, rng, { ...base, parentAge: headAge - (members.filter((x) => x.role === 'child').length ? 3 : 0), key: key() }); if (c) members.push(c); }
      else if (m === 'grandparent') members.push(zhAdult(cfg, rng, { ...base, age: clamp(headAge + rng.int(24, 31), 55, 88), gender: rng.bool(0.6) ? '女' : '男', role: 'grandparent', key: key() }));
      else if (m === 'roommate') members.push(zhAdult(cfg, rng, { ...base, age: clamp(headAge + rng.int(-3, 3), 19, 35), gender: rng.bool(0.8) ? headGender : headGender === '男' ? '女' : '男', role: 'roommate', key: key() }));
    }
    const married = type.v.includes('couple') || type.v === 'three_generation';
    for (const p of members) p.marital = p.role === 'child' ? '未婚' : p.role === 'roommate' ? '未婚' : married && (p.role === 'head' || p.role === 'spouse') ? '已婚' : type.v === 'single_parent' ? '离异' : p.role === 'grandparent' ? (rng.bool(0.5) ? '丧偶' : '已婚') : p.age > 60 && rng.bool(0.4) ? '丧偶' : p.age > 34 && rng.bool(0.3) ? '离异' : '未婚';
    if (want && !members.some(want)) continue;       // 补充特定人群：家里没有这样的人就不要
    out.push({ id, locale: 'zh-CN', type: type.v, region: region.v, city_tier: region.tier, members }); n += members.length;
  }
  return out;
}

// ---------------------------------------------------------------- 英语区：Nemotron 抽样行 → 家庭
export interface NemotronRow { age: number; sex: string; marital_status: string; education_level: string; occupation: string; city: string; state: string; persona: string; professional_persona?: string; hobbies_and_interests_list?: string; cultural_background?: string }

const EN_GROUPS: [RegExp, WorkGroup][] = [
  [/software|computer|programmer|developer|data_|information_security|web_/i, 'tech'], [/nurs|physician|doctor|medical|dental|dentist|pharmac|therap|health|veterinar|paramedic|radiolog|technologist|clinical|surg|optomet/i, 'medical'],
  [/teacher|professor|education|instructor|librarian|tutor|childcare/i, 'education'], [/cashier|retail|sales_?person|store|merchandis/i, 'retail'],
  [/cook|chef|waiter|waitress|food|bartend|barista|dishwasher|baker/i, 'food'], [/driver|truck|delivery|courier|pilot|transport|mover|taxi|chauffeur/i, 'delivery'],
  [/construction|carpenter|electrician|plumber|roofer|painter|landscap|farm|grounds|mechanic|welder|mason/i, 'outdoor'], [/assembler|machin|production|factory|operator|inspector|packag|manufactur/i, 'factory'],
  [/janitor|cleaner|maid|security|guard|hairdress|barber|cosmetolog|attendant|housekeep|personal_care|laborer|stock/i, 'service'],
  [/writer|artist|designer|photograph|musician|actor|freelanc|author|editor/i, 'freelance'],
  [/manager|account|clerk|secretar|administrat|analyst|lawyer|attorney|engineer|financial|insurance|human_resources|market|executive|consult|supervisor|agent|officer|receptionist|bookkeep|customer_service/i, 'office'],
];
const EDU_KEY = (e: string) => (/graduate|master|doctor|professional/i.test(e) ? 'graduate' : /bachelor/i.test(e) ? 'bachelors' : /associate/i.test(e) ? 'associates' : /some_college/i.test(e) ? 'some_college' : /high_school/i.test(e) ? 'high_school' : /9th_12th/i.test(e) ? '9th_12th_no_diploma' : 'less_than_9th');
const pretty = (s: string) => s.replace(/_/g, ' ');

function enPerson(cfg: EnCfg, rng: Rng, row: NemotronRow, role: Role, key: string, source: Skeleton['source']): Skeleton {
  const age = row.age; const occRaw = row.occupation || 'not_in_workforce';
  const noWork = /not_in_workforce|no_occupation|unemployed/i.test(occRaw);
  let g: WorkGroup = age < 18 ? 'school_kid' : age >= 66 && noWork ? 'retired' : age <= 23 && noWork ? 'student' : noWork ? (row.marital_status === 'married_present' && rng.bool(0.5) ? 'home' : 'none') : 'office';
  if (!noWork && age >= 18) for (const [re, grp] of EN_GROUPS) if (re.test(occRaw)) { g = grp; break; }
  const occupation = g === 'school_kid' ? (age <= 10 ? 'elementary school student' : age <= 13 ? 'middle school student' : 'high school student') : g === 'retired' ? 'retired' : g === 'student' ? 'college student' : g === 'home' ? 'stay-at-home parent' : g === 'none' ? 'between jobs' : pretty(occRaw);
  const eduKey = EDU_KEY(row.education_level);
  const [lo, hi] = g === 'retired' ? cfg.retired_income : g === 'student' ? [400, 1400] : g === 'school_kid' || g === 'home' ? [0, 0] : g === 'none' ? [0, 900] : cfg.income_by_education[eduKey] ?? [2200, 4500];
  const name = /^([A-Z][\p{L}'’.-]+(?: [A-Z][\p{L}'’.-]+){1,2})\b/u.exec(row.persona ?? '')?.[1];
  const hobbies = (() => { try { const a = JSON.parse((row.hobbies_and_interests_list ?? '[]').replace(/'/g, '"')) as string[]; return Array.isArray(a) ? a.slice(0, 3) : []; } catch { return []; } })();
  return {
    key, locale: 'en-US', role, age, gender: /^f/i.test(row.sex) ? 'female' : 'male', education: pretty(eduKey), occupation, work_group: g,
    income_month: Math.round((lo + (hi - lo) * Math.pow(rng.next(), 1.6)) / 50) * 50, marital: pretty(row.marital_status), region: `${row.city}, ${row.state}`,
    life_event: age >= 18 ? pick(rng, cfg.life_events) : '', hobbies, attitude: age >= 16 ? attitudeOf(rng, cfg.attitudes) : undefined, source,
    seed_text: [row.persona, row.professional_persona].filter(Boolean).join(' ').slice(0, 900), seed_name: name,
  };
}

/** 没有网络时的英语区骨架（按内置分布表抽样） */
export function fallbackRowsEn(rng: Rng, n: number): NemotronRow[] {
  const f = enConfig().fallback; const out: NemotronRow[] = [];
  for (let i = 0; i < n; i++) {
    const [a0, a1] = pick(rng, f.age); const age = rng.int(a0, a1); const [city, state] = rng.pick(f.regions).split(', ');
    out.push({ age, sex: rng.bool(0.51) ? 'Female' : 'Male', marital_status: age < 23 ? 'never_married' : pick(rng, f.marital), education_level: pick(rng, f.education), occupation: age > 66 ? 'not_in_workforce' : pick(rng, f.occupation), city, state, persona: '' });
  }
  for (let i = 0; i < Math.round(n * 0.18); i++) { const [city, state] = rng.pick(f.regions).split(', '); out.push({ age: rng.int(6, 17), sex: rng.bool(0.5) ? 'Female' : 'Male', marital_status: 'never_married', education_level: 'less_than_9th', occupation: 'not_in_workforce', city, state, persona: '' }); }
  return out;
}

/**
 * 把抽样到的个人行拼成家庭：已婚的人配一个年龄相近的异性已婚者；适龄的家庭按概率带上数据集里的未成年人；
 * 年轻的未婚者有一部分合租；其余独居。个人的人口学属性原样来自数据集。
 */
export function householdsFromRows(rows: NemotronRow[], rng: Rng, nPeople: number, source: Skeleton['source'] = 'nemotron-usa'): HouseholdPlan[] {
  const cfg = enConfig();
  const adults = rng.shuffle(rows.filter((r) => r.age >= 18 && r.age <= 88));
  const kids = rng.shuffle(rows.filter((r) => r.age >= 6 && r.age <= 17));
  const used = new Set<NemotronRow>(); const out: HouseholdPlan[] = []; let n = 0;
  const take = (pred: (r: NemotronRow) => boolean) => { const r = adults.find((x) => !used.has(x) && pred(x)); if (r) used.add(r); return r; };
  for (const head of adults) {
    if (n >= nPeople) break;
    if (used.has(head)) continue;
    used.add(head);
    const id = `hh_en_${shortHash(`${rng.seed}:${out.length}`, 6)}`; let k = 0; const key = () => `${id}_${k++}`;
    const members: Skeleton[] = [enPerson(cfg, rng, head, 'head', key(), source)]; let type = 'single';
    const fem = /^f/i.test(head.sex);
    if (head.marital_status === 'married_present') {
      const sp = take((r) => r.marital_status === 'married_present' && /^f/i.test(r.sex) !== fem && Math.abs(r.age - head.age) <= 7);
      if (sp) { members.push(enPerson(cfg, rng, { ...sp, city: head.city, state: head.state }, 'spouse', key(), source)); type = 'couple'; }
    } else if (head.marital_status === 'never_married' && head.age < 32 && rng.bool(cfg.roommate_share_never_married_under_32)) {
      const rm = take((r) => r.marital_status === 'never_married' && Math.abs(r.age - head.age) <= 5 && r.age < 34);
      if (rm) { members.push(enPerson(cfg, rng, { ...rm, city: head.city, state: head.state }, 'roommate', key(), source)); type = 'roommates'; }
    }
    // 没结婚但和伴侣同住
    if (type === 'single' && head.age >= 23 && head.age <= 55 && head.marital_status !== 'married_present' && rng.bool(0.22)) {
      const pt = take((r) => r.marital_status !== 'married_present' && r.marital_status !== 'widowed' && /^f/i.test(r.sex) !== fem && Math.abs(r.age - head.age) <= 6 && r.age >= 21);
      if (pt) { members.push(enPerson(cfg, rng, { ...pt, city: head.city, state: head.state }, 'spouse', key(), source)); type = 'couple'; }
    }
    const [k0, k1] = cfg.kids_age_range;
    if (head.age >= k0 && head.age <= k1 && type !== 'roommates' && rng.bool(cfg.kids_by_marital[head.marital_status] ?? 0.05)) {
      const want = rng.bool(0.35) ? 2 : 1;
      for (let i = 0; i < want; i++) { const kid = kids.find((c) => !used.has(c) && head.age - c.age >= 19 && head.age - c.age <= 42); if (!kid) break; used.add(kid); members.push(enPerson(cfg, rng, { ...kid, city: head.city, state: head.state }, 'child', key(), source)); }
      if (members.some((m) => m.role === 'child')) type = type === 'couple' ? 'couple_child' : 'single_parent';
    }
    out.push({ id, locale: 'en-US', type, region: `${head.city}, ${head.state}`, members }); n += members.length;
  }
  // 还住在父母家的年轻人：一部分独居的 18–25 岁未婚者并入年龄合适的夫妻家庭
  for (const solo of out.filter((h) => h.type === 'single' && h.members[0].age <= 25 && /never/.test(h.members[0].marital))) {
    if (!rng.bool(0.5)) continue;
    const kid = solo.members[0];
    const home = out.find((h) => h !== solo && ['couple', 'couple_child'].includes(h.type) && h.members.length < 5 && h.members[0].age - kid.age >= 20 && h.members[0].age - kid.age <= 40);
    if (!home) continue;
    home.members.push({ ...kid, role: 'child', key: `${home.id}_${home.members.length}`, region: home.region }); home.type = 'couple_child';
    out.splice(out.indexOf(solo), 1);
  }
  return out;
}

// ---------------------------------------------------------------- 规则推导：能力、性格、行为倾向
const TECHY: WorkGroup[] = ['tech'];
const eduLevel = (e: string) => (/研究生|graduate/.test(e) ? 4 : /本科|bachelor/.test(e) ? 3 : /大专|associate|some college/.test(e) ? 2 : /高中|中专|high school/.test(e) ? 1 : /在读/.test(e) ? 1 : 0);

export function deriveTraits(sk: Skeleton, rng: Rng) {
  const zh = sk.locale === 'zh-CN'; const a = sk.age; const el = eduLevel(sk.education); const n = (m: number, sd: number) => clamp(rng.normal(m, sd));
  const child = a < 14;
  // 数字素养：年轻、受教育程度高、技术岗更高；同龄人之间仍有很大差异
  const digital = child ? n(0.35 + (a - 6) * 0.04, 0.1) : n(0.62 + el * 0.06 + (a < 30 ? 0.08 : 0) - Math.max(0, a - 25) * 0.011 + (TECHY.includes(sk.work_group) ? 0.12 : 0) - (['outdoor', 'factory', 'service'].includes(sk.work_group) ? 0.06 : 0), 0.11);
  const ai = child ? n(0.15, 0.08) : n(0.32 - Math.max(0, a - 25) * 0.007 + el * 0.07 + (a < 30 ? 0.1 : 0) + (TECHY.includes(sk.work_group) ? 0.22 : 0), 0.15);
  const vision = n(0.96 - Math.max(0, a - 42) * 0.012, 0.07); const hearing = n(0.97 - Math.max(0, a - 55) * 0.012, 0.05);
  const motor = n(child ? 0.6 + (a - 6) * 0.03 : 0.9 - Math.max(0, a - 50) * 0.009, 0.07);
  const reading = Math.round(child ? 90 + (a - 6) * 28 + rng.normal(0, 20) : zh ? clamp(rng.normal(250 + el * 75 - Math.max(0, a - 55) * 4, 60), 90, 900) * 1 : clamp(rng.normal(170 + el * 28 - Math.max(0, a - 60) * 2, 35), 80, 420));
  const O = n(0.52 - Math.max(0, a - 40) * 0.003 + el * 0.02, 0.17); const C = n(0.5 + Math.min(0.12, Math.max(0, a - 25) * 0.004), 0.17); const E = n(0.5, 0.19); const A = n(0.55, 0.17); const N = n(0.47, 0.19);
  const skeptic = sk.attitude?.tag === 'ai_skeptic'; const impatient = sk.attitude?.tag === 'impatient';
  const trust = n(0.5 - Math.max(0, a - 45) * 0.004 + ai * 0.15 - (skeptic ? 0.3 : 0), 0.17);
  const incomeRef = zh ? 8000 : 4200; const rich = clamp(Math.log((sk.income_month + 500) / incomeRef) / 2.2 + 0.5);
  const price = n(0.85 - rich * 0.55 + (sk.attitude?.tag === 'freeloader' ? 0.2 : 0), 0.13);
  const maximizer = rng.bool(0.22 + 0.35 * C + (sk.attitude?.tag === 'nitpicker' ? 0.25 : 0));
  const readsCarefully = rng.bool(0.2 + 0.3 * C + (a > 55 ? 0.15 : 0) - (impatient ? 0.15 : 0) - (a < 25 ? 0.08 : 0));
  const patience = Math.round(clamp((22 + 50 * (A * 0.45 + C * 0.3 + (1 - N) * 0.25) + rng.normal(0, 8) - (impatient ? 22 : 0) - (child ? 12 : 0)) / 100, 0.08, 0.95) * 100);
  const lowTech = digital < 0.4;
  const recovery = lowTech ? (a > 55 ? ['back', 'ask_family', 'give_up'] : ['back', 'retry', 'give_up']) : digital > 0.7 ? ['retry', 'search', 'back', 'rephrase'] : ['retry', 'back', 'give_up'];
  const help = child ? ['ask_family'] : lowTech ? ['ask_family', 'none'] : digital > 0.7 ? ['search_engine', 'help_docs', 'ask_ai'] : ['search_engine', 'ask_family'];
  const voice = lowTech && a > 55 ? (rng.bool(0.55) ? 'voice' : 'mixed') : a < 30 && rng.bool(0.15) ? 'mixed' : 'typing';
  const hungry = n(0.3, 0.12); const tired = n(0.32 + (sk.life_event && /宝宝|baby|住院|hospital/.test(sk.life_event) ? 0.2 : 0), 0.12);
  const segment = a < 10 ? 'child_primary_low' : a < 14 ? 'child_primary_high' : a < 18 ? 'teen' : sk.work_group === 'retired' || a >= 62 ? 'senior' : sk.work_group === 'student' ? 'student'
    : ['office', 'tech'].includes(sk.work_group) ? 'office_worker' : ['medical', 'education'].includes(sk.work_group) ? 'professional' : ['factory', 'outdoor', 'delivery'].includes(sk.work_group) ? 'blue_collar'
      : ['retail', 'food', 'service'].includes(sk.work_group) ? 'service_worker' : sk.work_group === 'freelance' ? 'freelancer' : sk.work_group === 'home' ? 'homemaker' : 'job_seeker';
  const tags = [...(sk.attitude ? [sk.attitude.tag] : []), ...(vision < 0.6 ? ['low_vision'] : []), ...(digital < 0.35 ? ['low_digital'] : []), ...(rich > 0.8 ? ['affluent'] : []), ...(sk.income_month > 0 && rich < 0.25 ? ['tight_budget'] : [])];
  return {
    segment, tags,
    capability: {
      cognition: { reading_speed_cpm: reading, working_memory: r2(n(0.72 - Math.max(0, a - 50) * 0.006 - (child ? 0.15 : 0), 0.1)), ...(child ? { literacy_chars: [300, 800, 1600, 2200, 2600, 3000, 3300, 3500][Math.min(7, a - 6)] } : {}) },
      digital_literacy: r2(digital), ai_familiarity: r2(ai),
      body: { vision: r2(vision), hearing: r2(hearing), motor_precision: r2(motor), hand_dominance: rng.bool(0.1) ? 'left' as const : 'right' as const },
    },
    psychology_numbers: { ocean: { O: r2(O), C: r2(C), E: r2(E), A: r2(A), N: r2(N) }, trust_in_ai: r2(trust), privacy_sensitivity: r2(n(0.5 + Math.max(0, a - 40) * 0.004, 0.18)), risk_preference: r2(n(0.5 - Math.max(0, a - 30) * 0.005, 0.17)), price_sensitivity: r2(price) },
    behavior_policy: {
      decision_style: maximizer ? 'maximizer' as const : 'satisficer' as const, reading: readsCarefully ? 'read' as const : 'scan' as const,
      navigation_habit: (lowTech ? 'back_button' : digital > 0.72 && rng.bool(0.5) ? 'search' : 'navigate') as 'back_button' | 'search' | 'navigate',
      exploration_propensity: r2(clamp(O * 0.55 + digital * 0.35 + rng.normal(0, 0.08))), error_recovery: recovery, help_seeking: help,
      patience_base: clamp(patience, 6, 95), wait_tolerance_s: Math.round(clamp((6 + 16 * (A * 0.5 + (1 - N) * 0.5) - (impatient ? 5 : 0) + rng.normal(0, 2)) / 100, 0.03, 0.4) * 100),
      input_preference: voice as 'typing' | 'voice' | 'mixed', adversarial_traits: sk.attitude?.traits,
    },
    state_defaults: { fatigue: r2(tired), hunger: r2(hungry), mood: r2(clamp(rng.normal(0.15 - N * 0.25 + (sk.life_event && /奖金|bonus|升了职|promoted/.test(sk.life_event) ? 0.2 : 0) - (sk.life_event && /裁员|laid off|分手|breakup|手头很紧|tight/.test(sk.life_event) ? 0.25 : 0), 0.15), -1, 1)), attention: r2(n(0.72 - tired * 0.2, 0.1)), stress: r2(n(0.3 + N * 0.2 + (sk.life_event ? 0.12 : 0), 0.12)) },
    ...(child ? { child_profile: { age_band: (a < 10 ? 'primary_low' : 'primary_high') as 'primary_low' | 'primary_high', dev_stage: zh ? (a < 10 ? '具体运算阶段早期，注意力短' : '具体运算阶段，开始在意同伴') : (a < 10 ? 'early concrete operational, short attention' : 'concrete operational, peer-aware'), literacy_chars: [300, 800, 1600, 2200, 2600, 3000, 3300, 3500][Math.min(7, a - 6)], reward_sensitivity: r2(n(0.75, 0.1)), social_pressure_sensitivity: r2(n(0.55 + (a - 6) * 0.03, 0.1)) } } : {}),
  };
}

// ---------------------------------------------------------------- 关系网
export type RelKind = 'spouse' | 'parent_child' | 'grandparent' | 'roommate' | 'sibling' | 'colleague' | 'classmate' | 'friend' | 'neighbor';
export interface Relation { a: string; b: string; kind: RelKind; strength: number }
export interface Resident { id: string; household_id: string; locale: Locale; role: Role; age: number; work_group: WorkGroup; workplace?: string; home_place?: string; home_unit?: number; segment: string }

export function buildRelations(people: Resident[], rng: Rng): Relation[] {
  const rel = new Map<string, Relation>();
  const add = (a: string, b: string, kind: RelKind, strength: number) => { if (a === b) return; const [x, y] = a < b ? [a, b] : [b, a]; const k = `${x}|${y}`; const old = rel.get(k); if (!old || old.strength < strength) rel.set(k, { a: x, b: y, kind: old && old.strength >= strength ? old.kind : kind, strength: Math.round(strength * 100) / 100 }); };
  const byHh = new Map<string, Resident[]>(); for (const p of people) byHh.set(p.household_id, [...(byHh.get(p.household_id) ?? []), p]);
  for (const hh of byHh.values()) for (const p of hh) for (const q of hh) {
    if (p.id >= q.id) continue;
    const roles = [p.role, q.role].sort().join('+');
    if (roles === 'head+spouse') add(p.id, q.id, 'spouse', 0.95);
    else if (roles === 'child+child') add(p.id, q.id, 'sibling', 0.8);
    else if (roles.includes('child') && roles.includes('grandparent')) add(p.id, q.id, 'grandparent', 0.75);
    else if (roles.includes('child')) add(p.id, q.id, 'parent_child', 0.9);
    else if (roles.includes('grandparent')) add(p.id, q.id, 'parent_child', 0.8);
    else if (roles.includes('roommate')) add(p.id, q.id, 'roommate', 0.6);
  }
  // 同事 / 同学：同一个工作地点里再分成几个人的小组
  const byWork = new Map<string, Resident[]>(); for (const p of people) if (p.workplace && !['home', 'none', 'retired'].includes(p.work_group)) byWork.set(`${p.workplace}|${p.work_group === 'school_kid' ? `kid${Math.floor(p.age / 3)}` : p.work_group}`, [...(byWork.get(`${p.workplace}|${p.work_group === 'school_kid' ? `kid${Math.floor(p.age / 3)}` : p.work_group}`) ?? []), p]);
  for (const [key, group] of byWork) { const g = rng.shuffle(group); for (let i = 0; i < g.length; i += 5) { const team = g.slice(i, i + 5); for (const p of team) for (const q of team) if (p.id < q.id) add(p.id, q.id, key.includes('kid') || p.work_group === 'student' ? 'classmate' : 'colleague', 0.35 + rng.next() * 0.3); } }
  // 邻居：同一栋楼里相邻的住户，弱关系
  const byHome = new Map<string, Resident[]>(); for (const p of people) if (p.home_place) byHome.set(p.home_place, [...(byHome.get(p.home_place) ?? []), p]);
  for (const g of byHome.values()) for (const p of g) for (const q of g) if (p.id < q.id && p.household_id !== q.household_id && Math.abs((p.home_unit ?? 0) - (q.home_unit ?? 0)) <= 1 && rng.bool(0.5)) add(p.id, q.id, 'neighbor', 0.15 + rng.next() * 0.2);
  // 朋友：同语言、年龄相近的人更容易成为朋友（同质性）
  const adults = people.filter((p) => p.age >= 14);
  for (const p of adults) {
    const want = rng.int(1, 3);
    const cands = adults.filter((q) => q.id !== p.id && q.household_id !== p.household_id && q.locale === p.locale && Math.abs(q.age - p.age) <= 9).map((q) => ({ item: q, weight: 1 + (q.segment === p.segment ? 2 : 0) + (Math.abs(q.age - p.age) <= 3 ? 1 : 0) }));
    for (let i = 0; i < want && cands.length; i++) { const q = rng.weighted(cands); add(p.id, q.id, 'friend', 0.4 + rng.next() * 0.4); }
  }
  return [...rel.values()];
}

/** 边际分布（生成后核对人群是否符合目标分布） */
export function marginals(people: Skeleton[]) {
  const share = (f: (p: Skeleton) => string) => { const m: Record<string, number> = {}; for (const p of people) m[f(p)] = (m[f(p)] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round((v / people.length) * 1000) / 1000])); };
  const band = (a: number) => (a < 14 ? '6-13' : a < 18 ? '14-17' : a < 25 ? '18-24' : a < 35 ? '25-34' : a < 45 ? '35-44' : a < 60 ? '45-59' : '60+');
  return { n: people.length, age: share((p) => band(p.age)), gender: share((p) => p.gender), education: share((p) => p.education), work_group: share((p) => p.work_group), locale: share((p) => p.locale) };
}
