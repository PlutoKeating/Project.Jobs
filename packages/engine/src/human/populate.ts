// 人口生成：统计骨架（population.ts）→ 规则推导数值 → 模型按家庭写叙事 → 入库 → 住进城里。
// 生成结果可以导出成数据文件随安装包自带（config/population/residents.jsonl），别的机器直接导入，不必再生成。
import { mailDomain } from '../mail/settings.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { configPath, logger, PersonaSpecSchema, Rng, shortHash, z, type PersonaSpec } from '@pux/core';
import { and, eq, getDb, personas } from '@pux/db';
import { gateway } from '@pux/llm';
import { computeLayout, loadTown, saveRelations, settleResidents, allResidents, allHouseholds, workplaceFor, type SettleInput } from '@pux/jobsworld';
import { buildRelations, deriveTraits, enConfig, fallbackRowsEn, householdsFromRows, marginals, sampleHouseholdsZh, type HouseholdPlan, type NemotronRow, type Resident, type Skeleton } from './population.ts';
import { upsertPersona } from './persona.ts';
import { withLeisure } from './leisure.ts';

export const RESIDENTS_FILE = () => configPath('population', 'residents.jsonl');
export interface ResidentRecord { spec: PersonaSpec; household: { id: string; locale: string; type: string; region: string }; skeleton: Skeleton }

/** 从 Nemotron-Personas-USA 随机抽样若干行（公开数据集，CC BY 4.0）；失败时返回空数组，由调用方退回内置分布 */
export async function fetchNemotronRows(n: number, rng: Rng): Promise<NemotronRow[]> {
  const ds = (enConfig() as unknown as { dataset: { id: string; rows_api: string } }).dataset; const out: NemotronRow[] = [];
  const total = 1_000_000;
  for (let i = 0; i < Math.ceil(n / 100) + 2 && out.length < n; i++) {
    const offset = rng.int(0, total - 101);
    try {
      const r = await fetch(`${ds.rows_api}?dataset=${encodeURIComponent(ds.id)}&config=default&split=train&offset=${offset}&length=100`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) { logger.warn({ status: r.status }, 'Nemotron 抽样失败'); continue; }
      const j = await r.json() as { rows: { row: NemotronRow }[] };
      out.push(...j.rows.map((x) => x.row));
    } catch (e) { logger.warn({ err: String((e as Error).message).slice(0, 120) }, 'Nemotron 抽样失败'); }
  }
  return out;
}

const Narrative = z.object({ members: z.array(z.object({
  key: z.string(), name: z.string(), family: z.array(z.string()), social_ties: z.array(z.string()), life_story: z.string(),
  values: z.array(z.string()), beliefs: z.array(z.string()), motivations: z.array(z.string()), domain_knowledge: z.array(z.string()), abandonment_rules: z.array(z.string()),
})) });

const words = (v: number, lo: string, mid: string, hi: string) => (v < 0.34 ? lo : v < 0.67 ? mid : hi);

