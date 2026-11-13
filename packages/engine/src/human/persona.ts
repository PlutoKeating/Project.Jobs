import { configPath, listFiles, loadConfig, logger, PersonaSpecSchema, readYaml, shortHash, stableStringify, type DynamicState, type MotorProfile, type PersonaSpec } from '@pux/core';
import { and, eq, getDb, personas, personaGlobalState, vec } from '@pux/db';
import { gateway } from '@pux/llm';
import { L, langOf } from '@pux/core';

export const personaVersion = (p: PersonaSpec) => `v_${shortHash(stableStringify(p), 10)}`;

/** 从 YAML 目录导入 Persona；内容变化会生成新版本，已用于 Study 的旧版本保持冻结 */
export async function importPersonas(dirs = [configPath('personas')]): Promise<{ imported: number; unchanged: number; errors: string[] }> {
  const db = getDb(); let imported = 0; let unchanged = 0; const errors: string[] = [];
  for (const dir of dirs) {
    for (const file of listFiles(dir, /\.ya?ml$/)) {
      try {
        const spec = PersonaSpecSchema.parse(readYaml(file));
        const r = await upsertPersona(spec, file.includes('/generated/') ? 'generated' : 'handwritten');
        r ? imported++ : unchanged++;
        void db;
      } catch (e) { errors.push(`${file}: ${(e as Error).message.slice(0, 300)}`); }
    }
  }
  return { imported, unchanged, errors };
}

export async function upsertPersona(spec: PersonaSpec, source = spec.source): Promise<boolean> {
  const db = getDb(); const version = personaVersion(spec);
  const exists = await db.select({ id: personas.id }).from(personas).where(and(eq(personas.id, spec.id), eq(personas.version, version)));
  if (exists.length) return false;
  const emb = await gateway().embed(personaText(spec));
  await db.update(personas).set({ active: false }).where(eq(personas.id, spec.id));
  await db.insert(personas).values({ id: spec.id, version, kind: spec.kind, locale: spec.locale, segment: spec.segment, target_user: spec.target_user, source, spec, embedding: emb, active: true });
  await db.insert(personaGlobalState).values({ persona_id: spec.id, ai_trust: spec.psychology.trust_in_ai }).onConflictDoNothing();
  logger.info({ id: spec.id, version }, 'Persona 已导入');
  return true;
}

export async function activePersonas(opts: { includeChildren?: boolean; locale?: string } = {}): Promise<{ spec: PersonaSpec; version: string }[]> {
  const rows = await getDb().select().from(personas).where(eq(personas.active, true));
  const cfg = loadConfig();
  let childOk = !!opts.includeChildren && cfg.safety.child_personas_enabled;
  if (childOk) {
    try { const rb = readYaml<{ reviewed_by?: string | null }>(configPath(cfg.safety.child_rubric_file)); if (!rb.reviewed_by) { logger.warn('儿童安全 rubric 尚未人工审核（reviewed_by 为空），儿童 Persona 不会被采样'); childOk = false; } } catch { childOk = false; }
  }
  return rows
    .map((r) => ({ spec: r.spec as PersonaSpec, version: r.version }))
    .filter((p) => p.spec.kind !== 'child' || childOk)
    .filter((p) => !opts.locale || opts.locale === 'mixed' || p.spec.locale === opts.locale);
}

export async function getPersona(id: string, version?: string): Promise<{ spec: PersonaSpec; version: string } | undefined> {
  const db = getDb();
  const rows = version ? await db.select().from(personas).where(and(eq(personas.id, id), eq(personas.version, version))) : await db.select().from(personas).where(and(eq(personas.id, id), eq(personas.active, true)));
  return rows[0] ? { spec: rows[0].spec as PersonaSpec, version: rows[0].version } : undefined;
}

export async function freezePersona(id: string, version: string) { await getDb().update(personas).set({ frozen: true }).where(and(eq(personas.id, id), eq(personas.version, version))); }

