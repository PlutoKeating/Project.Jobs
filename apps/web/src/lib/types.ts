// 与 packages/jobsworld/src/protocol.ts、town.ts 以及 apps/api 返回结构保持一致
export type RGB = [number, number, number];
export interface Appearance { hair: number; skinVariant: number; hairColor: RGB; skinColor: RGB; eyeColor: RGB; shirtColor: RGB; underShirtColor: RGB; pantsColor: RGB; shoeColor: RGB; vanity: [number, number, number]; held: number }
export interface ClockMsg { date: string; day: number; minute: number; clock: string; speed: number; paused: boolean; real_ts: number }
export interface SessionLive { id: string; study_id: string; app: string; app_version: string; app_id: string; step_idx: number; steps_total?: number; sim_clock?: string; monologue?: string; intent?: string; action?: string; decision?: string; expectation_violated?: boolean; screenshot_ev?: string; url?: string; title?: string; mood?: number; stress?: number; world_place?: string; replay?: boolean; status: string }
export type Tone = 'neutral' | 'happy' | 'confused' | 'angry';
export interface AgendaRef { from: string; to: string; activity: string; place_id: string; intent?: string }
export interface PersonaLive {
  id: string; name: string; locale: 'zh-CN' | 'en-US'; segment: string; kind: string; target_user: boolean; occupation: string; age: number; gender: string;
  x: number; y: number; floor: number; facing: 1 | -1; pose: 'stand' | 'sit' | 'lie' | 'walk' | 'ride'; place_id: string; place_kind: string;
  mode: 'idle' | 'travel' | 'session' | 'replay' | 'event'; activity: string; intent?: string; prev?: AgendaRef; next?: AgendaRef;
  session?: SessionLive; say?: { text: string; tone: Tone; at: number }; appearance: Appearance; visible: boolean;
  needs?: Needs; wallet?: number; currency?: string; household_id?: string; phone?: number; driven_by?: string;
}
export interface Needs { hunger: number; energy: number; social: number; stress: number; mood: number }
export interface Tie { id: string; name: string; kind: string; strength: number; age: number; occupation: string }
export interface WorldEvent { id: string; place_id: string; kind: string; until: number; date: string; by?: string }
export interface Snapshot { clock: ClockMsg; personas: PersonaLive[]; events: WorldEvent[]; town_version: string; ts: number }

export type Prim =
  | { t: 'ground'; x: number; w: number; surface: 'grass' | 'pavement' | 'asphalt' }
  | { t: 'building'; id: string; kind: string; x: number; y: number; w: number; h: number; style: string; floor_h: number; floors: number; roof: 'flat' | 'gable' }
  | { t: 'door'; x: number; y: number }
  | { t: 'window'; x: number; y: number; w: number; h: number }
  | { t: 'furniture'; kind: string; x: number; y: number }
  | { t: 'tree'; x: number; h: number }
  | { t: 'bench'; x: number }
  | { t: 'lamp_post'; x: number }
  | { t: 'pond'; x: number; w: number; d: number }
  | { t: 'tunnel'; x: number; y: number; w: number; h: number }
  | { t: 'hall'; x: number; y: number; w: number; h: number }
  | { t: 'stairs'; x: number; y1: number; y2: number; dir: 1 | -1 }
  | { t: 'platform'; x: number; y: number; w: number }
  | { t: 'train'; x: number; y: number; cars: number; car_w: number }
  | { t: 'bus_shelter'; x: number; w: number }
  | { t: 'sign'; x: number; y: number; text: string; text_en: string };
export interface PlaceLayout { id: string; kind: string; name: { zh: string; en: string }; x: number; w: number; top: number; bottom: number; floors: number; floor_h: number }
export interface TownLayout { id: string; name: { zh: string; en: string }; width: number; ground_depth: number; subway_line: { y: number; h: number }; places: PlaceLayout[]; prims: Prim[]; version: string }

export interface Me { viewer: boolean; admin: boolean; auth_required: boolean; version?: string; game_port: number; models_ready?: boolean }

