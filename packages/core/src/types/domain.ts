import { z } from 'zod';

// ============================================================
// Human Simulation：六层 Human Ontology（§6、§16）
// ============================================================
export const Unit = z.number().min(0).max(1);

export const IdentitySchema = z.object({
  name: z.string(),                       // 虚构姓名
  age: z.number().int().min(4).max(100),
  gender: z.string(),
  region: z.string(),
  city_tier: z.string().optional(),
  education: z.string(),
  occupation: z.string(),
  income_band: z.string().optional(),
  family: z.array(z.string()).default([]),
  social_ties: z.array(z.string()).default([]),
  life_story: z.string(),
});

export const CapabilitySchema = z.object({
  cognition: z.object({
    reading_speed_cpm: z.number().min(20).max(2000),   // 每分钟阅读字数（中文字或英文词）
    working_memory: Unit,
    literacy_chars: z.number().int().optional(),      // 识字量（儿童）
  }),
  digital_literacy: Unit,
  ai_familiarity: Unit,
  body: z.object({ vision: Unit, hearing: Unit, motor_precision: Unit, hand_dominance: z.enum(['left', 'right']).default('right') }),
  domain_knowledge: z.array(z.string()).default([]),
});

export const PsychologySchema = z.object({
  ocean: z.object({ O: Unit, C: Unit, E: Unit, A: Unit, N: Unit }),
  values: z.array(z.string()).default([]),
  beliefs: z.array(z.string()).default([]),
  trust_in_ai: Unit,
  privacy_sensitivity: Unit,
  risk_preference: Unit,
  price_sensitivity: Unit,
  motivations: z.array(z.string()).default([]),
});

export const RecoveryStrategy = z.enum(['retry', 'back', 'rephrase', 'search', 'help', 'ask_family', 'give_up', 'random_click']);
export const HelpTarget = z.enum(['ask_ai', 'help_docs', 'search_engine', 'ask_family', 'none']);

export const BehaviorPolicySchema = z.object({
  decision_style: z.enum(['satisficer', 'maximizer']),
  reading: z.enum(['scan', 'read']),
  navigation_habit: z.enum(['search', 'navigate', 'back_button']).default('navigate'),
  exploration_propensity: Unit,
  error_recovery: z.array(RecoveryStrategy).min(1),
  help_seeking: z.array(HelpTarget).min(1),
  patience_base: z.number().min(5).max(100),
  wait_tolerance_s: z.number().min(2).max(300).default(15),
  abandonment_rules: z.array(z.string()).default([]),
  adversarial_traits: z.array(z.string()).optional(),
  input_preference: z.enum(['typing', 'voice', 'mixed']).default('typing'),
});

export const DynamicStateSchema = z.object({
  fatigue: Unit, hunger: Unit, mood: z.number().min(-1).max(1), attention: Unit, stress: Unit,
});

export const ChildProfileSchema = z.object({
  age_band: z.enum(['preschool', 'primary_low', 'primary_high', 'junior_high']),
  dev_stage: z.string(),
  literacy_chars: z.number().int(),
  reward_sensitivity: Unit,
  social_pressure_sensitivity: Unit,
});

/**
 * 第七层：出门与吃喝玩乐（可选）。依据见 docs/research/README.md（小红书出游与聚餐调研，批次 B20261115-01）。
 * 分两种时间尺度：以小时计的本地活动（下班后、周末、节假日）与以天或周计的异地旅行。
 * 随包居民由规则推导（human/leisure.ts），手写人物手写；sources 记下依据的调研编号（P 帖子 / C 评论 / N 诉求 / R 推荐 / W 避雷）。
 */
