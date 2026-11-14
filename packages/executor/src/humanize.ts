// 人类化的手：鼠标轨迹、按键节奏、触屏手势。全部是纯函数（便于单测），由 BrowserSession 负责真正注入。
// 真实耗时被压缩（模拟时钟另行按人物的速度结算），但轨迹形状、先后顺序、错字与回删都真实发生在页面上。
import type { MotorProfile, Rng } from '@pux/core';

export interface Pt { x: number; y: number }
export interface TimedPt extends Pt { dt: number }      // dt：与上一个点之间的间隔（毫秒，已压缩）

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const uni = (rng: Rng, a: number, b: number) => a + rng.next() * (b - a);

/** Fitts 定律估计的移动时间（毫秒，真实尺度）：距离越远、目标越小越慢；精度差的人更慢 */
export function fittsMs(distance: number, targetSize: number, precision: number): number {
  const id = Math.log2(distance / Math.max(4, targetSize) + 1);
  return (120 + 160 * id) * (1.6 - 0.6 * clamp(precision, 0, 1));
}

/**
 * 鼠标轨迹：三次贝塞尔曲线 + 缓入缓出 + 轻微抖动；精度差或距离远时可能先略微冲过头再修正。
 * @param compress 真实耗时压缩倍数（默认 6：一次 600ms 的移动实际只花 100ms）
 */
export function mousePath(from: Pt, to: Pt, opts: { targetSize?: number; precision?: number; rng: Rng; compress?: number }): TimedPt[] {
  const { rng } = opts; const precision = opts.precision ?? 0.9; const compress = opts.compress ?? 6;
  const dx = to.x - from.x; const dy = to.y - from.y; const dist = Math.hypot(dx, dy);
  if (dist < 2) return [{ ...to, dt: 0 }];
  const total = fittsMs(dist, opts.targetSize ?? 40, precision) / compress;
  const steps = clamp(Math.round(dist / 28) + 6, 8, 34);
  // 控制点：沿法线方向偏移，形成自然的弧线
  const nx = -dy / dist; const ny = dx / dist;
  const bend = dist * (0.08 + 0.12 * (1 - precision)) * (rng.bool(0.5) ? 1 : -1) * (0.5 + uni(rng, 0, 1));
  const c1 = { x: from.x + dx * 0.3 + nx * bend, y: from.y + dy * 0.3 + ny * bend };
  const c2 = { x: from.x + dx * 0.72 + nx * bend * 0.6, y: from.y + dy * 0.72 + ny * bend * 0.6 };
  const overshoot = dist > 240 && rng.bool(0.12 + 0.3 * (1 - precision));
  const end = overshoot ? { x: to.x + (dx / dist) * uni(rng, 6, 18), y: to.y + (dy / dist) * uni(rng, 6, 18) } : to;
  const out: TimedPt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps; const e = t * t * (3 - 2 * t);       // smoothstep：两头慢中间快
    const u = 1 - e;
    const jitter = (1 - precision) * 1.6;
    out.push({
      x: u * u * u * from.x + 3 * u * u * e * c1.x + 3 * u * e * e * c2.x + e * e * e * end.x + (i < steps ? rng.normal(0, jitter) : 0),
      y: u * u * u * from.y + 3 * u * u * e * c1.y + 3 * u * e * e * c2.y + e * e * e * end.y + (i < steps ? rng.normal(0, jitter) : 0),
      dt: total / steps,
    });
  }
  if (overshoot) { out.push({ x: (end.x + to.x) / 2, y: (end.y + to.y) / 2, dt: 90 / compress }); out.push({ ...to, dt: 70 / compress }); }
  return out;
}

// QWERTY 邻键表：打错字时按到的是旁边的键，而不是随机键
const NEIGHBORS: Record<string, string> = {
  q: 'wa', w: 'qes', e: 'wrd', r: 'etf', t: 'ryg', y: 'tuh', u: 'yij', i: 'uok', o: 'ipl', p: 'ol',
  a: 'qsz', s: 'awdx', d: 'sefc', f: 'drgv', g: 'fthb', h: 'gyjn', j: 'hukm', k: 'jil', l: 'kop',
  z: 'asx', x: 'zsdc', c: 'xdfv', v: 'cfgb', b: 'vghn', n: 'bhjm', m: 'njk',
};

