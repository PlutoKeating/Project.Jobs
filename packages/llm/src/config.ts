// 模型配置的数据概念与纯规则：连接、凭证引用、已选模型、全局顺序；候选怎么选、为什么跳过、错误怎么归类。
// 这里不碰数据库和网络，方便测试，也供管理界面的「路由预览」直接复用。

export type Protocol = 'openai' | 'anthropic' | 'vertex';
/** 业务模型组：应用按用途选模型，不依赖上游名称 */
export type Use = 'step' | 'think' | 'locate' | 'embed' | 'image';
export const USES: Use[] = ['step', 'think', 'locate', 'embed', 'image'];
export type ModelKind = 'chat' | 'embed' | 'image';

export interface Caps { vision: boolean; json: boolean; context?: number; output?: number }
export interface ModelEntry {
  /** 调用目标的稳定身份（不随改名、换地址变化） */
  id: string;
  /** 发给上游的模型标识 */
  model: string;
  name?: string;
  kind: ModelKind;
  uses: Use[];
  caps: Caps;
  /** 美元 / 百万 token；目录里没有时为 null（显示「未知」，不当作免费） */
  cost?: { input: number; output: number } | null;
  custom?: boolean;
}
export interface CredentialRef { id: string; label: string; enabled: boolean; hint: string; secret_id: string }
export interface ProviderConn {
  id: string; name: string; catalog_id?: string; protocol: Protocol; base_url: string; enabled: boolean;
  credentials: CredentialRef[]; models: ModelEntry[];
}
export interface LlmConfig { providers: ProviderConn[]; order: string[] }
export const EMPTY_CONFIG: LlmConfig = { providers: [], order: [] };

export interface Target { provider: ProviderConn; model: ModelEntry }
export type SkipReason = 'provider_off' | 'no_credential' | 'not_in_group' | 'no_vision' | 'cooling' | 'wrong_family' | 'wrong_kind';
export interface Health { until: number; reason: ErrorClass }
export type HealthMap = Map<string, Health>;
export interface Needs { vision?: boolean; family?: string }

/** 角色 → 模型组。角色是代码里调用点的名字；管理员只面对模型组 */
const ROLE_USE: Record<string, Use> = {
  mind_fast: 'step', world_sim: 'step', judge_2: 'step', demo: 'step',
  mind_slow: 'think', judge_0: 'think', judge_1: 'think', judge_meta: 'think', interview: 'think', gen_persona: 'think', product_induce: 'think',
  operator_locate: 'locate', embed: 'embed', image_gen: 'image',
};
export const useOfRole = (role: string): Use => ROLE_USE[role] ?? 'think';

/** Midscene 在截图上找位置时按模型家族选提示与坐标格式；认不出家族的模型不能用来定位 */
export function locateFamily(model: string): string | undefined {
  const m = model.toLowerCase();
  if (/ui-?tars/.test(m)) return /doubao/.test(m) ? 'vlm-ui-tars-doubao' : 'vlm-ui-tars';
  if (/gemini/.test(m) && !/embedding|image|tts|nano-banana/.test(m)) return 'gemini';
  if (/doubao.*seed/.test(m)) return 'doubao-seed';
  if (/doubao.*vision/.test(m)) return 'doubao-vision';
  if (/qwen-?3\.5/.test(m)) return 'qwen3.5';
  if (/qwen-?3.*vl|qwen-?vl-(max|plus)/.test(m)) return 'qwen3-vl';
  if (/qwen-?2\.5.*vl/.test(m)) return 'qwen2.5-vl';
  if (/autoglm|auto-glm/.test(m)) return 'auto-glm';
  if (/glm-.*v\b|glm-\d+(\.\d+)?v/.test(m)) return 'glm-v';
  if (/gpt-5/.test(m)) return 'gpt-5';
  return undefined;
}

/** 勾选一个模型时默认让它承担哪些用途（管理员可以再改） */
export function defaultUses(kind: ModelKind, model: string, caps: Caps): Use[] {
  if (kind === 'embed') return ['embed'];
  if (kind === 'image') return ['image'];
  const u: Use[] = ['think'];
  if (caps.vision) { u.unshift('step'); if (locateFamily(model)) u.push('locate'); }
  return u;
}

export const allModels = (c: LlmConfig): Target[] => c.providers.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));