export function personaText(p: PersonaSpec) {
  return `${p.identity.name} ${p.identity.age} ${p.identity.gender} ${p.identity.occupation} ${p.identity.region} ${p.identity.life_story} ${p.psychology.values.join(' ')} ${p.psychology.motivations.join(' ')} ${p.behavior_policy.decision_style} ${p.behavior_policy.reading}`;
}

/** Capability + Constraint → MotorProfile */
export function motorProfile(p: PersonaSpec, constraints: string[] = [], state?: DynamicState): MotorProfile {
  const one = constraints.includes('one_handed');
  const bumpy = constraints.includes('bumpy_ride');
  const fatigue = state?.fatigue ?? p.state_defaults.fatigue;
  let precision = p.capability.body.motor_precision * (one ? 0.85 : 1) * (bumpy ? 0.8 : 1) * (1 - fatigue * 0.15);
  precision = Math.max(0.2, Math.min(0.99, precision));
  const base = 1.5 + p.capability.digital_literacy * 5.5;     // 每秒字符数
  return {
    precision,
    typing_cps: Math.max(0.5, base * (one ? 0.55 : 1) * (bumpy ? 0.8 : 1) * (p.kind === 'child' ? 0.5 : 1)),
    typo_rate: Math.min(0.2, 0.01 + (1 - p.capability.digital_literacy) * 0.05 + (one ? 0.03 : 0) + (bumpy ? 0.03 : 0)),
    one_handed: one,
    double_tap_risk: Math.min(0.2, (1 - p.capability.body.motor_precision) * 0.15 + (bumpy ? 0.05 : 0)),
  };
}

export function initialState(p: PersonaSpec): DynamicState {
  return { ...p.state_defaults, patience: p.behavior_policy.patience_base };
}