export type KeyStroke = { kind: 'char'; ch: string; dt: number } | { kind: 'backspace'; dt: number };

/**
 * 打字节奏：按人物的打字速度逐字输入，词与词之间略停顿；拉丁字母可能按到邻键，发现后回删重打。
 * 中文等非拉丁字符按「整字上屏」处理（不模拟输入法候选）。
 */
export function typingPlan(text: string, motor: MotorProfile, rng: Rng, compress = 8): KeyStroke[] {
  const base = 1000 / Math.max(0.5, motor.typing_cps);
  const typo = motor.typo_rate * (motor.one_handed ? 2 : 1);
  const out: KeyStroke[] = [];
  const dt = (mult = 1) => clamp((base * mult * (0.6 + uni(rng, 0, 0.8))) / compress, 4, 90);
  for (const ch of text) {
    const lower = ch.toLowerCase();
    if (NEIGHBORS[lower] && rng.bool(typo)) {
      const n = NEIGHBORS[lower]; const wrong = n[rng.int(0, n.length - 1)];
      out.push({ kind: 'char', ch: ch === lower ? wrong : wrong.toUpperCase(), dt: dt() });
      out.push({ kind: 'backspace', dt: dt(2.2) });        // 发现打错，停一下再删
    }
    out.push({ kind: 'char', ch, dt: dt(/[\s，。,.!?！？]/.test(ch) ? 1.8 : 1) });
  }
  return out;
}

/**
 * 落点：人不会每次都点在正中心。精度越低、单手、目标越小，越容易点偏甚至点到外面。
 * - 刚点偏过同一个目标的人会更小心（attempt 每加 1，离散程度减半）；
 * - 触屏有「手指容差」：系统会把落在目标边缘外几个像素内的触点算作点中（touchSlop）。
 */
export function landingPoint(center: Pt, box: { x: number; y: number; w: number; h: number } | undefined, motor: MotorProfile, rng: Rng, opts: { attempt?: number; touch?: boolean } = {}): Pt & { miss: boolean } {
  if (!box) return { ...center, miss: false };
  const careful = Math.pow(0.5, Math.min(3, opts.attempt ?? 0));
  const spread = (1 - motor.precision) * (motor.one_handed ? 1.3 : 1) * 20 * careful;
  // 目标内部也有自然偏移（不总在正中）
  let x = center.x + rng.normal(0, spread + Math.min(box.w * 0.08, 10) * careful);
  let y = center.y + rng.normal(0, spread + Math.min(box.h * 0.08, 6) * careful);
  const slop = opts.touch ? 10 : 0;
  const dx = x < box.x ? box.x - x : x > box.x + box.w ? x - (box.x + box.w) : 0;
  const dy = y < box.y ? box.y - y : y > box.y + box.h ? y - (box.y + box.h) : 0;
  let miss = dx > 0 || dy > 0;
  if (miss && dx <= slop && dy <= slop) { x = Math.max(box.x + 1, Math.min(box.x + box.w - 1, x)); y = Math.max(box.y + 1, Math.min(box.y + box.h - 1, y)); miss = false; }
  return { x: Math.max(1, x), y: Math.max(1, y), miss };
}

/** 滚轮：分成若干小格滚动，而不是一次跳 600px */
export function wheelPlan(amount: number, rng: Rng): { dy: number; dt: number }[] {
  const ticks = clamp(Math.round(Math.abs(amount) / 110), 2, 10);
  const out: { dy: number; dt: number }[] = [];
  for (let i = 0; i < ticks; i++) out.push({ dy: (amount / ticks) * (0.85 + uni(rng, 0, 0.3)), dt: 14 + uni(rng, 0, 26) });
  return out;
}

/** 触屏滑动：手指按下 → 加速 → 减速抬起（带惯性尾段），返回手指轨迹 */
export function swipePath(from: Pt, distanceY: number, rng: Rng): TimedPt[] {
  const steps = 9; const out: TimedPt[] = [];
  const drift = rng.normal(0, 6);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps; const e = 1 - (1 - t) * (1 - t);       // 先快后慢
    out.push({ x: from.x + drift * t, y: from.y + distanceY * e, dt: 12 + (i > steps - 3 ? 10 : 0) });
  }
  return out;
}