/** 整理一份配置：顺序里补上漏掉的目标、去掉不存在的；检查身份唯一、地址与协议合法。返回整理后的配置，或抛出说明问题的错误 */
export function normalizeConfig(input: LlmConfig): LlmConfig {
  const seen = new Set<string>();
  const uniq = (id: string, what: string) => { if (!id || seen.has(id)) throw new Error(`${what} 的标识重复或为空：${id}`); seen.add(id); };
  const providers = (input.providers ?? []).map((p) => {
    uniq(p.id, '连接');
    if (!['openai', 'anthropic', 'vertex'].includes(p.protocol)) throw new Error(`「${p.name}」的协议不支持：${p.protocol}`);
    let u: URL; try { u = new URL(p.base_url.replace(/\{[a-z_]+\}/g, 'x')); } catch { throw new Error(`「${p.name}」的地址不是合法网址`); }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`「${p.name}」的地址必须是 http 或 https`);
    if (!p.name?.trim()) throw new Error('连接需要名字');
    return {
      id: p.id, name: p.name.trim().slice(0, 80), catalog_id: p.catalog_id, protocol: p.protocol, base_url: p.base_url.trim().replace(/\/+$/, ''), enabled: p.enabled !== false,
      credentials: (p.credentials ?? []).map((c) => { uniq(c.id, '凭证'); if (!c.secret_id) throw new Error(`「${p.name}」有一个凭证没有内容`); return { id: c.id, label: (c.label ?? '').slice(0, 60), enabled: c.enabled !== false, hint: c.hint ?? '', secret_id: c.secret_id }; }),
      models: (p.models ?? []).map((m) => {
        uniq(m.id, '模型'); if (!m.model?.trim()) throw new Error(`「${p.name}」有一个模型没有标识`);
        const kind: ModelKind = ['chat', 'embed', 'image'].includes(m.kind) ? m.kind : 'chat';
        const caps: Caps = { vision: !!m.caps?.vision, json: !!m.caps?.json, context: m.caps?.context, output: m.caps?.output };
        const uses = [...new Set((m.uses ?? []).filter((x) => USES.includes(x)))].filter((x) => (kind === 'embed' ? x === 'embed' : kind === 'image' ? x === 'image' : x !== 'embed' && x !== 'image'));
        // 每一步与定位都要看图；定位还要认得出模型家族（否则不知道该用哪种坐标格式）
        const usable = uses.filter((x) => (x === 'step' ? caps.vision : x === 'locate' ? caps.vision && !!locateFamily(m.model) : true));
        return { id: m.id, model: m.model.trim(), name: m.name?.slice(0, 80), kind, uses: usable, caps, cost: m.cost && Number.isFinite(m.cost.input) ? { input: m.cost.input, output: m.cost.output ?? 0 } : null, custom: !!m.custom };
      }),
    } satisfies ProviderConn;
  });
  const ids = new Set(providers.flatMap((p) => p.models.map((m) => m.id)));
  const order = [...new Set((input.order ?? []).filter((id) => ids.has(id)))];
  for (const id of ids) if (!order.includes(id)) order.push(id);
  return { providers, order };
}

/**
 * 这次请求按什么顺序试哪些目标，以及每个被跳过的目标为什么被跳过。
 * 顺序只有一套：全局模型顺序。被跳过的目标保留位置，恢复后回到原位。
 */
export function candidates(cfg: LlmConfig, use: Use, needs: Needs = {}, health: HealthMap = new Map(), now = Date.now()): { eligible: Target[]; skipped: { target: Target; reason: SkipReason }[] } {
  const byId = new Map(allModels(cfg).map((t) => [t.model.id, t]));
  const eligible: Target[] = []; const skipped: { target: Target; reason: SkipReason }[] = [];
  for (const id of cfg.order) {
    const t = byId.get(id); if (!t) continue;
    const reason = skipReason(t, use, needs, health, now);
    if (reason) skipped.push({ target: t, reason }); else eligible.push(t);
  }
  return { eligible, skipped };
}

export function skipReason(t: Target, use: Use, needs: Needs, health: HealthMap, now: number): SkipReason | undefined {
  const wantKind: ModelKind = use === 'embed' ? 'embed' : use === 'image' ? 'image' : 'chat';
  if (t.model.kind !== wantKind) return 'wrong_kind';
  if (!t.model.uses.includes(use)) return 'not_in_group';
  if (!t.provider.enabled) return 'provider_off';
  if (!usableCredentials(t.provider, health, now).length) return t.provider.credentials.some((c) => c.enabled) ? 'cooling' : 'no_credential';
  if ((needs.vision || use === 'step' || use === 'locate') && !t.model.caps.vision) return 'no_vision';
  if (use === 'locate' && needs.family && locateFamily(t.model.model) !== needs.family) return 'wrong_family';
  if (cooling(health, `t:${t.model.id}`, now)) return 'cooling';
  return undefined;
}

export const cooling = (h: HealthMap, key: string, now: number) => { const x = h.get(key); return !!x && x.until > now; };
export const usableCredentials = (p: ProviderConn, h: HealthMap, now: number) => p.credentials.filter((c) => c.enabled && !cooling(h, `c:${c.id}`, now));

// ---- 错误归类与处理方向（见 docs/MODELS.md 的决策表）----
export type ErrorClass = 'auth' | 'not_found' | 'rate_limit' | 'transient' | 'context' | 'capability' | 'content' | 'bad_request' | 'cancelled';

