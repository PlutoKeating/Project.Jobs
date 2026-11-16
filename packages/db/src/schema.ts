// ===== 数据模型（基础实体出自早期设计稿 docs/history/SPEC_v0.2.md §16；居民、发布、模型配置等表是后来加的）=====
// PostgreSQL 为唯一权威数据源；大文件存对象存储（MinIO），由 evidence 统一登记
import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uniqueIndex, vector } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts('created_at').notNull().default(sql`now()`);

// ---- 产品侧（Product Intelligence）----
export const apps = pgTable('apps', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  form: text('form').notNull().default('web'),            // web | h5 | desktop
  stage: text('stage').default('mvp'),
  description: text('description').default(''),
  envs: jsonb('envs').$type<string[]>().default([]),
  created_at: createdAt(),
});

export const appVersions = pgTable('app_versions', {
  id: text('id').primaryKey(),
  app_id: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  version: text('version').notNull(),
  git_sha: text('git_sha'),
  env_url: text('env_url').notNull(),
  seeded_defects: jsonb('seeded_defects').$type<SeededDefect[]>(),
  prd: text('prd'),
  product_spec_path: text('product_spec_path'),
  reset_url: text('reset_url'),                          // 可选：每次 Study 开始前调用以重置测试环境
  created_at: createdAt(),
}, (t) => [uniqueIndex('app_versions_app_version').on(t.app_id, t.version)]);

export interface SeededDefect { id: string; category: string; title: string; description: string; location?: string; keywords?: string[]; severity?: string }

export const features = pgTable('features', {
  id: text('id').primaryKey(),
  app_id: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  app_version_id: text('app_version_id').references(() => appVersions.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  entry_points: jsonb('entry_points').$type<string[]>().default([]),
  url_patterns: jsonb('url_patterns').$type<string[]>().default([]),
  state_ids: jsonb('state_ids').$type<string[]>().default([]),
  source: text('source').notNull().default('crawl'),
  confirmed: boolean('confirmed').notNull().default(false),
});

export const taskDefs = pgTable('task_defs', {
  id: text('id').primaryKey(),
  app_id: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  app_version_id: text('app_version_id').references(() => appVersions.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  feature_ids: jsonb('feature_ids').$type<string[]>().default([]),
  statement: text('statement').notNull(),
  statement_en: text('statement_en'),
  success_signals: jsonb('success_signals').$type<{ kind: string; value: string }[]>().default([]),
  regression: boolean('regression').notNull().default(false),
  requires_login: boolean('requires_login').notNull().default(false),
});

export const hypotheses = pgTable('hypotheses', {
  id: text('id').primaryKey(),
  study_id: text('study_id'),
  app_id: text('app_id').notNull().references(() => apps.id, { onDelete: 'cascade' }),
  key: text('key'),
  statement: text('statement').notNull(),
  about: text('about').notNull().default('ux'),
  target_segments: jsonb('target_segments').$type<string[]>().default([]),
  status: text('status').notNull().default('open'),     // open|supported|refuted|inconclusive
  evidence_ids: jsonb('evidence_ids').$type<string[]>().default([]),
  rationale: text('rationale'),
  created_by: text('created_by').notNull().default('team'),
  created_at: createdAt(),
});

// ---- 人（Human Simulation，六层）----
export const personas = pgTable('personas', {
  id: text('id').notNull(),
  version: text('version').notNull(),                    // 内容哈希；用于 Study 后冻结
  kind: text('kind').notNull(),
  locale: text('locale').notNull(),
  segment: text('segment').notNull(),
  target_user: boolean('target_user').notNull().default(true),
  source: text('source').notNull(),
  spec: jsonb('spec').notNull(),                         // 完整六层 PersonaSpec
  embedding: vector('embedding', { dimensions: 768 }),
  frozen: boolean('frozen').notNull().default(false),
  active: boolean('active').notNull().default(true),
  created_at: createdAt(),
}, (t) => [primaryKey({ columns: [t.id, t.version] })]);

export const personaMemories = pgTable('persona_memories', {
  id: text('id').primaryKey(),
  persona_id: text('persona_id').notNull(),
  app_id: text('app_id'),                                // null = 全局（例如对 AI 产品整体的信任）
  kind: text('kind').notNull(),                          // episodic|belief|trust|habit|commerce
  content: text('content').notNull(),
  valence: real('valence').notNull().default(0),
  importance: real('importance').notNull().default(0.5),
  source_session_id: text('source_session_id'),
  embedding: vector('embedding', { dimensions: 768 }),
  sim_time: text('sim_time'),
  sim_day: integer('sim_day').notNull().default(0),
  created_at: createdAt(),
  last_recalled_at: ts('last_recalled_at'),
  decay: real('decay').notNull().default(1),
}, (t) => [index('pm_persona_app').on(t.persona_id, t.app_id)]);

/** 每个人一棵 ewave 记忆树的快照（@pux/memory 读写；version 用于乐观锁）。旧表 persona_memories 只在首次建树时被读取迁入 */
export const personaMemoryTrees = pgTable('persona_memory_trees', {
  persona_id: text('persona_id').primaryKey(),
  snapshot: jsonb('snapshot').notNull(),
  leaves: integer('leaves').notNull().default(0),
  version: integer('version').notNull().default(1),
  updated_at: ts('updated_at').default(sql`now()`),
});

export const personaGlobalState = pgTable('persona_global_state', {
  persona_id: text('persona_id').primaryKey(),
  ai_trust: real('ai_trust').notNull(),
  app_trust: jsonb('app_trust').$type<Record<string, number>>().default({}),
  // 改变全局信念需要的证据：多次独立经历指向同一方向才会动（一次经历改不了整个人）
  belief_evidence: jsonb('belief_evidence').$type<{ dir: 1 | -1; app_id: string; sim_day: number; session_id: string }[]>().default([]),
  belief_changed_day: integer('belief_changed_day'),
  sim_day: integer('sim_day').notNull().default(0),
  updated_at: ts('updated_at').default(sql`now()`),
});

// ---- 世界（World Simulation）----
export const worldTemplates = pgTable('world_templates', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scenario_class: text('scenario_class').notNull(),
  spec: jsonb('spec').notNull(),
});

export const worldStates = pgTable('world_states', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  step_idx: integer('step_idx').notNull(),
  sim_clock: text('sim_clock').notNull(),
  state: jsonb('state').notNull(),                       // place, motion, channels, resources, social_pending, active_constraints
}, (t) => [uniqueIndex('ws_session_step').on(t.session_id, t.step_idx)]);