/** 第一人称人物描述（Persona Mind 系统提示词使用；不包含任何测试/评估词汇） */
export function personaBio(p: PersonaSpec): string {
  const lang = langOf(p.locale);
  const b = p.behavior_policy; const c = p.capability; const ps = p.psychology;
  const lvl = (v: number, zh: [string, string, string], en: [string, string, string]) => (lang === 'en' ? en : zh)[v < 0.34 ? 0 : v < 0.67 ? 1 : 2];
  if (lang === 'en') {
    return `You are ${p.identity.name}, ${p.identity.age}, ${p.identity.gender}, living in ${p.identity.region}. ${p.identity.occupation}. Education: ${p.identity.education}. Family: ${p.identity.family.join(', ') || 'none'}.
Your life: ${p.identity.life_story}
How you are: comfort with tech is ${lvl(c.digital_literacy, ['', '', ''], ['low', 'moderate', 'high'])}; experience with AI tools is ${lvl(c.ai_familiarity, ['', '', ''], ['little', 'some', 'a lot'])}; eyesight ${lvl(c.body.vision, ['', '', ''], ['poor (small text is hard to read)', 'okay', 'good'])}; you read about ${c.cognition.reading_speed_cpm} words per minute.
What you care about: ${ps.values.join(', ')}. Beliefs: ${ps.beliefs.join('; ') || '—'}. Motivations: ${ps.motivations.join(', ')}. Trust in AI: ${lvl(ps.trust_in_ai, ['', '', ''], ['low', 'medium', 'high'])}. Price sensitivity: ${lvl(ps.price_sensitivity, ['', '', ''], ['low', 'medium', 'high'])}. Privacy concern: ${lvl(ps.privacy_sensitivity, ['', '', ''], ['low', 'medium', 'high'])}.
Your habits: you ${b.decision_style === 'satisficer' ? 'go with the first thing that seems good enough' : 'compare options before deciding'}; you ${b.reading === 'scan' ? 'skim — you mostly notice titles and buttons, not long text' : 'read carefully'}; when lost you usually ${b.navigation_habit === 'search' ? 'look for a search box' : b.navigation_habit === 'back_button' ? 'hit back' : 'browse the menus'}; when something goes wrong you try: ${b.error_recovery.join(' → ')}; you prefer ${b.input_preference === 'voice' ? 'speaking over typing' : b.input_preference === 'mixed' ? 'typing or voice depending on the moment' : 'typing'}.${b.adversarial_traits?.length ? `\nYour quirks: ${b.adversarial_traits.join('; ')}.` : ''}${b.abandonment_rules.length ? `\nYour limits: ${b.abandonment_rules.join('; ')}.` : ''}`;
  }
  return `你是${p.identity.name}，${p.identity.age} 岁，${p.identity.gender}，住在${p.identity.region}。职业：${p.identity.occupation}。学历：${p.identity.education}。家人：${p.identity.family.join('、') || '无'}。
你的生活：${p.identity.life_story}
你的情况：用手机/电脑的熟练程度${lvl(c.digital_literacy, ['不高', '一般', '很高'], ['', '', ''])}；用过 AI 工具的经验${lvl(c.ai_familiarity, ['很少', '有一些', '很多'], ['', '', ''])}；视力${lvl(c.body.vision, ['不好，小字很吃力', '一般', '很好'], ['', '', ''])}；${c.cognition.literacy_chars ? `你大概认识 ${c.cognition.literacy_chars} 个字，不认识的字会看不懂；` : ''}你每分钟大约能读 ${c.cognition.reading_speed_cpm} 个字。
你在乎的：${ps.values.join('、')}。你的看法：${ps.beliefs.join('；') || '—'}。你的动机：${ps.motivations.join('、')}。对 AI 的信任${lvl(ps.trust_in_ai, ['较低', '一般', '较高'], ['', '', ''])}；对价格${lvl(ps.price_sensitivity, ['不太在意', '比较在意', '非常在意'], ['', '', ''])}；对隐私${lvl(ps.privacy_sensitivity, ['不太在意', '有些在意', '非常在意'], ['', '', ''])}。
你的习惯：${b.decision_style === 'satisficer' ? '差不多就行，看到能用的就选' : '喜欢比较，挑最好的'}；${b.reading === 'scan' ? '扫一眼，主要看标题和按钮，长段文字基本不看' : '会认真读完说明'}；找不到东西时通常${b.navigation_habit === 'search' ? '先找搜索框' : b.navigation_habit === 'back_button' ? '先按返回' : '翻菜单找'}；出问题时你会依次：${b.error_recovery.map((x) => ({ retry: '再试一次', back: '返回', rephrase: '换个说法', search: '搜索', help: '找帮助', ask_family: '想找家人问', give_up: '放弃', random_click: '到处点点' })[x]).join(' → ')}；输入时${b.input_preference === 'voice' ? '更喜欢用语音' : b.input_preference === 'mixed' ? '打字和语音都用' : '习惯打字'}。${b.adversarial_traits?.length ? `\n你的脾气：${b.adversarial_traits.join('；')}。` : ''}${b.abandonment_rules.length ? `\n你的底线：${b.abandonment_rules.join('；')}。` : ''}`;
}

export const segmentLabel = (seg: string, lang: 'zh' | 'en' = 'zh') => ({
  office_worker: L(lang, '职场白领', 'Office workers'), senior: L(lang, '老年人', 'Seniors'), student: L(lang, '大学生', 'Students'), skeptic: L(lang, 'AI 怀疑者', 'AI skeptics'),
  freeloader: L(lang, '羊毛党', 'Freeloaders'), busy_parent: L(lang, '忙碌父母', 'Busy parents'), expert: L(lang, '专家对照', 'Expert baseline'),
  child_primary_low: L(lang, '儿童（低年级）', 'Children (6–8)'), child_primary_high: L(lang, '儿童（高年级）', 'Children (9–11)'),
} as Record<string, string>)[seg] ?? seg;

export async function globalTrust(personaId: string) {
  const r = await getDb().select().from(personaGlobalState).where(eq(personaGlobalState.persona_id, personaId));
  return r[0];
}
export { vec };