export interface PersonaListItem {
  id: string; kind: string; locale: string; segment: string; target_user: boolean; source: string; frozen: boolean; name: string; age: number; gender: string; occupation: string; region: string;
  digital_literacy: number; ai_familiarity: number; sessions: number; apps: string[]; last_seen: string | null; memories: number;
  live: { place_id: string; activity: string; mode: string; app?: string } | null;
}
export interface AgendaItem { from: string; to: string; place_id: string; place_kind: string; activity: string; intent?: string; with?: string }
export interface PersonaSpec {
  id: string; kind: string; locale: string; segment: string; target_user: boolean; tags: string[];
  identity: { name: string; age: number; gender: string; region: string; city_tier?: string; education: string; occupation: string; income_band?: string; family: string[]; social_ties: string[]; life_story: string };
  capability: { cognition: { reading_speed_cpm: number; working_memory: number }; digital_literacy: number; ai_familiarity: number; body: { vision: number; hearing: number; motor_precision: number; hand_dominance: string }; domain_knowledge: string[] };
  psychology: { ocean: { O: number; C: number; E: number; A: number; N: number }; values: string[]; beliefs: string[]; trust_in_ai: number; privacy_sensitivity: number; risk_preference: number; price_sensitivity: number; motivations: string[] };
  behavior_policy: { decision_style: string; reading: string; navigation_habit: string; exploration_propensity: number; error_recovery: string[]; help_seeking: string[]; patience_base: number; wait_tolerance_s: number; abandonment_rules: string[]; input_preference: string };
  leisure?: Leisure;
  prior_knowledge: string;
}
/** 出门与吃喝玩乐（人物的第七层，可选） */
export interface Leisure {
  local: { activities: string[]; hours: number; per_month: number; with: string[] };
  trips: { per_year: number; days: [number, number]; range: 'none' | 'nearby' | 'domestic' | 'abroad'; with: string[] };
  group_role: 'planner' | 'co_planner' | 'follower' | 'solo'; voice: 'speaks_up' | 'goes_along' | 'withdrawn' | 'vetoes_later'; pace: 'packed' | 'balanced' | 'slow';
  social_battery: number; budget: 'frugal' | 'value' | 'comfort' | 'splurge'; split: 'aa_exact' | 'aa_rough' | 'take_turns' | 'often_pays'; transport: 'walk_bike' | 'transit' | 'taxi' | 'drive';
  dining: { restrictions: string[]; choose_by: 'reviews' | 'familiar' | 'nearby' | 'others'; solo_ok: boolean; dislikes: string[] };
  pet_peeves: string[]; habits: string[]; memories: { text: string; valence: number; importance: number; ago_days: number }[]; sources: string[];
}
export interface Memory { id: string; app_id: string | null; kind: string; content: string; valence: number; importance: number; sim_day: number; sim_time: string | null; source_session_id: string | null; created_at: string }
export interface PersonaSession { id: string; study_id: string; app: string; app_id: string; version: string; mode: string; status: string; outcome: string | null; steps: number; world: string; revisit_day: number; started_at: string | null; ended_at: string | null }
export interface PersonaDetail {
  id: string; version: string; kind: string; locale: string; segment: string; target_user: boolean; source: string; frozen: boolean; created_at: string;
  launch_of: Record<string, string>;
  spec: PersonaSpec; agenda: { items: AgendaItem[]; home_place_id: string; role: string; source: string; sim_date: string } | null; memories: Memory[]; sessions: PersonaSession[];
  trust: { ai_trust: number; app_trust: Record<string, number>; sim_day: number } | null; live: PersonaLive | null; clock: ClockMsg | null;
  resident: { household_id: string; role: string; work_group: string; workplace_id: string | null; income_month: number; currency: string; wallet: number; life_event: string | null; email?: string | null; phone?: string | null } | null;
  ties: Tie[];
  here: { clock: string; name: string; scenario: string; place_id: string; device: 'phone' | 'computer'; posture: { zh: string; en: string }; needs: Needs; phone_affinity: number; available: boolean; unavailable_reason: string | null; time_left_min: number; companions: { id: string; name: string; kind: string }[] } | null;
}

// ---- 发布 ----
export interface Funnel { reached: number; noticed: number; interested: number; opened: number; came_back: number; using_now: number; queued?: number; sessions: number; reviews: number; rating: number | null; by_channel?: Record<string, { reached: number; opened: number }> }
export interface Audience { locales?: string[]; age_min?: number; age_max?: number; segments?: string[]; tags?: string[] }
export type LaunchStatus = 'live' | 'paused' | 'ended';
export interface Launch { id: string; app_id: string; name: string; tagline: string; description: string | null; url: string; landing_url: string | null; form: string; shots: string[]; ad_text: string | null; intensity: number; audience: Audience; status: LaunchStatus; created_at: string; funnel: Funnel; spend: { usd: number; tokens: number } }
/** WebSocket `launches` 帧里的一行：漏斗人数实时变化 */
export interface LaunchLive { id: string; name: string; tagline: string; intensity: number; status: string; reached: number; noticed: number; interested: number; opened: number; came_back: number; using_now: number; rating: number | null; reviews: number; queued?: number }
export interface Use { session_id: string; persona_id: string; name: string; age: number; occupation: string; segment: string; locale: string; status: string; outcome: string | null; end_reason: string | null; steps: number; started_at: string | null; where: string | null; when: string | null; device: string | null; channel: string | null; invited: boolean; visit: number; come_back: string | null }
export interface PasserbyRow { persona_id: string; name: string; age: number; occupation: string; channel: string; reaction: string; thought: string | null; at: string }
export interface Review { id: string; persona_id: string; name: string; rating: number; body: string; session_id: string | null; at: string }
export interface PostRow { id: string; persona_id: string; name: string; body: string; sentiment: number | null; session_id: string | null; at: string }
export interface LaunchDetail extends Launch { uses: Use[]; passersby: PasserbyRow[]; reviews: Review[]; posts: PostRow[] }
export interface Moment { ref: string; session_id: string; step_idx: number; persona_id: string; persona: string; who: string; quote: string; screenshot_ev?: string; kind: string }
export interface CitedPasserby { ref: string; persona_id: string; persona: string; who: string; channel: string; reaction: string; thought: string }
export interface Cited { text: string; moments: Moment[]; passersby: CitedPasserby[] }
export interface LaunchReport { launch_id: string; lang: string; generated_at: string; verdict: 'works' | 'mixed' | 'not_yet' | 'too_early'; headline: string; summary: string; hurts: Cited[]; delights: Cited[]; who_stays: Cited[]; who_leaves: Cited[]; why_not_opened: Cited[]; next: string; funnel: Funnel; people_used: number; refreshing?: boolean; failed?: { reason: string; at: string } }
export interface Engineering {
  experienced: { id: string; severity: string; title: string; title_en?: string | null; description: string; where: string | null; people: number; sessions: number; reproduced: boolean | null; steps: string[] }[];
  appendix: { id: string; severity: string; category: string; title: string; title_en?: string | null; description: string; recommendation: string | null; where: string | null; sessions: number }[];
}