export const events = pgTable('events', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  step_idx: integer('step_idx').notNull(),
  sim_time: text('sim_time').notNull(),
  type: text('type').notNull(),
  source: text('source').notNull(),                      // timeline|rule|random|social|product|llm
  caused_by_event_id: text('caused_by_event_id'),
  text: text('text').notNull(),
  effects: jsonb('effects').notNull(),
  perceived: boolean('perceived').notNull().default(true),
  perceived_text: text('perceived_text'),
}, (t) => [index('events_session').on(t.session_id)]);

// ---- 场景与探索 ----
export const goals = pgTable('goals', {
  id: text('id').primaryKey(),
  study_id: text('study_id'),
  kind: text('kind').notNull(),                          // life_goal|task|curiosity|adversarial
  statement_for_persona: text('statement_for_persona').notNull(),
  locale: text('locale').notNull().default('zh-CN'),
  linked_task_ids: jsonb('linked_task_ids').$type<string[]>().default([]),
  linked_hypothesis_ids: jsonb('linked_hypothesis_ids').$type<string[]>().default([]),
  created_at: createdAt(),
});

export const studies = pgTable('studies', {
  id: text('id').primaryKey(),
  app_version_id: text('app_version_id').notNull().references(() => appVersions.id),
  name: text('name'),
  trigger: text('trigger').notNull(),
  config: jsonb('config').notNull(),                     // StudyInput
  status: text('status').notNull().default('created'),   // created|running|evaluating|done|failed|cancelled
  status_detail: text('status_detail'),
  idempotency_key: text('idempotency_key').unique(),
  rng_seed: integer('rng_seed').notNull(),
  workflow_id: text('workflow_id'),
  isolation_warning: text('isolation_warning'),
  tokens: integer('tokens').notNull().default(0),
  cost_usd: doublePrecision('cost_usd').notNull().default(0),
  stop_reason: text('stop_reason'),
  created_at: createdAt(),
  started_at: ts('started_at'),
  finished_at: ts('finished_at'),
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  study_id: text('study_id').notNull().references(() => studies.id, { onDelete: 'cascade' }),
  round: integer('round').notNull().default(0),
  persona_id: text('persona_id').notNull(),
  persona_version: text('persona_version').notNull(),
  world_template_id: text('world_template_id').notNull(),
  goal_id: text('goal_id'),
  mode: text('mode').notNull(),
  is_expert_baseline: boolean('is_expert_baseline').notNull().default(false),
  revisit_day: integer('revisit_day').notNull().default(0),
  plan_priority: real('plan_priority'),
  plan_reason: jsonb('plan_reason'),
  status: text('status').notNull().default('planned'),   // planned|running|waiting_human|finished|evaluated|failed
  outcome: text('outcome'),                              // success|gave_up|resource_exhausted|stalled|blocked|sim_error
  end_reason: text('end_reason'),
  steps_count: integer('steps_count').notNull().default(0),
  rng_seed: integer('rng_seed').notNull(),
  tokens: integer('tokens').notNull().default(0),
  cost_usd: doublePrecision('cost_usd').notNull().default(0),
  executor: text('executor').notNull().default('midscene'),
  path_signature: text('path_signature'),
  video_ev: text('video_ev'),
  har_ev: text('har_ev'),
  rrweb_ev: text('rrweb_ev'),
  summary: jsonb('summary'),                             // 客观指标汇总
  world_context: jsonb('world_context'),                 // 合并世界：开始使用时这个人在城里此时此地的处境（地点、在做什么、设备、需求、身边的人）
  started_at: ts('started_at'),
  ended_at: ts('ended_at'),
}, (t) => [index('sessions_study').on(t.study_id)]);

