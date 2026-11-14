// ===== UAP v0.2：统一动作名、语义、成功标准、观察结构、错误分类、证据（见 docs/SPEC_v0.2.md §10）=====

export type Verb =
  | 'navigate' | 'back' | 'reload' | 'click' | 'long_press' | 'hover' | 'type' | 'key'
  | 'scroll' | 'select' | 'upload' | 'drag' | 'wait'
  | 'speak' | 'show_camera' | 'set_location'            // 模态注入
  | 'switch_away' | 'return' | 'close_tab' | 'lock';    // 打断（由 World Simulator 触发）

export const VERBS: Verb[] = ['navigate', 'back', 'reload', 'click', 'long_press', 'hover', 'type', 'key', 'scroll', 'select', 'upload', 'drag', 'wait', 'speak', 'show_camera', 'set_location', 'switch_away', 'return', 'close_tab', 'lock'];
/** Persona/Operator 可以主动发起的动词；打断类只能由 World Simulator 触发 */
/** navigate 只由系统在会话开始时使用：人物不会自己改网址（禁止技术自救） */
export const PERSONA_VERBS: Verb[] = ['back', 'reload', 'click', 'long_press', 'hover', 'type', 'key', 'scroll', 'select', 'upload', 'drag', 'wait', 'speak', 'show_camera'];

export interface TargetRef {
  by: 'a11y' | 'text' | 'selector' | 'visual' | 'coords' | 'ref';
  value: string;                                         // visual：人物对目标的描述（样子与位置）；selector/coords 仅用于重放
  text?: string;                                         // visual：人物在屏幕上看到的、写在目标上的字（照抄）
  resolved?: {
    selector?: string; bbox?: [number, number, number, number];
    a11y_role?: string; a11y_name?: string; in_perceived_view: boolean;
  };
}

export type CriterionKind = 'url_changed' | 'dom_changed' | 'element_visible' | 'value_equals' | 'network_settled' | 'dialog_opened' | 'viewport_changed' | 'file_attached' | 'content_appeared';

export type Criterion =
  | { kind: 'url_changed' } | { kind: 'dom_changed'; scope?: string }
  | { kind: 'element_visible'; target: TargetRef } | { kind: 'value_equals'; target: TargetRef; value: string }
  | { kind: 'network_settled'; max_ms: number } | { kind: 'dialog_opened' }
  | { kind: 'viewport_changed' } | { kind: 'file_attached'; name: string } | { kind: 'content_appeared'; text: string };

export interface SuccessCriteria { any_of: Criterion[]; all_of?: Criterion[]; within_ms: number }

export interface MotorProfile {
  precision: number; typing_cps: number; typo_rate: number;
  one_handed: boolean; double_tap_risk: number;
}

export interface ActionRequest {
  action_id: string; session_id: string; step_idx: number;
  verb: Verb; target?: TargetRef; args?: Record<string, unknown>;
  intent_text: string;          // Persona 意图原文
  expectation?: string;         // Persona 的预期结果，用于检测「预期违背」
  success: SuccessCriteria; motor: MotorProfile; timeout_ms: number;
  risk_tags?: string[];         // Operator 自报的风险标签（支付/发布/加好友/外发消息/上传人脸）
  injected?: boolean;           // World Simulator 注入的动作
}

export interface NetworkSummary { pending: number; failed: Array<{ url: string; status: number; method?: string }>; slowest_ms: number; requests: number }

export interface Observation {
  obs_id: string; ts: string; url: string; title: string;
  viewport: { w: number; h: number; dpr: number };
  state_id: string;             // 抽象状态哈希（URL 模板 + 关键 DOM 结构），用于覆盖率
  screenshot_ev: string;        // Evidence id（原始截图）
  perceived_ev?: string;        // Evidence id（经感知过滤后 Persona 看到的画面）
  a11y_ev: string;              // Evidence id（a11y 快照）
  visible_text_digest: string;
  console_errors: string[];
  network: NetworkSummary;
  dialogs: string[]; notifications: string[];
  page_visibility: 'visible' | 'hidden';
  elements?: UIElement[];       // 元素几何（执行层仪器；人物看不到）
  scroll?: { y: number; max_y: number };
  is_new_state?: boolean;
}

/**
 * 页面元素的几何与属性。只作为执行层的仪器使用（落点换算、感知滤镜的区域、工程附录），
 * 其中任何文字都不会进入人物的想法；vis_text 是屏幕上实际渲染出来的字（不含 aria / alt / title）。
 */
export interface UIElement {
  ref: string; role: string; name: string; tag: string;
  bbox: [number, number, number, number]; in_viewport: boolean; occluded: boolean;
  selector: string; value?: string; placeholder?: string; disabled?: boolean; checked?: boolean;
  href?: string; vis_text?: string; text_len?: number; font_px?: number; contrast?: number; aria_label?: string; kind: 'interactive' | 'text' | 'heading' | 'image' | 'media';
}

export type Layer = 'product' | 'environment' | 'executor' | 'simulator' | 'policy' | 'injected';

export interface UAPError { code: string; layer: Layer; retryable: boolean; message: string; raw?: unknown }

export type ActionStatus = 'success' | 'no_effect' | 'failed' | 'blocked_by_policy' | 'needs_human';

export interface ActionResult {
  action_id: string;
  status: ActionStatus;
  matched_criteria: string[];  // 实际满足了哪条成功标准
  error?: UAPError;
  started_at: string; ended_at: string; duration_ms: number;
  executor: { name: 'playwright' | 'stagehand' | 'midscene' | string; version: string; model_alias?: string };
  resolved_target?: TargetRef;
  before_obs: string; after_obs: string;                 // Observation id
  effects: { url_changed: boolean; dom_changed: boolean; requests: number; new_dialog: boolean; visible_change?: boolean; visual_ratio?: number };
  evidence_ids: string[];
}

export interface Executor {
  readonly name: string;
  observe(session_id: string): Promise<Observation>;
  act(req: ActionRequest): Promise<ActionResult>;
}

/** §10.2 错误码 → 层 的默认映射 */
export const ERROR_LAYER: Record<string, Layer> = {
  PRODUCT_HTTP_5XX: 'product', PRODUCT_SMALL_TARGET: 'product', SIM_MOTOR_MISS: 'simulator', PRODUCT_HTTP_4XX: 'product', PRODUCT_JS_ERROR: 'product', PRODUCT_UNRESPONSIVE: 'product', PRODUCT_NO_FEEDBACK: 'product', PRODUCT_DEAD_END: 'product',
  ENV_AUTH_EXPIRED: 'environment', ENV_CAPTCHA: 'environment', ENV_BROWSER_CRASH: 'environment', ENV_NETWORK: 'environment',
  EXEC_TARGET_NOT_FOUND: 'executor', EXEC_AMBIGUOUS: 'executor', EXEC_WRONG_TARGET: 'executor', EXEC_INTERCEPTED: 'executor', EXEC_TIMEOUT: 'executor', EXEC_UNSUPPORTED: 'executor',
  SIM_INVALID_INTENT: 'simulator', SIM_LOOP: 'simulator', SIM_STALL: 'simulator', SIM_STATE_INCONSISTENT: 'simulator', SIM_LLM_ERROR: 'simulator',
  POLICY_BLOCKED: 'policy',
  INJECTED_NETWORK: 'injected', INJECTED_INTERRUPT: 'injected',
};

export const makeError = (code: string, message: string, retryable = false, raw?: unknown): UAPError => ({
  code, layer: ERROR_LAYER[code] ?? 'executor', retryable, message, raw,
});