export const LeisureSchema = z.object({
  local: z.object({
    activities: z.array(z.string()).default([]),
    hours: z.number().min(0.5).max(16),          // 一次出门大概多久
    per_month: z.number().int().min(0).max(30),  // 一个月出去几次
    with: z.array(z.string()).default([]),        // 多半和谁（空 = 自己）
  }),
  trips: z.object({
    per_year: z.number().int().min(0).max(12),
    days: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
    range: z.enum(['none', 'nearby', 'domestic', 'abroad']),
    with: z.array(z.string()).default([]),
  }),
  group_role: z.enum(['planner', 'co_planner', 'follower', 'solo']),        // 拿主意的 / 一起商量 / 跟着走 / 多半自己去
  voice: z.enum(['speaks_up', 'goes_along', 'withdrawn', 'vetoes_later']),  // 定方案时：提前说 / 都可以 / 被否多了不再提 / 嘴上随便、事后挑
  pace: z.enum(['packed', 'balanced', 'slow']),
  social_battery: Unit,                                                      // 和人一起玩能撑多久（越低越快没电）
  budget: z.enum(['frugal', 'value', 'comfort', 'splurge']),
  split: z.enum(['aa_exact', 'aa_rough', 'take_turns', 'often_pays']),
  transport: z.enum(['walk_bike', 'transit', 'taxi', 'drive']),
  dining: z.object({
    restrictions: z.array(z.string()).default([]),
    choose_by: z.enum(['reviews', 'familiar', 'nearby', 'others']),
    solo_ok: z.boolean(),
    dislikes: z.array(z.string()).default([]),
  }),
  pet_peeves: z.array(z.string()).default([]),   // 和别人一起出去最受不了的
  habits: z.array(z.string()).default([]),       // 吃过亏之后形成的做法
  memories: z.array(z.object({ text: z.string(), valence: z.number().min(-1).max(1), importance: Unit, ago_days: z.number().int().min(1) })).default([]),
  sources: z.array(z.string()).default([]),
});
export type Leisure = z.infer<typeof LeisureSchema>;

export const PersonaKind = z.enum(['hero', 'synthetic', 'expert', 'child']);

export const PersonaSpecSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  kind: PersonaKind,
  locale: z.enum(['zh-CN', 'en-US']),
  segment: z.string(),                      // 人群标签，例如 office_worker / senior / student
  target_user: z.boolean().default(true),   // 目标用户 vs 泛人群
  tags: z.array(z.string()).default([]),
  source: z.string().default('handwritten'),
  identity: IdentitySchema,
  capability: CapabilitySchema,
  psychology: PsychologySchema,
  behavior_policy: BehaviorPolicySchema,
  state_defaults: DynamicStateSchema,
  child_profile: ChildProfileSchema.optional(),
  leisure: LeisureSchema.optional(),
  prior_knowledge: z.enum(['stranger', 'heard_of', 'seen_ads', 'used_before']).default('stranger'),
  test_account: z.object({ username: z.string(), password: z.string() }).optional(),
});
export type PersonaSpec = z.infer<typeof PersonaSpecSchema>;
export type DynamicState = z.infer<typeof DynamicStateSchema> & { patience: number };

export const MemoryKind = z.enum(['episodic', 'belief', 'trust', 'habit', 'commerce']);
export type MemoryKindT = z.infer<typeof MemoryKind>;

// ============================================================
// World Simulation（§7）
// ============================================================
export const ChannelsSchema = z.object({
  hands: z.enum(['both', 'one', 'none']).default('both'),
  eyes: z.enum(['full', 'glance', 'none']).default('full'),
  ears: z.enum(['free', 'busy', 'noisy']).default('free'),
  mouth: z.enum(['free', 'busy', 'quiet_required']).default('free'),
});

export const NetworkProfileSchema = z.object({ down_kbps: z.number(), up_kbps: z.number().default(500), rtt_ms: z.number(), loss: z.number().default(0), offline: z.boolean().default(false) });

export const EffectSchema = z.object({
  world: z.record(z.string(), z.any()).optional(),              // 例如 { place: '出租车', motion: 'vehicle', 'channels.hands': 'one' }
  resources: z.record(z.string(), z.number()).optional(),       // 增量：{ time_left_min: -5, battery_pct: -3 }
  network: NetworkProfileSchema.partial().optional(),
  state: z.record(z.string(), z.number()).optional(),           // Dynamic State 增量
  constraints_add: z.array(z.string()).optional(),
  constraints_remove: z.array(z.string()).optional(),
  social_request: z.object({ from: z.string(), text: z.string(), urgency: Unit.default(0.5) }).optional(),
  interrupt: z.object({ kind: z.enum(['switch_away', 'lock', 'close_tab']), minutes: z.number() }).optional(),
  memory_cue: z.string().optional(),                            // 触发 Persona 记忆联想
  perceived_text: z.string().optional(),
  ends_session: z.boolean().optional(),
});