export const coverage = pgTable('exploration_coverage', {
  id: text('id').primaryKey(),
  app_version_id: text('app_version_id').notNull(),
  dimension: text('dimension').notNull(),                // state|feature|task|segment|scenario|hypothesis|issue|path
  key: text('key').notNull(),
  label: text('label'),
  visits: integer('visits').notNull().default(0),
  used: boolean('used').notNull().default(false),
  sessions: jsonb('sessions').$type<string[]>().default([]),
  last_new_issue_at: ts('last_new_issue_at'),
  saturation: real('saturation').notNull().default(0),
  priority: real('priority').notNull().default(0),
  updated_at: ts('updated_at').default(sql`now()`),
}, (t) => [uniqueIndex('cov_unique').on(t.app_version_id, t.dimension, t.key)]);

// ---- 运行时与证据 ----
export const steps = pgTable('steps', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  idx: integer('idx').notNull(),
  world_state_id: text('world_state_id'),
  observation_id: text('observation_id'),
  perceived_summary: text('perceived_summary'),
  monologue: text('monologue'),
  expectation: text('expectation'),
  expectation_violated: boolean('expectation_violated'),
  dynamic_state: jsonb('dynamic_state'),
  intent: text('intent'),
  decision: text('decision'),                            // act|done|give_up|wait|help
  action_request: jsonb('action_request'),
  action_result: jsonb('action_result'),
  sim_clock: text('sim_clock'),
  real_ms: integer('real_ms'),
  tokens: integer('tokens').notNull().default(0),
  created_at: createdAt(),
}, (t) => [uniqueIndex('steps_session_idx').on(t.session_id, t.idx)]);

export const observations = pgTable('observations', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  step_idx: integer('step_idx').notNull(),
  url: text('url').notNull(),
  title: text('title'),
  state_id: text('state_id').notNull(),
  data: jsonb('data').notNull(),                         // 完整 Observation（不含大文件）
  created_at: createdAt(),
}, (t) => [index('obs_session').on(t.session_id), index('obs_state').on(t.state_id)]);

export const evidence = pgTable('evidence', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),                          // screenshot|perceived_screenshot|a11y|dom|video|har|console|action|monologue|world_event|judge_rationale|replay_result|rrweb|axe|crawl|interview
  storage_ref: text('storage_ref'),
  inline: jsonb('inline'),
  mime: text('mime'),
  hash: text('hash').notNull(),
  bytes: integer('bytes'),
  captured_at: createdAt(),
  study_id: text('study_id'),
  session_id: text('session_id'),
  step_idx: integer('step_idx'),
  persona_id: text('persona_id'),
}, (t) => [index('evidence_session').on(t.session_id), index('evidence_hash').on(t.hash)]);

export const evidenceLinks = pgTable('evidence_links', {
  evidence_id: text('evidence_id').notNull(),
  subject_type: text('subject_type').notNull(),          // issue|judgment|hypothesis|calibration
  subject_id: text('subject_id').notNull(),
  role: text('role').notNull().default('supporting'),    // primary|supporting|counter
}, (t) => [primaryKey({ columns: [t.evidence_id, t.subject_type, t.subject_id] })]);