export interface StepRow { idx: number; sim_clock: string | null; monologue: string | null; intent: string | null; decision: string | null; expectation: string | null; expectation_violated: boolean | null; dynamic_state: Record<string, number | string> | null; action: { verb?: string; operator?: { target_description?: string; text?: string } } | null; result: { status?: string; error?: { code: string; layer?: string } } | null; url?: string; title?: string | null; screenshot_ev?: string; place?: string; resources?: { battery_pct?: number; time_left_min?: number } }
export interface SessionDetail {
  session: { id: string; study_id: string; persona_id: string; world_template_id: string; mode: string; status: string; outcome: string | null; end_reason: string | null; steps_count: number; video_ev: string | null; started_at: string | null; ended_at: string | null; revisit_day: number; summary: { objective?: { task_completed?: boolean; expectation_violations?: number; real_seconds?: number } } | null };
  app: { app: string; app_id: string; version: string } | null; launch: { id: string; name: string } | null; persona: { id: string; name: string; occupation: string; age: number; segment: string; locale: string } | null;
  steps: StepRow[]; events: { id: string; step_idx: number; sim_time: string; type: string; source: string; text: string }[];
  interviews: { id: string; kind: string; qa: { q: string; a: string; at: string }[]; questionnaire: { sus_score_simulated?: number; umux_lite_simulated?: number; would_use_again?: boolean } | null }[];
  judgments: { id: string; evaluator_role: string; model_alias: string | null; phase: string | null; scores: Record<string, number>; rationale: string | null }[];
}
export interface HumanTask { id: string; session_id: string; study_id: string; reason: string; url: string | null; cdp_url: string | null; status: string; created_at: string }

// ---- 模型接入（与 packages/llm/src/config.ts、apps/api/src/models.ts 保持一致）----
export type MUse = 'step' | 'think' | 'locate' | 'chat' | 'embed' | 'image';
export type MKind = 'chat' | 'embed' | 'image';
export interface MCaps { vision: boolean; json: boolean; context?: number; output?: number }
export interface MModel { id: string; model: string; name?: string; kind: MKind; uses: MUse[]; caps: MCaps; cost?: { input: number; output: number } | null; custom?: boolean }
export interface MCred { id: string; label: string; enabled: boolean; hint: string; secret_id: string }
export interface MProvider { id: string; name: string; catalog_id?: string; protocol: 'openai' | 'anthropic' | 'vertex'; base_url: string; enabled: boolean; credentials: MCred[]; models: MModel[] }
export interface MConfig { providers: MProvider[]; order: string[] }
export interface MGcloud { found: boolean; dir?: string; account?: string; project?: string; error?: string; tried: string[]; in_container: boolean; host_dir?: string; mounted: boolean; can_connect: boolean }
export interface MCatalogLite { id: string; name: string; protocol: MProvider['protocol']; base_url: string; credential: 'api_key' | 'google_json'; doc?: string; models: number }
export interface MCatalogModel { id: string; name: string; kind: MKind; caps: MCaps; cost: { input: number; output: number } | null; locate: boolean; released?: string }
export interface MCatalogProvider extends Omit<MCatalogLite, 'models'> { models: MCatalogModel[] }
export interface MTest { target_id: string; capability: string; ok: boolean; version: number; cred: string | null; latency_ms: number; error_class: string | null; detail: string | null; at: string }
export interface MInstance { id: string; kind: string; version: number; health: { key: string; reason: string; until: number }[]; seen_at: string }
export interface MState { version: number; config: MConfig; poll_ms: number; instances: MInstance[]; tests: MTest[]; catalog: { source: string; fetched_at: string; providers: MCatalogLite[] }; ready: boolean; missing: MUse[] }
export interface MRoute { use: MUse; eligible: string[]; skipped: { id: string; reason: string }[] }
export interface MDiff { providers_added: string[]; providers_removed: string[]; models_added: string[]; models_removed: string[]; order_changed: boolean; credentials: { before: number; after: number }; effective: Record<MUse, { before: number; after: number }> }
export interface MPreview { routes: MRoute[]; diff: MDiff | null }
export interface MVersion { version: number; parent: number | null; digest: string; author: string | null; note: string | null; created_at: string; providers: number; models: number }
