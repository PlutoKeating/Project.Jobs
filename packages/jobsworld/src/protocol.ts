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
  launches: 'jw.launches',      // world → *：已发布的产品与各自的漏斗人数
  launchesGet: 'jw.launches.get', // 请求/应答：此刻的产品与人数（游戏里 /jw launches 用）
  cmdPublish: 'jw.cmd.publish', // 发布一个产品（游戏里 /jw publish 用；网页与命令行走 HTTP）
  cmdPromote: 'jw.cmd.promote', // 调宣发强度 / 暂停 / 结束
  cmdInvite: 'jw.cmd.invite',   // 把手机递给一批人
  cmdLifecycle: 'jw.cmd.lifecycle', // 清零 / 下线一个产品（世界服务先作废进行中的使用，再清库）
  detail: 'jw.detail',          // 请求/应答：人物详情（游戏面板用）
  ask: 'jw.ask',                // 请求/应答：Session 结束后的追问访谈
  chat: 'jw.chat',              // 请求/应答：跟一位居民连续聊天（带他的记忆与此刻的处境）
  notice: 'jw.notice',          // 值得告诉开发者的事：一次使用结束、问题第一次出现、结论写好、需要人介入、修好后的自动验证
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
  /** 需求状态（0–1，mood 为 -1–1）：饿、精力、想跟人说话的程度、压力、心情 */
  needs?: { hunger: number; energy: number; social: number; stress: number; mood: number };
  wallet?: number; currency?: string; household_id?: string;
  /** 此刻手机在不在手边、有没有空看（0–1） */
  phone?: number;
  /** 需求临时改写了日程时的原因：hungry | exhausted | lonely */
  driven_by?: string;
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

/** 已发布的产品在城里的现状（漏斗按人去重；数字是这座城里实际发生的人数） */
export interface LaunchLive { id: string; name: string; tagline: string; intensity: number; status: string; reached: number; noticed: number; interested: number; opened: number; came_back: number; using_now: number; rating: number | null; reviews: number; /** 这个产品排着队、还没开始的使用（不算在用） */ queued?: number }
export interface LaunchesMsg { launches: LaunchLive[]; ts: number }
/** launch_id 可以是发布 id，也可以是产品名 */
export interface PromoteCmd { launch_id: string; intensity?: number; status?: 'live' | 'paused' | 'ended' }
export interface PublishCmd { url: string; name: string; tagline: string }
export interface LifecycleCmd { launch_id: string; action: 'reset' | 'remove'; keep_history?: boolean }
export interface InviteCmd { launch_id: string; persona_ids?: string[]; n?: number; segment?: string; locale?: string; want?: string }

/** 跟居民聊天：history 是这段聊天之前的来回（开发者说的是 user，居民说的是 resident） */
export interface ChatCmd { persona_id: string; message: string; history?: { role: 'user' | 'resident'; text: string }[]; lang?: 'zh' | 'en' }
export interface ChatReply { reply?: string; name?: string; busy?: boolean; error?: string }

/** 值得告诉开发者的事（API 里的推送器订阅它；飞书只是其中一个去处） */
export type NoticeMsg =
  | { kind: 'session_end'; launch_id: string; session_id: string; persona_id: string; outcome: string | null; invited: boolean; ts: number }
  | { kind: 'issue_new'; launch_id: string; issue_id: string; severity: string; title: string; ts: number }
  | { kind: 'report'; launch_id: string; headline: string; verdict: string; people_used: number; ts: number }
  | { kind: 'human'; task_id: string; session_id: string | null; reason: string; ts: number }
  | { kind: 'fix_verify'; launch_id: string; issue_id: string; title: string; url: string; version: number; invited: number; ts: number };