/** 让模型为一个家庭写叙事：只写名字、生平、家人、看法，不改任何人口学属性和数值 */
async function narrate(hh: HouseholdPlan, traits: Map<string, ReturnType<typeof deriveTraits>>, usedNames: Set<string>) {
  const zh = hh.locale === 'zh-CN';
  const lines = hh.members.map((m) => {
    const t = traits.get(m.key)!; const c = t.capability; const o = t.psychology_numbers.ocean;
    const desc = zh
      ? `用手机的熟练程度${words(c.digital_literacy, '不高', '一般', '很高')}；视力${words(c.body.vision, '不好', '一般', '好')}；性格：${words(o.E, '内向', '不内向也不外向', '外向')}、${words(o.N, '情绪稳定', '情绪一般', '容易焦虑')}、${words(o.C, '随性', '还算有条理', '很有条理')}、${words(o.O, '保守', '不排斥新东西', '爱尝鲜')}；对价格${words(t.psychology_numbers.price_sensitivity, '不太在意', '比较在意', '非常在意')}；对 AI ${words(t.psychology_numbers.trust_in_ai, '不太信任', '半信半疑', '比较信任')}`
      : `comfort with phones: ${words(c.digital_literacy, 'low', 'moderate', 'high')}; eyesight: ${words(c.body.vision, 'poor', 'okay', 'good')}; personality: ${words(o.E, 'introverted', 'neither shy nor outgoing', 'outgoing')}, ${words(o.N, 'calm', 'average nerves', 'anxious')}, ${words(o.C, 'easygoing', 'fairly organized', 'very organized')}, ${words(o.O, 'conventional', 'open enough', 'loves new things')}; price: ${words(t.psychology_numbers.price_sensitivity, 'not a concern', 'matters', 'matters a lot')}; AI: ${words(t.psychology_numbers.trust_in_ai, 'distrusts', 'unsure', 'trusts')}`;
    return `- key=${m.key} | ${zh ? '角色' : 'role'}=${m.role} | ${m.age} | ${m.gender} | ${m.education} | ${m.occupation} | ${zh ? '月收入' : 'monthly income'} ${m.income_month} | ${m.marital}${m.life_event ? ` | ${zh ? '近况' : 'lately'}：${m.life_event}` : ''}${m.hobbies.length ? ` | ${zh ? '爱好' : 'hobbies'}：${m.hobbies.join(zh ? '、' : ', ')}` : ''}${m.attitude ? ` | ${zh ? '脾气' : 'quirk'}：${m.attitude.traits.join('；')}` : ''}\n  ${desc}${m.seed_name ? `\n  name: ${m.seed_name}` : ''}${m.seed_text ? `\n  background: ${m.seed_text.slice(0, 600)}` : ''}`;
  }).join('\n');
  const sys = zh
    ? `你在为一座虚拟城市里的一户人家写人物小传。这户人家生活在「${hh.region}」（家庭类型：${hh.type}）。下面每个人的年龄、性别、学历、职业、收入、性格、能力都已确定，是按真实人口分布抽样得到的，你不能改动，也不要把人写得比给定的更有文化、更会用手机或更有钱。
为每个人写：
- name：符合年龄和地域的中文姓名（同一家人的姓氏要合理；避免「张伟」这类最常见的名字；不要与这些已用名字重复：${[...usedNames].slice(-40).join('、') || '无'}）
- family：从这个人的视角列出家人（同住的人要用他们的名字和关系，例如「妻子李秀梅」；也可以提到不同住的亲人，例如「在老家的母亲」「5 岁的女儿」）
- social_ties：2–3 个生活里的熟人圈子
- life_story：2–3 句具体的生活细节（从哪来、每天在忙什么、和手机/软件打交道时的一个真实习惯或难处），要与给定的近况一致
- values、beliefs、motivations：各 2–3 条，要像这个年龄、这个处境的人会说的话，同一家人之间也要有差别
- domain_knowledge：1–3 项他真正懂的事
- abandonment_rules：0–2 条他用软件时的底线（例如「看到要绑银行卡就退出」）；没有就给空数组
不要出现「测试」「评估」「体验」这类词。`
    : `You are writing short bios for one household in a virtual town. They live in ${hh.region} (household type: ${hh.type}). Each person's age, sex, education, occupation, income, personality and abilities are fixed — they were sampled from real population distributions. Do not change them, and do not make anyone more educated, more tech-savvy or richer than given.
For each person write:
- name: use the given name if one is provided; otherwise a plausible name for their age and background (not one of: ${[...usedNames].slice(-40).join(', ') || 'none'})
- family: family from this person's point of view (people living with them by name and relation, e.g. "wife Maria"; relatives elsewhere are fine too)
- social_ties: 2–3 circles of people they know
- life_story: 2–3 concrete sentences (where they're from, what fills their days, one real habit or struggle with phones/apps), consistent with what's been happening lately
- values, beliefs, motivations: 2–3 each, in words this person would actually use; members of the same household should differ
- domain_knowledge: 1–3 things they truly know
- abandonment_rules: 0–2 personal limits when using apps (e.g. "leaves if asked for a credit card"); empty array if none
Never use words like test, evaluate, usability or feedback.`;
  const r = await gateway().chat('gen_persona', { messages: [{ role: 'system', content: sys }, { role: 'user', content: lines }], schema: Narrative, schemaName: 'household', temperature: 1, retries: 2, tags: { purpose: 'population_narrative' } });
  return r.data.members;
}