export const reproPaths = pgTable('repro_paths', {
  id: text('id').primaryKey(),
  issue_id: text('issue_id'),
  candidate_id: text('candidate_id'),
  start_url: text('start_url').notNull(),
  steps: jsonb('steps').notNull(),                       // 规范化 UAP 动作序列
  from_session_ids: jsonb('from_session_ids').$type<string[]>().default([]),
  replay_runs: integer('replay_runs').notNull().default(0),
  replay_ok: integer('replay_ok').notNull().default(0),
  replay_ok_rate: real('replay_ok_rate'),
  last_replay: jsonb('last_replay'),
});

// ---- 评估、问题、校准、报告 ----
export const judgments = pgTable('judgments', {
  id: text('id').primaryKey(),
  study_id: text('study_id'),
  target: text('target').notNull(),                      // step|session|issue|candidate|ai_turn|hypothesis
  target_id: text('target_id').notNull(),
  evaluator_role: text('evaluator_role').notNull(),
  model_alias: text('model_alias'),
  model_family: text('model_family'),
  eval_class: text('eval_class').notNull(),              // objective|simulated_subjective|calibration|ai_quality|attribution
  rubric_version: text('rubric_version').notNull(),
  scores: jsonb('scores').notNull(),
  rationale: text('rationale'),
  rationale_ev: text('rationale_ev'),
  order_swapped: boolean('order_swapped').notNull().default(false),
  phase: text('phase'),                                  // objective_only|with_monologue
  created_at: createdAt(),
}, (t) => [index('judg_target').on(t.target, t.target_id)]);

/** 单个 Session 内的问题候选（归因前） */
export const issueCandidates = pgTable('issue_candidates', {
  id: text('id').primaryKey(),
  study_id: text('study_id').notNull(),
  session_id: text('session_id').notNull(),
  step_idx: integer('step_idx'),
  source: text('source').notNull(),                      // uap_error|expectation_violation|abandon|judge|axe|ai_quality|policy|stall
  track: text('track').notNull().default('experience'),  // experience：虚拟人亲历；engineering：用户看不到的技术信号与专家检查（工程附录）
  title: text('title').notNull(),
  description: text('description'),
  category: text('category').notNull(),
  heuristics: jsonb('heuristics').$type<string[]>().default([]),
  state_id: text('state_id'),
  url: text('url'),
  error_code: text('error_code'),
  error_layer: text('error_layer'),
  attribution: text('attribution'),
  attribution_detail: jsonb('attribution_detail'),
  severity_hint: text('severity_hint'),
  evidence_ids: jsonb('evidence_ids').$type<string[]>().default([]),
  issue_id: text('issue_id'),
  created_at: createdAt(),
}, (t) => [index('cand_study').on(t.study_id)]);

export const issues = pgTable('issues', {
  id: text('id').primaryKey(),
  app_version_id: text('app_version_id').notNull(),
  track: text('track').notNull().default('experience'),  // experience | engineering（见 issue_candidates.track）
  study_id: text('study_id'),
  title: text('title').notNull(),
  title_en: text('title_en'),
  description: text('description'),
  category: text('category').notNull(),
  heuristics: jsonb('heuristics').$type<string[]>().default([]),
  severity: text('severity').notNull(),
  attribution: text('attribution').notNull(),
  affected_segments: jsonb('affected_segments').$type<string[]>().default([]),
  affected_personas: jsonb('affected_personas').$type<string[]>().default([]),
  session_ids: jsonb('session_ids').$type<string[]>().default([]),
  fingerprint: text('fingerprint').notNull(),
  disagreement: real('disagreement'),
  trust_level: text('trust_level').notNull().default('unknown'),
  status: text('status').notNull().default('open'),      // open|folded|confirmed|rejected
  recommendation: text('recommendation'),
  url_pattern: text('url_pattern'),
  repro_path_id: text('repro_path_id'),
  seeded_match: text('seeded_match'),
  embedding: vector('embedding', { dimensions: 768 }),
  created_at: createdAt(),
}, (t) => [index('issues_av').on(t.app_version_id), index('issues_fp').on(t.fingerprint)]);

export const scores = pgTable('scores', {
  id: text('id').primaryKey(),
  study_id: text('study_id').notNull(),
  segment: text('segment').notNull(),
  scenario_class: text('scenario_class').notNull(),
  dimension: text('dimension').notNull(),
  eval_class: text('eval_class').notNull(),
  mean: doublePrecision('mean'), p10: doublePrecision('p10'), p90: doublePrecision('p90'), stdev: doublePrecision('stdev'),
  n: integer('n').notNull(),
  trust_level: text('trust_level').notNull().default('unknown'),
  method: text('method').default('raw'),
});