export function classifyError(status: number | undefined, message: string): ErrorClass {
  const m = message.toLowerCase();
  if (/abort|cancel/.test(m) && !status) return 'cancelled';
  if (status === 401 || status === 403 || /invalid.{0,12}api.?key|unauthori[sz]ed|permission.?denied|reauth|invalid_grant|authentication/.test(m)) return /quota|billing|insufficient/.test(m) ? 'rate_limit' : 'auth';
  if (status === 429 || /rate.?limit|quota|resource.?exhausted|insufficient.{0,10}(balance|quota|credit)|too many requests/.test(m)) return 'rate_limit';
  if (/context.{0,20}(length|window)|maximum.{0,12}tokens|too (long|large)|exceeds? the (max|limit)|prompt is too long|input.{0,10}token.{0,10}limit/.test(m)) return 'context';
  if (status === 404 || /model.{0,24}(not.?found|does not exist|not supported|unknown)|no such model|not_found/.test(m)) return 'not_found';
  if (/safety|content.?(filter|policy|management)|blocked|moderation|prohibited/.test(m)) return 'content';
  if (/does not support|unsupported|not support(ed)?|image.{0,20}not|modalit|response_format|json_schema/.test(m)) return 'capability';
  if (!status || status >= 500 || status === 408 || status === 409 || status === 425 || /timeout|timed out|econn|socket|network|fetch failed|overloaded|unavailable|terminated/.test(m)) return 'transient';
  return 'bad_request';
}

/** 出了这类错之后：要不要在同一目标上再试、把谁暂时拿掉、拿掉多久 */
export function reaction(cls: ErrorClass, retryAfterMs?: number): { retrySame: boolean; cool?: 'credential' | 'target'; ms?: number; stop?: boolean } {
  switch (cls) {
    case 'auth': return { retrySame: false, cool: 'credential', ms: 10 * 60_000 };                              // 这把凭证不行了，别把整家供应商当成坏了
    case 'rate_limit': return { retrySame: false, cool: 'credential', ms: Math.min(Math.max(retryAfterMs ?? 30_000, 5_000), 10 * 60_000) };
    case 'not_found': return { retrySame: false, cool: 'target', ms: 10 * 60_000 };                             // 换凭证重试同一个错误没有意义
    case 'transient': return { retrySame: true, cool: 'target', ms: 20_000 };                                   // 预算内退避重试，再不行换下一个
    case 'context': case 'capability': return { retrySame: false };                                             // 这个目标干不了这件事，但它本身没坏
    case 'content': case 'cancelled': return { retrySame: false, stop: true };                                  // 不靠换供应商绕过安全策略；取消就停
    default: return { retrySame: false };
  }
}

export const hintOf = (secret: string) => { const s = secret.trim(); if (s.startsWith('{')) { try { const j = JSON.parse(s) as { client_email?: string; quota_project_id?: string; project_id?: string; type?: string; file?: unknown; gcloud?: unknown }; const f = typeof j.gcloud === 'string' ? 'gcloud' : typeof j.file === 'string' ? 'file' : undefined; return ([j.client_email ?? j.quota_project_id ?? j.project_id, f].filter(Boolean).join(' · ') || j.type || 'json').slice(0, 40); } catch { return 'json'; } } return s.length > 8 ? `…${s.slice(-4)}` : '…'; };

/** 两份配置差在哪（发布前给管理员看） */
export function diffConfig(a: LlmConfig, b: LlmConfig) {
  const names = (c: LlmConfig) => new Map(allModels(c).map((t) => [t.model.id, `${t.provider.name} / ${t.model.name ?? t.model.model}`]));
  const na = names(a); const nb = names(b);
  const pa = new Map(a.providers.map((p) => [p.id, p])); const pb = new Map(b.providers.map((p) => [p.id, p]));
  const creds = (c: LlmConfig) => c.providers.reduce((n, p) => n + p.credentials.filter((x) => x.enabled).length, 0);
  const eff = (c: LlmConfig, u: Use) => candidates(c, u).eligible.length;
  return {
    providers_added: [...pb.values()].filter((p) => !pa.has(p.id)).map((p) => p.name), providers_removed: [...pa.values()].filter((p) => !pb.has(p.id)).map((p) => p.name),
    models_added: [...nb].filter(([id]) => !na.has(id)).map(([, n]) => n), models_removed: [...na].filter(([id]) => !nb.has(id)).map(([, n]) => n),
    order_changed: JSON.stringify(a.order.filter((id) => nb.has(id))) !== JSON.stringify(b.order.filter((id) => na.has(id))),
    credentials: { before: creds(a), after: creds(b) },
    effective: Object.fromEntries(USES.map((u) => [u, { before: eff(a, u), after: eff(b, u) }])) as Record<Use, { before: number; after: number }>,
  };
}