export const TimelineEntrySchema = z.object({
  at: z.string(),                    // HH:MM（模拟时钟）
  type: z.string(),
  text: z.string(),
  caused_by: z.string().optional(),  // 引用另一条 timeline/rule 的 type，形成因果链
  effects: EffectSchema.default({}),
  perceived: z.boolean().default(true),
});

export const EventRuleSchema = z.object({
  id: z.string(),
  type: z.string(),
  text: z.string(),
  when: z.string().default('true'),     // 简单条件表达式，例如 "motion == 'vehicle' && clock >= '08:00'"
  prob_per_min: z.number().min(0).max(1),
  once: z.boolean().default(true),
  caused_by: z.string().optional(),
  source: z.enum(['rule', 'random', 'social']).default('rule'),
  effects: EffectSchema.default({}),
});

export const SocialActorSchema = z.object({
  id: z.string(), relation: z.string(), name: z.string(),
  pressure: Unit.default(0.5),
  requests: z.array(z.object({ at: z.string(), text: z.string(), urgency: Unit.default(0.5), caused_by: z.string().optional(), effects: EffectSchema.default({}) })).default([]),
});

export const WorldTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  name_en: z.string().optional(),
  scenario_class: z.string(),            // 例如 commute / idle_weekend / office / home_evening
  device: z.enum(['phone', 'computer']).optional(),   // 此时此地手边的设备；不写时按场景推断（见 deviceFor）
  modes: z.array(z.enum(['goal', 'curiosity', 'stress', 'adversarial'])).default(['goal', 'curiosity']),
  start_clock: z.string().default('10:00'),
  init: z.object({
    place: z.string(),
    motion: z.enum(['still', 'walking', 'vehicle']).default('still'),
    channels: ChannelsSchema.default({ hands: 'both', eyes: 'full', ears: 'free', mouth: 'free' }),
    time_band: z.string().optional(),
    emotion: z.string().optional(),
    economy: z.string().optional(),
  }),
  resources: z.object({
    time_left_min: z.number().default(60),
    battery_pct: z.number().default(80),
    money: z.number().default(500),
    attention: Unit.default(0.8),
    network: NetworkProfileSchema.default({ down_kbps: 20000, up_kbps: 5000, rtt_ms: 40, loss: 0, offline: false }),
  }).default({ time_left_min: 60, battery_pct: 80, money: 500, attention: 0.8, network: { down_kbps: 20000, up_kbps: 5000, rtt_ms: 40, loss: 0, offline: false } }),
  constraints: z.array(z.string()).default([]),
  timeline: z.array(TimelineEntrySchema).default([]),
  event_rules: z.array(EventRuleSchema).default([]),
  social: z.array(SocialActorSchema).default([]),
  situation: z.string(),                 // 给 Persona 的处境描述（第二人称、生活语言）
  situation_en: z.string().optional(),
  llm_events: z.boolean().default(false),// 允许 world.sim 补充小事件（规则优先）
  matrix: z.boolean().default(false),    // true：初始状态由矩阵初始化器随机生成
});
export type WorldTemplate = z.infer<typeof WorldTemplateSchema>;

/** 这个处境下人手边是手机还是电脑：坐在办公桌或书桌前用电脑，其余时候（路上、沙发、床上、抱着孩子）用手机 */
export function deviceFor(w: Pick<WorldTemplate, 'device' | 'scenario_class' | 'init'>): 'phone' | 'computer' {
  if (w.device) return w.device;
  if (w.init.motion !== 'still' || w.init.channels.hands !== 'both') return 'phone';
  return /office|work|desk|study|办公|工位|书桌|电脑/i.test(`${w.scenario_class} ${w.init.place}`) ? 'computer' : 'phone';
}

export interface Constraint { id: string; kind: 'hard' | 'soft'; rule: string; applies_to: 'operator' | 'perception' | 'session' | 'mind'; params: Record<string, unknown> }

// ============================================================
// Product Intelligence（§9）
// ============================================================
export const SuccessSignalSchema = z.object({
  kind: z.enum(['url_matches', 'text_visible', 'element_visible', 'network_request']),
  value: z.string(),
});