export const calibrationSets = pgTable('calibration_sets', {
  id: text('id').primaryKey(),
  app_version_id: text('app_version_id'),
  app_id: text('app_id'),
  source: text('source').notNull(),                      // human_benchmark|seeded_defects|reviews|funnel
  name: text('name'),
  items: jsonb('items').notNull(),
  created_at: createdAt(),
});

export const calibrationResults = pgTable('calibration_results', {
  id: text('id').primaryKey(),
  calibration_set_id: text('calibration_set_id').notNull(),
  study_id: text('study_id'),
  app_id: text('app_id'),
  segment: text('segment').notNull().default('*'),
  scenario_class: text('scenario_class').notNull().default('*'),
  dimension: text('dimension').notNull(),
  metric: text('metric').notNull(),                      // issue_recall|false_positive_rate|rank_corr|agreement|bias|unique_findings
  value: doublePrecision('value'),
  ci_low: doublePrecision('ci_low'),
  ci_high: doublePrecision('ci_high'),
  n: integer('n').notNull(),
  method: text('method').notNull(),
  detail: jsonb('detail'),
  computed_at: createdAt(),
  trust_level: text('trust_level').notNull().default('unknown'),
});

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  study_id: text('study_id').notNull(),
  formats: jsonb('formats').$type<string[]>().notNull(),
  sections: jsonb('sections').$type<string[]>().notNull(),
  calibration_card: jsonb('calibration_card'),
  diff_from_report_id: text('diff_from_report_id'),
  paths: jsonb('paths').$type<Record<string, string>>(),
  metrics: jsonb('metrics'),
  created_at: createdAt(),
});

export const interviews = pgTable('interviews', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  kind: text('kind').notNull().default('post_session'),  // post_session|followup
  qa: jsonb('qa').$type<{ q: string; a: string; at: string }[]>().notNull(),
  questionnaire: jsonb('questionnaire'),                 // SUS / UMUX-Lite 模拟估计
  created_at: createdAt(),
});

export const humanTasks = pgTable('human_tasks', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  study_id: text('study_id').notNull(),
  reason: text('reason').notNull(),
  url: text('url'),
  cdp_url: text('cdp_url'),
  status: text('status').notNull().default('pending'),   // pending|resolved|timeout|cancelled
  created_at: createdAt(),
  resolved_at: ts('resolved_at'),
  note: text('note'),
});

export const llmTraces = pgTable('llm_traces', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  alias: text('alias').notNull(),
  model: text('model'),
  family: text('family'),
  study_id: text('study_id'),
  session_id: text('session_id'),
  step_idx: integer('step_idx'),
  purpose: text('purpose'),
  prompt_tokens: integer('prompt_tokens').notNull().default(0),
  completion_tokens: integer('completion_tokens').notNull().default(0),
  reasoning_tokens: integer('reasoning_tokens').notNull().default(0),
  latency_ms: integer('latency_ms').notNull(),
  cost_usd: doublePrecision('cost_usd').notNull().default(0),
  status: text('status').notNull(),                      // ok|error|retry
  error: text('error'),
  config_version: integer('config_version'),             // 这次调用采用的模型配置版本
  target: text('target'),                                // 实际调用的目标（连接 / 上游模型标识）
  cred: text('cred'),                                    // 凭证的脱敏标识（末几位）
  attempt: integer('attempt'),                           // 同一次业务请求里的第几次尝试
  error_class: text('error_class'),                      // auth|not_found|rate_limit|transient|context|capability|content|bad_request
  created_at: createdAt(),
}, (t) => [index('trace_study').on(t.study_id), index('trace_session').on(t.session_id)]);

// ---- 模型接入：多供应商、多凭证、多模型的运行时配置 ----
// 每次发布是一个不可变的完整版本（供应商连接、凭证引用、已选模型、全局顺序）；当前配置 = 版本号最大的那一行
export const llmConfigVersions = pgTable('llm_config_versions', {
  version: integer('version').primaryKey(),
  parent: integer('parent'),
  content: jsonb('content').notNull(),
  digest: text('digest').notNull(),
  submit_id: text('submit_id').unique(),                 // 客户端的提交标识：回执丢了再提交不会重复发布
  author: text('author'),
  note: text('note'),
  created_at: createdAt(),
});

// 凭证正文只在这里（AES-256-GCM 密文，绑定所属连接）；配置版本里只有引用和脱敏提示
export const llmSecrets = pgTable('llm_secrets', {
  id: text('id').primaryKey(),
  provider_id: text('provider_id').notNull(),
  hint: text('hint').notNull(),
  cipher: text('cipher').notNull(),
  created_at: createdAt(),
  revoked_at: ts('revoked_at'),
});