function assemble(m: Skeleton, t: ReturnType<typeof deriveTraits>, n: z.infer<typeof Narrative>['members'][number], householdType: string): PersonaSpec {
  const zh = m.locale === 'zh-CN';
  const id = `${zh ? 'zh' : 'en'}_r_${shortHash(m.key, 8)}`;
  const { psychology_numbers, ...rest } = t;
  return withLeisure(PersonaSpecSchema.parse({
    id, kind: m.age < 14 ? 'child' : 'synthetic', locale: m.locale, segment: rest.segment, target_user: false, tags: rest.tags,
    source: m.source === 'census-zh' ? 'population (census skeleton)' : m.source === 'nemotron-usa' ? 'population (Nemotron-Personas-USA, CC BY 4.0)' : 'population (built-in distribution)',
    identity: { name: n.name.trim() || m.seed_name || id, age: m.age, gender: m.gender, region: m.region, city_tier: m.city_tier, education: m.education, occupation: m.occupation, income_band: zh ? `月收入约 ${m.income_month} 元` : `about $${m.income_month} a month`, family: n.family.slice(0, 6), social_ties: n.social_ties.slice(0, 4), life_story: [n.life_story.trim(), m.life_event ? (zh ? `近况：${m.life_event}。` : `Lately: ${m.life_event}.`) : ''].filter(Boolean).join(' ') },
    capability: { ...rest.capability, domain_knowledge: n.domain_knowledge.slice(0, 4) },
    psychology: { ...psychology_numbers, values: n.values.slice(0, 4), beliefs: n.beliefs.slice(0, 4), motivations: n.motivations.slice(0, 4) },
    behavior_policy: { ...rest.behavior_policy, abandonment_rules: n.abandonment_rules.slice(0, 2) },
    state_defaults: rest.state_defaults, ...(rest.child_profile ? { child_profile: rest.child_profile } : {}), prior_knowledge: 'stranger',
  }), { hobbies: m.hobbies, householdType });
}

/**
 * 生成 n 个新居民（约一半中国、一半英语区），写入人物表并住进城里。
 * 人口学属性来自统计分布与数据集，数值由规则推导，模型只写叙事。
 */
