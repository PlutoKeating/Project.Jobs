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

export interface Me { viewer: boolean; admin: boolean; auth_required: boolean; game_port: number }

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
  prior_knowledge: string;
}
export interface Memory { id: string; app_id: string | null; kind: string; content: string; valence: number; importance: number; sim_day: number; sim_time: string | null; source_session_id: string | null; created_at: string }
export interface PersonaSession { id: string; study_id: string; app: string; app_id: string; version: string; mode: string; status: string; outcome: string | null; steps: number; world: string; revisit_day: number; started_at: string | null; ended_at: string | null }
export interface PersonaDetail {
  id: string; version: string; kind: string; locale: string; segment: string; target_user: boolean; source: string; frozen: boolean; created_at: string;
  spec: PersonaSpec; agenda: { items: AgendaItem[]; home_place_id: string; role: string; source: string; sim_date: string } | null; memories: Memory[]; sessions: PersonaSession[];
  trust: { ai_trust: number; app_trust: Record<string, number>; sim_day: number } | null; live: PersonaLive | null; clock: ClockMsg | null;
  resident: { household_id: string; role: string; work_group: string; workplace_id: string | null; income_month: number; currency: string; wallet: number; life_event: string | null } | null;
  ties: Tie[];
  here: { clock: string; name: string; scenario: string; place_id: string; device: 'phone' | 'computer'; posture: { zh: string; en: string }; needs: Needs; phone_affinity: number; available: boolean; unavailable_reason: string | null; time_left_min: number; companions: { id: string; name: string; kind: string }[] } | null;
}

export interface AppListItem { id: string; name: string; description: string; form: string; versions: number; sessions: number; personas: number; completion: number | null; sus: number | null; issues: { P0: number; P1: number; total: number }; last_run: string | null }
export interface GroupStat { dim: string; key: string; n: number; personas: number; completion: number | null; sus: number | null; again: number | null; sat: number | null; fit: number | null; target: boolean }
export interface Quote { kind: 'rant' | 'praise' | 'interview'; text: string; persona_id: string; session_id: string; step_idx?: number; screenshot_ev?: string; sim_clock?: string; mood?: number; sus?: number | null; q?: string }
export interface IssueRow { id: string; title: string; title_en?: string | null; severity: string; category: string; attribution: string; trust: string; status: string; segments: string[]; sessions: number; recommendation?: string | null; study_id?: string | null; seeded_match?: string | null }
export interface AppReport {
  app: { id: string; name: string; description: string; form: string; versions: { id: string; version: string; url: string; seeded: number }[] };
  overview: { sessions: number; expert_sessions: number; personas: number; studies: number; completion: number | null; sus: number | null; again: number | null; sat: number | null; issues: { P0: number; P1: number; P2: number; P3: number; confirmed: number }; last_run: string | null };
  targets: { segments: string[]; source: string };
  groups: GroupStat[];
  used_by: { id: string; name: string; segment: string; target_user: boolean; sessions: number; completion: number | null; sus: number | null; again: number | null }[];
  issues: IssueRow[];
  trend: { study_id: string; version: string; created_at: string; status: string; sessions: number; completion: number | null; sus: number | null; issues: { P0: number; P1: number; P2: number; P3: number } }[];
  trust: { level: string; recall?: number | null; fpr?: number | null; isolation_warning: boolean };
  quotes: Quote[];
}
export interface Verdict { id: string; created_at: string; basis: string; lang: string; verdict: { headline: string; rating: 'recommend' | 'promising' | 'mixed' | 'not_ready'; summary: string; best_for: string[]; struggles_for: string[]; strengths: string[]; weaknesses: string[]; next_steps: string[] } }

export interface StudyRow { id: string; name: string | null; status: string; app: string; app_id: string; version: string; created_at: string; finished_at: string | null; tokens: number; cost_usd: number; stop_reason: string | null; sessions: number; report: boolean; job: boolean }
export interface SessionRow { id: string; persona_id: string; persona_name: string; world_template_id: string; mode: string; status: string; outcome: string | null; steps_count: number; end_reason: string | null; is_expert_baseline: boolean; revisit_day: number; round: number; started_at: string | null }
export interface StudyDetail { study: { id: string; name: string | null; status: string; status_detail: string | null; tokens: number; cost_usd: number; stop_reason: string | null; isolation_warning: string | null; created_at: string; finished_at: string | null }; app: string; app_id: string; version: string; sessions: SessionRow[]; issues: IssueRow[]; job: { log: string[]; done: boolean; error?: string } | null; report: boolean }
export interface StepRow { idx: number; sim_clock: string | null; monologue: string | null; intent: string | null; decision: string | null; expectation: string | null; expectation_violated: boolean | null; dynamic_state: Record<string, number | string> | null; action: { verb?: string; operator?: { target_description?: string; text?: string } } | null; result: { status?: string; error?: { code: string; layer?: string } } | null; url?: string; title?: string | null; screenshot_ev?: string; place?: string; resources?: { battery_pct?: number; time_left_min?: number } }
export interface SessionDetail {
  session: { id: string; study_id: string; persona_id: string; world_template_id: string; mode: string; status: string; outcome: string | null; end_reason: string | null; steps_count: number; video_ev: string | null; started_at: string | null; ended_at: string | null; revisit_day: number; summary: { objective?: { task_completed?: boolean; expectation_violations?: number; real_seconds?: number } } | null };
  app: { app: string; app_id: string; version: string } | null; persona: { id: string; name: string; occupation: string; age: number; segment: string; locale: string } | null;
  steps: StepRow[]; events: { id: string; step_idx: number; sim_time: string; type: string; source: string; text: string }[];
  interviews: { id: string; kind: string; qa: { q: string; a: string; at: string }[]; questionnaire: { sus_score_simulated?: number; umux_lite_simulated?: number; would_use_again?: boolean } | null }[];
  judgments: { id: string; evaluator_role: string; model_alias: string | null; phase: string | null; scores: Record<string, number>; rationale: string | null }[];
}
export interface AppVersionRow { id: string; app_id: string; app: string; version: string; url: string; seeded: unknown[] | null; spec: string | null }
export interface HumanTask { id: string; session_id: string; study_id: string; reason: string; url: string | null; cdp_url: string | null; status: string; created_at: string }