// 各运行实例（世界服务、API…）此刻采用的配置版本，用于在界面上显示生效进度
export const llmInstances = pgTable('llm_instances', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  version: integer('version').notNull(),
  health: jsonb('health'),                               // 这个实例里暂时被跳过的目标与凭证（原因、到什么时候）
  seen_at: ts('seen_at').notNull().default(sql`now()`),
});

// 单目标测试的结果：绑定配置版本、具体凭证、测试的能力
export const llmTests = pgTable('llm_tests', {
  id: text('id').primaryKey(),
  version: integer('version').notNull(),
  target_id: text('target_id').notNull(),
  credential_id: text('credential_id'),
  cred: text('cred'),
  capability: text('capability').notNull(),              // text|vision|json|locate|embed
  ok: boolean('ok').notNull(),
  latency_ms: integer('latency_ms').notNull().default(0),
  error_class: text('error_class'),
  detail: text('detail'),
  created_at: createdAt(),
}, (t) => [index('llm_tests_target').on(t.target_id)]);

export const executorComparisons = pgTable('executor_comparisons', {
  id: text('id').primaryKey(),
  app_version_id: text('app_version_id').notNull(),
  executor: text('executor').notNull(),
  action_set: text('action_set').notNull(),
  results: jsonb('results').notNull(),
  success_rate: real('success_rate'),
  avg_ms: real('avg_ms'),
  failure_layers: jsonb('failure_layers'),
  created_at: createdAt(),
});

// ---- JobsWorld（可视化世界，docs/JOBSWORLD.md）----
/** kind：这段时间在做哪一类事（决定需求怎么变化、手机在不在手边）。见 @pux/jobsworld 的 life.ts */
export interface AgendaItemRow { from: string; to: string; place_id: string; place_kind: string; activity: string; intent?: string; with?: string; kind?: string; override?: string }

/** 人物每个模拟日的日程（模板骨架 + mind.slow 补全） */
export const personaAgendas = pgTable('persona_agendas', {
  persona_id: text('persona_id').notNull(),
  sim_date: text('sim_date').notNull(),                  // YYYY-MM-DD
  home_place_id: text('home_place_id').notNull(),
  home_unit: integer('home_unit').notNull(),
  role: text('role').notNull(),
  items: jsonb('items').$type<AgendaItemRow[]>().notNull(),
  source: text('source').notNull(),                      // skeleton|llm
  created_at: createdAt(),
}, (t) => [primaryKey({ columns: [t.persona_id, t.sim_date] })]);

/** 人物头像（image.gen 生成，存 MinIO） */
export const personaAvatars = pgTable('persona_avatars', {
  persona_id: text('persona_id').primaryKey(),
  storage_ref: text('storage_ref').notNull(),
  mime: text('mime').notNull(),
  source: text('source').notNull(),                      // image_gen
  created_at: createdAt(),
});

/** 软件「一句话总评」缓存（judge.meta 生成） */
export const appVerdicts = pgTable('app_verdicts', {
  id: text('id').primaryKey(),
  app_id: text('app_id').notNull(),
  lang: text('lang').notNull(),
  basis: text('basis').notNull(),                        // 生成时依据的数据指纹（Session 数等），变化后重新生成
  verdict: jsonb('verdict').notNull(),
  created_at: createdAt(),
}, (t) => [index('verdict_app').on(t.app_id)]);

// ============================================================
// 世界里的人（阶段②）：家庭、居民状态、关系网、城里发生的事
// ============================================================
export const households = pgTable('households', {
  id: text('id').primaryKey(),
  locale: text('locale').notNull(),
  type: text('type').notNull(),                          // single|couple|couple_child|three_generation|single_parent|roommates…
  region: text('region').notNull(),
  home_place_id: text('home_place_id'),
  home_unit: integer('home_unit'),
  created_at: createdAt(),
});

export interface NeedsRow { hunger: number; energy: number; social: number; stress: number; mood: number; at: number }