export const ProductSpecSchema = z.object({
  app: z.string(),
  version: z.string(),
  summary: z.string().default(''),
  features: z.array(z.object({
    id: z.string(), name: z.string(), description: z.string().default(''),
    entry_points: z.array(z.string()).default([]),   // URL 路径或入口描述
    url_patterns: z.array(z.string()).default([]),
    source: z.enum(['crawl', 'doc', 'manual']).default('crawl'),
    confirmed: z.boolean().default(false),
  })).default([]),
  tasks: z.array(z.object({
    id: z.string(), statement: z.string(), statement_en: z.string().optional(),
    feature_ids: z.array(z.string()).default([]),
    success_signals: z.array(SuccessSignalSchema).default([]),
    regression: z.boolean().default(false),          // 固定任务：跨版本回归
    requires_login: z.boolean().default(false),
  })).default([]),
  hypotheses: z.array(z.object({
    id: z.string(), statement: z.string(),
    about: z.enum(['ux', 'value', 'ai_quality', 'segment']).default('ux'),
    target_segments: z.array(z.string()).default([]),
  })).default([]),
  test_accounts: z.array(z.object({ username: z.string(), password: z.string(), note: z.string().optional() })).default([]),
  notes: z.string().optional(),
});
export type ProductSpec = z.infer<typeof ProductSpecSchema>;

// ============================================================
// Study（§16）
// ============================================================
export const ModeMixSchema = z.object({ goal: z.number().default(0.4), curiosity: z.number().default(0.25), stress: z.number().default(0.2), adversarial: z.number().default(0.15) });
export type Mode = 'goal' | 'curiosity' | 'stress' | 'adversarial';

export const StudyInputSchema = z.object({
  app_version_id: z.string(),
  name: z.string().optional(),
  trigger: z.enum(['cli', 'console', 'api', 'ci', 'launch']).default('cli'),
  idempotency_key: z.string().optional(),
  mode_mix: ModeMixSchema.default({ goal: 0.4, curiosity: 0.25, stress: 0.2, adversarial: 0.15 }),
  budget: z.object({
    max_sessions: z.number().int().min(1).default(8),
    max_steps_per_session: z.number().int().min(3).default(40),
    max_tokens: z.number().int().default(6_000_000),
    max_tokens_per_session: z.number().int().default(800_000),
    concurrency: z.number().int().min(1).max(16).default(3),
    round_size: z.number().int().min(1).default(4),
  }).default({ max_sessions: 8, max_steps_per_session: 40, max_tokens: 6_000_000, max_tokens_per_session: 800_000, concurrency: 3, round_size: 4 }),
  // 只有 Midscene（看截图定位）。旧数据里的 stagehand 一律按 midscene 读取
  executor: z.preprocess((v) => (v === 'stagehand' ? 'midscene' : v), z.enum(['midscene']).default('midscene')),
  persona_ids: z.array(z.string()).optional(),
  task_keys: z.array(z.string()).optional(),          // 只采样这些任务（ProductSpec 中的 task id，例如 t_export）
  world_ids: z.array(z.string()).optional(),
  locale: z.enum(['zh-CN', 'en-US', 'mixed']).default('zh-CN'),
  include_children: z.boolean().default(false),
  expert_baseline: z.boolean().default(true),
  revisits: z.array(z.number()).default([]),         // 例如 [1,7,30]：留存回访（模拟天数）
  headed: z.boolean().default(false),
  saturation_m: z.number().int().default(4),
  clean_replay: z.boolean().default(true),
  interview: z.boolean().default(true),
  judges: z.number().int().min(1).max(3).default(2),
  report_lang: z.enum(['zh', 'en', 'both']).default('both'),
});
export type StudyInput = z.infer<typeof StudyInputSchema>;

export type SessionOutcome = 'success' | 'gave_up' | 'resource_exhausted' | 'stalled' | 'blocked' | 'sim_error';
export type IssueCategory = 'ux' | 'bug' | 'ai_quality' | 'a11y' | 'value' | 'safety';
export type Attribution = 'product' | 'environment' | 'simulator' | 'uncertain';
export type TrustLevel = 'high' | 'medium' | 'low' | 'unknown';
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