export async function generatePopulation(opts: { n: number; seed?: number; zhShare?: number; concurrency?: number; onProgress?: (msg: string) => void }) {
  const rng = new Rng(opts.seed ?? 20261115); const say = opts.onProgress ?? (() => {});
  const nZh = Math.round(opts.n * (opts.zhShare ?? 0.5)); const nEn = opts.n - nZh;
  const plans: HouseholdPlan[] = [];
  if (nZh > 0) plans.push(...sampleHouseholdsZh(rng, nZh));
  if (nEn > 0) {
    let rows = await fetchNemotronRows(Math.max(400, nEn * 5), rng); let source: Skeleton['source'] = 'nemotron-usa';
    if (rows.filter((r) => r.age >= 18).length < nEn) { say('Nemotron 数据集不可用，英语区改用内置分布表'); rows = fallbackRowsEn(rng, nEn * 3); source = 'fallback-en'; }
    plans.push(...householdsFromRows(rows, rng, nEn, source));
  }
  const skeletons = plans.flatMap((h) => h.members);
  say(`家庭 ${plans.length} 户，共 ${skeletons.length} 人；边际分布：${JSON.stringify(marginals(skeletons))}`);
  const traits = new Map(skeletons.map((m) => [m.key, deriveTraits(m, new Rng(parseInt(shortHash(m.key, 7), 16)))]));
  const usedNames = new Set<string>(); const records: ResidentRecord[] = []; const failed: string[] = [];
  const queue = [...plans];
  const work = async () => {
    for (;;) {
      const hh = queue.shift(); if (!hh) return;
      try {
        const story = await narrate(hh, traits, usedNames);
        for (const m of hh.members) {
          const n = story.find((x) => x.key === m.key) ?? story[hh.members.indexOf(m)];
          if (!n) { failed.push(m.key); continue; }
          const spec = assemble(m, traits.get(m.key)!, n, hh.type);
          usedNames.add(spec.identity.name);
          await upsertPersona(spec, spec.source);
          records.push({ spec, household: { id: hh.id, locale: hh.locale, type: hh.type, region: hh.region }, skeleton: { ...m, seed_text: undefined } });
        }
        say(`✓ ${hh.id}（${hh.type}）：${hh.members.length} 人，累计 ${records.length}/${skeletons.length}`);
      } catch (e) { failed.push(hh.id); logger.warn({ hh: hh.id, err: String((e as Error).message).slice(0, 200) }, '家庭叙事生成失败'); }
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 5 }, work));
  const settled = await settleRecords(records);
  return { planned_households: plans.length, people: records.length, failed, marginals: marginals(records.map((r) => r.skeleton)), ...settled };
}

/** 把一批居民记录住进城里：分配住处与工作地点，建立关系网（对已经住下的人是幂等的） */
export async function settleRecords(records: ResidentRecord[]) {
  const layout = computeLayout(loadTown());
  const input: SettleInput[] = records.map((r) => ({ persona_id: r.spec.id, spec: r.spec, household: r.household, role: r.skeleton.role, work_group: r.skeleton.work_group, income_month: r.skeleton.income_month, life_event: r.skeleton.life_event, skeleton: r.skeleton }));
  const s = await settleResidents(layout, input, await mailDomain());
  const res = await allResidents(); const hhs = await allHouseholds();
  const ps = await getDb().select({ id: personas.id, spec: personas.spec }).from(personas).where(eq(personas.active, true));
  const specs = new Map(ps.map((p) => [p.id, p.spec as PersonaSpec]));
  const people: Resident[] = [...res.values()].filter((r) => specs.has(r.persona_id)).map((r) => { const sp = specs.get(r.persona_id)!; const hh = hhs.get(r.household_id); return { id: r.persona_id, household_id: r.household_id, locale: sp.locale, role: r.role as Resident['role'], age: sp.identity.age, work_group: r.work_group as Resident['work_group'], workplace: r.workplace_id ?? undefined, home_place: hh?.home_place_id ?? undefined, home_unit: hh?.home_unit ?? undefined, segment: sp.segment }; });
  const rels = buildRelations(people, new Rng(7));
  await saveRelations(rels);
  return { ...s, relations: rels.length };
}