/** 每个住在世界里的人的世界侧状态（人物本身的六层描述在 personas 表） */
export const residents = pgTable('residents', {
  persona_id: text('persona_id').primaryKey(),
  household_id: text('household_id').notNull(),
  role: text('role').notNull(),                          // head|spouse|child|grandparent|roommate
  work_group: text('work_group').notNull(),              // office|tech|factory|medical|education|retail|food|service|delivery|outdoor|freelance|home|student|retired|none|school_kid
  workplace_id: text('workplace_id'),                    // 城里的地点 id；在家或没有固定工作地点时为空
  income_month: real('income_month').notNull().default(0),
  currency: text('currency').notNull().default('CNY'),
  wallet: real('wallet').notNull().default(0),           // 手头的钱（沙箱支付从这里扣）
  needs: jsonb('needs').$type<NeedsRow>(),               // 需求状态；at 是结算到的世界分钟（自 2026-01-01 起）
  life_event: text('life_event'),
  phone: text('phone'),                                  // 世界分配的虚拟手机号
  email: text('email'),                                  // 世界分配的虚拟邮箱
  skeleton: jsonb('skeleton'),                           // 生成时的人口骨架（来源、收入、婚姻、兴趣等）
  updated_at: ts('updated_at').default(sql`now()`),
}, (t) => [index('residents_household').on(t.household_id)]);

export const relations = pgTable('relations', {
  a: text('a').notNull(),
  b: text('b').notNull(),
  kind: text('kind').notNull(),                          // spouse|parent_child|grandparent|sibling|roommate|colleague|classmate|friend|neighbor
  strength: real('strength').notNull().default(0.5),
}, (t) => [primaryKey({ columns: [t.a, t.b] }), index('relations_b').on(t.b)]);

/** 城里发生的事（管理员制造或规则触发）。合并世界后，它们会真的影响正在该地点使用产品的人 */
export const worldEvents = pgTable('world_events', {
  id: text('id').primaryKey(),
  place_id: text('place_id').notNull(),
  kind: text('kind').notNull(),                          // weak_network|crowd|rain|power_cut|noise
  from_min: integer('from_min').notNull(),               // 世界分钟（自 2026-01-01 起）
  until_min: integer('until_min').notNull(),
  by: text('by'),
  created_at: createdAt(),
}, (t) => [index('world_events_until').on(t.until_min)]);

/** 世界服务写入的小状态（时钟等），供不连消息总线的进程读取 */
export const worldKv = pgTable('world_kv', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updated_at: ts('updated_at').default(sql`now()`),
});

// ============================================================
// 发布（阶段③）：把产品发布到世界里，人们自己决定看不看、用不用、跟谁说
// ============================================================
export interface AudienceRow { locales?: string[]; age_min?: number; age_max?: number; segments?: string[]; tags?: string[] }

export const launches = pgTable('launches', {
  id: text('id').primaryKey(),
  app_id: text('app_id').notNull(),
  app_version_id: text('app_version_id').notNull(),
  study_id: text('study_id').notNull(),                  // 内部容器：这次发布产生的所有使用都记在它名下
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),                    // 一句话：商店页、广告上的那句话
  description: text('description'),
  url: text('url').notNull(),                            // 产品地址（打开就是它）
  landing_url: text('landing_url'),                      // 官网或落地页；有的话，从广告和推荐来的人先到这里
  form: text('form').notNull().default('web'),
  icon_ev: text('icon_ev'),                              // 商店图标（截图裁出来的或上传的）
  shot_evs: jsonb('shot_evs').$type<string[]>().default([]),   // 商店页截图
  ad_text: text('ad_text'),                              // 广告文案（不填就用一句话）
  intensity: real('intensity').notNull().default(0.3),   // 宣发强度 0–1：悄悄上线 → 全城铺开
  audience: jsonb('audience').$type<AudienceRow>().default({}),   // 投给谁（空 = 所有人）
  status: text('status').notNull().default('live'),      // live|paused|ended
  published_min: integer('published_min').notNull(),     // 发布时的世界分钟
  spend_usd: doublePrecision('spend_usd').notNull().default(0),
  created_at: createdAt(),
}, (t) => [index('launches_app').on(t.app_id)]);

/** 漏斗的每一步：谁、在哪个渠道、看到了什么、怎么反应 */
export const exposures = pgTable('exposures', {
  id: text('id').primaryKey(),
  launch_id: text('launch_id').notNull(),
  persona_id: text('persona_id').notNull(),
  channel: text('channel').notNull(),                    // store|ad|billboard|feed|word_of_mouth|landing|invite|recall
  source_persona_id: text('source_persona_id'),          // 口碑：是谁说的
  world_min: integer('world_min').notNull(),
  place_id: text('place_id'),
  reaction: text('reaction').notNull(),                  // unnoticed|ignored|not_for_me|curious_later|opened
  thought: text('thought'),                              // 当时心里的一句话
  session_id: text('session_id'),                        // 打开了产品的话，对应的那次使用
  created_at: createdAt(),
}, (t) => [index('exposures_launch').on(t.launch_id), index('exposures_persona').on(t.persona_id)]);

