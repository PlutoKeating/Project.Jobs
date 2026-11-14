// NATS 主题与消息格式（Node 与 C# 游戏端共用；C# 侧按同名字段解析 JSON）

export const SUBJ = {
  clock: 'jw.clock',
  snapshot: 'jw.snapshot',
  live: (personaId: string) => `jw.persona.${personaId}.live`,
  liveAll: 'jw.persona.*.live',
  say: (personaId: string) => `jw.persona.${personaId}.say`,
  sayAll: 'jw.persona.*.say',
  town: 'jw.town',
  cmdClock: 'jw.cmd.clock',
  cmdEvent: 'jw.cmd.event',
  cmdReplay: 'jw.cmd.replay',
  detail: 'jw.detail',          // 请求/应答：人物详情（游戏面板用）
  ask: 'jw.ask',                // 请求/应答：Session 结束后的追问访谈
} as const;

export const STREAM_LIVE = 'JW_LIVE';
export const KV_BUCKET = 'jobsworld';

export interface ClockMsg { date: string; day: number; minute: number; clock: string; speed: number; paused: boolean; real_ts: number }

export type Mode = 'idle' | 'travel' | 'session' | 'replay' | 'event';

export interface PersonaLive {
  id: string; name: string; locale: 'zh-CN' | 'en-US'; segment: string; kind: string; target_user: boolean;
  occupation: string; age: number; gender: string;
  x: number; y: number; floor: number; facing: 1 | -1; pose: 'stand' | 'sit' | 'lie' | 'walk' | 'ride';
  place_id: string; place_kind: string;
  mode: Mode;
  activity: string; intent?: string;
  prev?: { from: string; to: string; activity: string; place_id: string };
  next?: { from: string; to: string; activity: string; place_id: string; intent?: string };
  /** 正在使用的软件（实时或回放） */
  session?: SessionLive;
  say?: { text: string; tone: 'neutral' | 'happy' | 'confused' | 'angry'; at: number };
  appearance: Appearance;
  visible: boolean;
}

export interface SessionLive {
  id: string; study_id: string; app: string; app_version: string; app_id: string;
  step_idx: number; steps_total?: number; sim_clock?: string;
  monologue?: string; intent?: string; action?: string; decision?: string;
  expectation_violated?: boolean; screenshot_ev?: string; url?: string; title?: string;
  mood?: number; stress?: number; world_place?: string; replay?: boolean; status: string;
}

export interface WorldEvent { id: string; place_id: string; kind: EventCmd['kind']; until: number; date: string; by?: string }
export interface Snapshot { clock: ClockMsg; personas: PersonaLive[]; events: WorldEvent[]; town_version: string; ts: number }

export interface LiveStepMsg { persona_id: string; session: SessionLive; ts: number }
export interface SayMsg { persona_id: string; name: string; text: string; tone: NonNullable<PersonaLive['say']>['tone']; ts: number }

export interface ClockCmd { paused?: boolean; speed?: number; jump_to?: string }
export interface EventCmd { place_id: string; kind: 'weak_network' | 'crowd' | 'rain' | 'power_cut' | 'noise'; minutes?: number; by?: string }
export interface ReplayCmd { session_id: string; speed?: number }

/** Terraria 外观（两个游戏端按同样的字段设置假玩家） */
export interface Appearance {
  hair: number; skinVariant: number;
  hairColor: [number, number, number]; skinColor: [number, number, number]; eyeColor: [number, number, number];
  shirtColor: [number, number, number]; underShirtColor: [number, number, number]; pantsColor: [number, number, number]; shoeColor: [number, number, number];
  /** 时装物品（Terraria 物品 ID，头/身/腿；0 表示无） */
  vanity: [number, number, number];
  /** 手持物品（手机替身） */
  held: number;
}