/** 现有的手写人物（以及之前生成的人物）也住进城里：每人一户，职业大类按描述推断 */
export async function settleExisting() {
  const have = await allResidents();
  const ps = await getDb().select({ id: personas.id, spec: personas.spec }).from(personas).where(and(eq(personas.active, true)));
  const records: ResidentRecord[] = [];
  for (const p of ps) {
    if (have.has(p.id)) continue;
    const s = p.spec as PersonaSpec; const occ = s.identity.occupation; const a = s.identity.age;
    const g = a < 18 ? 'school_kid' : /退休|retired/i.test(occ) || a >= 62 ? 'retired' : /学生|student/i.test(occ) ? 'student' : /自由|freelanc|博主|creator/i.test(occ) ? 'freelance' : /工厂|质检|工人|factory|machin/i.test(occ) ? 'factory' : /老师|教师|teacher/i.test(occ) ? 'education' : /医生|护士|nurse|doctor/i.test(occ) ? 'medical' : /程序|工程师|engineer|developer|产品经理/i.test(occ) ? 'tech' : /店|收银|cashier|retail/i.test(occ) ? 'retail' : /全职|主妇|stay-at-home/i.test(occ) ? 'home' : 'office';
    const income = Number(/(\d{3,6})/.exec((s.identity.income_band ?? '').replace(/,/g, ''))?.[1] ?? (s.locale === 'zh-CN' ? 8000 : 4000)) * (/万/.test(s.identity.income_band ?? '') ? 10 : 1);
    const sk: Skeleton = { key: p.id, locale: s.locale, role: a < 18 ? 'child' : 'head', age: a, gender: s.identity.gender, education: s.identity.education, occupation: occ, work_group: g as Skeleton['work_group'], income_month: Math.min(200_000, income), marital: '', region: s.identity.region, city_tier: s.identity.city_tier, life_event: '', hobbies: [], source: s.locale === 'zh-CN' ? 'census-zh' : 'fallback-en' };
    records.push({ spec: s, household: { id: `hh_${p.id}`, locale: s.locale, type: s.identity.family.length ? 'family' : 'single', region: s.identity.region }, skeleton: sk });
  }
  return records.length ? { added: records.length, ...(await settleRecords(records)) } : { added: 0 };
}

/** 导出当前生成的居民，供随安装包自带 */
export async function exportResidents(file = RESIDENTS_FILE()) {
  const res = await allResidents(); const hhs = await allHouseholds();
  const ps = await getDb().select().from(personas).where(eq(personas.active, true));
  const lines = ps.filter((p) => String(p.source).startsWith('population') && res.has(p.id)).map((p) => { const r = res.get(p.id)!; const hh = hhs.get(r.household_id)!; return JSON.stringify({ spec: p.spec, household: { id: hh.id, locale: hh.locale, type: hh.type, region: hh.region }, skeleton: r.skeleton }); });
  writeFileSync(file, lines.sort().join('\n') + '\n');
  return { file, people: lines.length };
}

/** 导入随包自带的居民（已存在的人物版本会被跳过） */
export async function importResidents(file = RESIDENTS_FILE()) {
  if (!existsSync(file)) return { imported: 0, settled: 0 };
  const records = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as ResidentRecord).map((r) => ({ ...r, spec: withLeisure(PersonaSpecSchema.parse(r.spec), { hobbies: r.skeleton.hobbies, householdType: r.household.type }) }));
  let imported = 0;
  for (const r of records) if (await upsertPersona(r.spec, r.spec.source)) imported++;
  const s = await settleRecords(records);
  return { imported, settled: s.residents, relations: s.relations };
}

/**
 * 给还没有「出门与吃喝玩乐」一层的现有人物补上（之前生成、只在数据库里的居民）：按规则推导，写成新版本。
 * 随包居民与手写人物已经带着这一层，不受影响。
 */
export async function enrichLeisure() {
  const res = await allResidents(); const hhs = await allHouseholds();
  const ps = await getDb().select({ id: personas.id, spec: personas.spec, source: personas.source }).from(personas).where(eq(personas.active, true));
  let added = 0;
  for (const p of ps) {
    const spec = PersonaSpecSchema.parse(p.spec); if (spec.leisure) continue;
    const r = res.get(p.id); const sk = r?.skeleton as Skeleton | undefined;
    if (await upsertPersona(withLeisure(spec, { hobbies: sk?.hobbies, householdType: r ? hhs.get(r.household_id)?.type : undefined }), p.source ?? spec.source)) added++;
  }
  return { added };
}

export { workplaceFor };