/** 商店里的评分与评论 */
export const storeReviews = pgTable('store_reviews', {
  id: text('id').primaryKey(),
  launch_id: text('launch_id').notNull(),
  persona_id: text('persona_id').notNull(),
  session_id: text('session_id'),
  rating: integer('rating').notNull(),                   // 1–5
  body: text('body').notNull(),
  world_min: integer('world_min').notNull(),
  created_at: createdAt(),
}, (t) => [index('reviews_launch').on(t.launch_id)]);

/** 世界里的社交平台：人们公开发的帖子 */
export const posts = pgTable('posts', {
  id: text('id').primaryKey(),
  persona_id: text('persona_id').notNull(),
  launch_id: text('launch_id'),
  session_id: text('session_id'),
  body: text('body').notNull(),
  sentiment: real('sentiment').notNull().default(0),     // -1..1
  likes: integer('likes').notNull().default(0),
  reply_to: text('reply_to'),
  world_min: integer('world_min').notNull(),
  created_at: createdAt(),
}, (t) => [index('posts_launch').on(t.launch_id), index('posts_time').on(t.world_min)]);

/** 虚拟身份的收件箱：产品发给这个人的邮件和短信（验证码真的收得到） */
export const mailbox = pgTable('mailbox', {
  id: text('id').primaryKey(),
  persona_id: text('persona_id'),                        // 按地址或号码匹配到的人；匹配不到时为空
  kind: text('kind').notNull(),                          // email|sms
  address: text('address').notNull(),                    // 收件地址或手机号
  sender: text('sender'),
  subject: text('subject'),
  body: text('body').notNull(),
  seen: boolean('seen').notNull().default(false),
  created_at: createdAt(),
}, (t) => [index('mailbox_persona').on(t.persona_id), index('mailbox_address').on(t.address)]);

/** 一页人话的结论（按发布缓存；basis 变了就重算） */
export const launchReports = pgTable('launch_reports', {
  launch_id: text('launch_id').notNull(),
  lang: text('lang').notNull(),
  basis: text('basis').notNull(),
  data: jsonb('data').notNull(),
  created_at: createdAt(),
}, (t) => [primaryKey({ columns: [t.launch_id, t.lang] })]);

/** 打算以后再看看的念头（看到了、有点兴趣、当时没空） */
export const intentions = pgTable('intentions', {
  id: text('id').primaryKey(),
  launch_id: text('launch_id').notNull(),
  persona_id: text('persona_id').notNull(),
  kind: text('kind').notNull(),                          // try_later|return
  reason: text('reason'),
  strength: real('strength').notNull().default(0.5),     // 0–1，随时间衰减
  created_min: integer('created_min').notNull(),
  done: boolean('done').notNull().default(false),
}, (t) => [index('intentions_launch').on(t.launch_id)]);

/** 产品的版本点：开发者说「我改好了」的时刻。之后的使用算新版本，问题清单据此分出修复前后 */
export const launchVersions = pgTable('launch_versions', {
  id: text('id').primaryKey(),
  launch_id: text('launch_id').notNull(),
  n: integer('n').notNull(),                             // 第几版（发布时是第 1 版，不落表；第一次标记是第 2 版）
  note: text('note'),                                    // 改了什么
  created_at: createdAt(),
}, (t) => [uniqueIndex('launch_versions_n').on(t.launch_id, t.n)]);

// ---- 远程 MCP 的 OAuth（coding agent 只拿一个链接接入，浏览器里输口令授权）----
/** 动态注册的客户端（Claude Code、Codex、Cursor…各自注册一次）。都是公开客户端（PKCE，无密钥） */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  info: jsonb('info').notNull(),                         // RFC 7591 注册结果（redirect_uris、client_name …）
  created_at: createdAt(),
});

/** 发出去的令牌（只存哈希）。role 来自授权时输入的口令；口令换了，fp 对不上，令牌即失效 */
export const oauthTokens = pgTable('oauth_tokens', {
  hash: text('hash').primaryKey(),
  kind: text('kind').notNull(),                          // access|refresh
  client_id: text('client_id').notNull(),
  grant_id: text('grant_id').notNull(),                  // 一次授权（同一次浏览器登录）发出的全部令牌共享它；撤销按它撤
  role: text('role').notNull(),                          // admin|viewer
  fp: text('fp').notNull(),                              // 授权时那个口令的指纹
  resource: text('resource'),
  expires_at: ts('expires_at').notNull(),
  last_used_at: ts('last_used_at'),
  revoked: boolean('revoked').notNull().default(false),
  created_at: createdAt(),
}, (t) => [index('oauth_tokens_grant').on(t.grant_id)]);
