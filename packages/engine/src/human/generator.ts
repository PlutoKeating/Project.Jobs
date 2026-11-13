// Persona 生成流水线（§6.4）：① 分布骨架 → ② 种子丰富（PersonaHub）→ ③ 六层补全 + 一致性检查 → ⑤ 差异性筛选（embedding 去重）→ ⑥ 版本冻结（入库）
import { existsSync, readFileSync } from 'node:fs';
import { configPath, dataPath, logger, PersonaSpecSchema, readJson, Rng, shortHash, writeYaml, z, type PersonaSpec } from '@pux/core';
import { eq, getDb, personas } from '@pux/db';
import { cosine, gateway } from '@pux/llm';
import { personaText, upsertPersona } from './persona.ts';

interface Dist { age: { v: [number, number]; w: number }[]; gender: { v: string; w: number }[]; city_tier: { v: string; w: number }[]; education: { v: string; w: number }[]; occupation: { v: string; w: number }[]; regions: string[] }

const pick = <T>(rng: Rng, xs: { v: T; w: number }[]) => rng.weighted(xs.map((x) => ({ item: x.v, weight: x.w })));

function seeds(): string[] {
  const p = dataPath('seeds', 'personahub.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return (JSON.parse(l) as { persona: string }).persona; } catch { return ''; } }).filter(Boolean);
}

/** 简单检索：按职业/年龄关键词与种子文本的字符重叠打分（无需额外 embedding 调用） */
function nearestSeed(all: string[], skeleton: string, rng: Rng): string | undefined {
  if (!all.length) return undefined;
  const words = skeleton.toLowerCase().split(/[\s,，/]+/).filter((w) => w.length > 2);
  let best: string | undefined; let bestScore = -1;
  for (let i = 0; i < 400; i++) { const s = all[rng.int(0, all.length - 1)]; const sc = words.filter((w) => s.toLowerCase().includes(w)).length + rng.next() * 0.5; if (sc > bestScore) { best = s; bestScore = sc; } }
  return best;
}

const GenSchema = PersonaSpecSchema.omit({ id: true, kind: true, locale: true, source: true, test_account: true, child_profile: true });

const CONSISTENCY: { test: (p: PersonaSpec) => boolean; msg: string }[] = [
  { test: (p) => p.capability.digital_literacy < 0.3 && p.behavior_policy.navigation_habit === 'search' && p.behavior_policy.exploration_propensity > 0.7, msg: '低数字素养却高探索且偏好搜索' },
  { test: (p) => p.identity.age >= 65 && p.capability.body.vision > 0.95 && p.capability.cognition.reading_speed_cpm > 700, msg: '高龄但视力与阅读速度都极高' },
  { test: (p) => p.behavior_policy.reading === 'read' && p.capability.cognition.reading_speed_cpm < 80, msg: '细读型但阅读速度极低' },
  { test: (p) => p.psychology.ocean.C > 0.8 && p.behavior_policy.patience_base < 15, msg: '高尽责性却几乎没有耐心' },
  { test: (p) => p.capability.digital_literacy > 0.85 && p.capability.ai_familiarity < 0.05 && p.identity.age < 35, msg: '高数字素养的年轻人对 AI 完全陌生' },
];

export async function generatePersonas(opts: { n: number; locale: 'zh-CN' | 'en-US'; seed?: number; dedupeThreshold?: number; adversarialShare?: number }) {
  const dist = readJson<Dist>(configPath('distributions', `${opts.locale}.json`));
  const rng = new Rng(opts.seed ?? Date.now() % 1e6);
  const allSeeds = seeds();
  const existing = await getDb().select({ id: personas.id, embedding: personas.embedding }).from(personas).where(eq(personas.active, true));
  const embs = existing.map((e) => e.embedding as unknown as number[] | null).filter(Boolean) as number[][];
  const created: string[] = []; const rejected: { reason: string }[] = [];
  const zh = opts.locale === 'zh-CN';
  for (let i = 0; i < opts.n * 3 && created.length < opts.n; i++) {
    // ① 分布骨架
    const [a0, a1] = pick(rng, dist.age); const age = rng.int(a0, a1);
    const sk = { age, gender: pick(rng, dist.gender), city_tier: pick(rng, dist.city_tier), education: pick(rng, dist.education), occupation: age >= 60 && rng.bool(0.7) ? (zh ? '退休' : 'retired') : pick(rng, dist.occupation), region: rng.pick(dist.regions) };
    const adversarial = rng.bool(opts.adversarialShare ?? 0.25);
    // ② 种子
    const seed = nearestSeed(allSeeds, `${sk.occupation} ${age}`, rng);
    // ③ 六层补全
    let spec: PersonaSpec;
    try {
      const r = await gateway().chat('gen_persona', { messages: [{ role: 'system', content: zh ? '你是人物塑造专家。根据人口统计骨架和种子描述，写一个真实、具体、有生活细节的中国人物（虚构姓名），并补全六层人物模型。各数值在 0–1 之间（mood 在 -1–1），reading_speed_cpm 为每分钟阅读汉字数，patience_base 5–100，wait_tolerance_s 2–120。Behavior Policy 必须与能力、心理一致（例如低数字素养不会偏好快捷操作）。segment 从 office_worker, senior, student, skeptic, freeloader, busy_parent 中选最贴近的。' : 'You are a character designer. From the demographic skeleton and seed, write a realistic, specific US person (fictional name) and fill the six-layer persona model. Numeric traits are 0–1 (mood -1..1), reading_speed_cpm is words per minute, patience_base 5–100, wait_tolerance_s 2–120. Behavior policy must be consistent with capability and psychology. segment: one of office_worker, senior, student, skeptic, freeloader, busy_parent.' },
        { role: 'user', content: `${JSON.stringify(sk)}\n${seed ? `${zh ? '种子（改写成本地语境）' : 'Seed'}：${seed}` : ''}\n${adversarial ? (zh ? '这个人带有一些「对抗性」特质（例如怀疑 AI、爱占便宜、爱较真或爱恶作剧），写进 behavior_policy.adversarial_traits，并且来自他的性格与经历。' : 'This person has some adversarial traits (AI skepticism, freeloading, nitpicking or pranking) rooted in their personality; put them in behavior_policy.adversarial_traits.') : ''}` }],
        schema: GenSchema, schemaName: 'persona', temperature: 1, tags: { purpose: 'persona_generation' } });
      spec = PersonaSpecSchema.parse({ ...r.data, id: `${zh ? 'zh' : 'en'}_gen_${shortHash(JSON.stringify(r.data), 8)}`, kind: 'synthetic', locale: opts.locale, source: `generated${seed ? ' (PersonaHub seed)' : ''}`, target_user: r.data.target_user ?? true });
    } catch (e) { rejected.push({ reason: `generation: ${String((e as Error).message).slice(0, 120)}` }); continue; }
    const bad = CONSISTENCY.filter((c) => c.test(spec));
    if (bad.length) { rejected.push({ reason: `inconsistent: ${bad.map((b) => b.msg).join(', ')}` }); continue; }
    // ⑤ embedding 去重
    const emb = await gateway().embed(personaText(spec));
    const maxSim = embs.reduce((m, e) => Math.max(m, cosine(e, emb)), 0);
    if (maxSim > (opts.dedupeThreshold ?? 0.93)) { rejected.push({ reason: `duplicate (cos=${maxSim.toFixed(3)})` }); continue; }
    embs.push(emb);
    const file = dataPath('personas', 'generated', `${spec.id}.yaml`);
    writeYaml(file, spec);
    await upsertPersona(spec, 'generated');
    created.push(spec.id);
    logger.info({ id: spec.id, name: spec.identity.name }, '生成 Persona');
  }
  return { created, rejected };
}

export { z };
