import sharp, { type OverlayOptions } from 'sharp';
import { type PersonaSpec, type UIElement } from '@pux/core';
import { blobs } from '@pux/storage';
import { getDb, evidence, eq } from '@pux/db';
import { putEvidence } from '@pux/executor';
import { filterByLiteracy } from './literacy.ts';

export interface Rect { x: number; y: number; w: number; h: number }

export interface Perception {
  image?: Buffer;           // 人物这一眼看到的画面（唯一的输入）
  zoom?: Buffer;            // 凑近看时的局部放大
  perceived_ev?: string;
  hidden_count: number;     // 这一眼没细看的区域数
  unreadable: number;       // 看不清或看不懂的区域数
  read_chars: number;       // 这一眼读到的字数（用于结算阅读时间）
  note: string;             // 仪器记录（不给人物）
}

export interface PerceiveOpts {
  persona: PersonaSpec; elements: UIElement[]; screenshotEv?: string;
  eyes: 'full' | 'glance' | 'none'; attention: number; stress?: number;
  viewport: { w: number; h: number };
  focus?: Rect;             // 上一步「凑近看」的区域（CSS 像素）
  ctx: { study_id?: string; session_id?: string; step_idx?: number; persona_id?: string };
}

const inter = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** 这一眼能读多少字：扫读的人少，认真读的人多；走神、着急、只能瞥一眼时更少 */
export function readingBudget(p: PersonaSpec, o: { eyes: PerceiveOpts['eyes']; attention: number; stress?: number }): number {
  const base = p.behavior_policy.reading === 'scan' ? 160 : 700;
  const speed = Math.max(0.5, Math.min(1.6, p.capability.cognition.reading_speed_cpm / 300));
  return Math.round(base * speed * (0.45 + Math.max(0, Math.min(1, o.attention))) * (o.eyes === 'glance' ? 0.35 : 1) * ((o.stress ?? 0) > 0.7 ? 0.7 : 1));
}

/** 视觉显著度：弹层 > 标题 > 按钮和输入框 > 正文；字大、靠上的先被看到 */
export const salience = (e: UIElement, vh: number) => (e.kind === 'heading' ? 3 : e.kind === 'interactive' ? 2 : 1) + (e.font_px ?? 14) / 14 - (e.bbox[1] / Math.max(1, vh)) * 1.2
  + (e.selector.startsWith('dialog:') || e.role === 'option' || e.role === 'alert' ? 10 : 0) - (e.contrast !== undefined && e.contrast !== null && e.contrast < 3 ? 1 : 0);

/**
 * 决定这一眼哪些区域「没细看」或「看不清」（纯计算，便于单测）。
 * 元素几何只用来决定滤镜落在哪里；任何文字都不会交给人物。
 */
export function planPerception(o: Omit<PerceiveOpts, 'screenshotEv' | 'ctx'>): { blur: { rect: Rect; why: 'skipped' | 'too_small' | 'cannot_read' }[]; read_chars: number; hidden: number; unreadable: number } {
  const p = o.persona; const vh = o.viewport.h;
  const vision = p.capability.body.vision; const lit = p.capability.cognition.literacy_chars;
  const scan = p.behavior_policy.reading === 'scan';
  let budget = readingBudget(p, o);
  const els = o.elements.filter((e) => e.in_viewport && (e.vis_text ?? '').length > 0 && e.bbox[2] > 3 && e.bbox[3] > 3)
    .sort((a, b) => salience(b, vh) - salience(a, vh));
  const blur: { rect: Rect; why: 'skipped' | 'too_small' | 'cannot_read' }[] = [];
  let read = 0; let hidden = 0; let unreadable = 0;
  const kept: Rect[] = [];
  for (const e of els) {
    const rect = { x: e.bbox[0], y: e.bbox[1], w: e.bbox[2], h: e.bbox[3] };
    if (kept.some((k) => k.x <= rect.x && k.y <= rect.y && k.x + k.w >= rect.x + rect.w && k.y + k.h >= rect.y + rect.h)) continue;   // 已经随父区域读过
    const len = (e.vis_text ?? '').length;
    const focused = !!o.focus && inter(rect, o.focus);
    const small = (e.font_px ?? 15) < 13; const low = e.contrast !== undefined && e.contrast !== null && e.contrast < 3;
    if (!focused && vision < 0.6 && (small || low)) { blur.push({ rect, why: 'too_small' }); unreadable++; continue; }
    if (lit && filterByLiteracy(e.vis_text ?? '', lit).unknownRatio > 0.3) { blur.push({ rect, why: 'cannot_read' }); unreadable++; continue; }
    // 长段文字：扫读的人只看开头；按实际读到的量计费
    const cost = e.kind === 'text' ? Math.min(len, scan ? 40 : 240) : Math.min(len, 30);
    if (focused) { read += len; kept.push(rect); continue; }
    if (scan && e.kind === 'text' && (small || len > 120) && budget < cost * 2) { blur.push({ rect, why: 'skipped' }); hidden++; continue; }
    if (budget >= cost) { budget -= cost; read += cost; if (e.kind !== 'text' || len <= (scan ? 40 : 240)) kept.push(rect); }
    else { blur.push({ rect, why: 'skipped' }); hidden++; }
  }
  return { blur, read_chars: read, hidden, unreadable };
}

/**
 * 感知滤镜：把真实截图变成「这个人这一眼看到的画面」。
 * - 注意力与阅读预算：超出预算的区域是模糊的（看到那里有东西，但没读）；想看清要专门凑近看
 * - 只能瞥一眼：屏幕下半部分是余光
 * - 视力差：小字、低对比度的字看不清；整体略糊
 * - 识字量：认不全的字读不懂
 */
export async function perceive(opts: PerceiveOpts): Promise<Perception> {
  const { persona: p, eyes } = opts;
  const plan = planPerception(opts);
  const out: Perception = { hidden_count: plan.hidden, unreadable: plan.unreadable, read_chars: plan.read_chars, note: `read≈${plan.read_chars} chars; skipped ${plan.hidden}; unreadable ${plan.unreadable}${opts.focus ? '; looked closer' : ''}${eyes === 'glance' ? '; glance' : ''}` };
  if (!opts.screenshotEv || eyes === 'none') return out;
  try {
    const row = (await getDb().select().from(evidence).where(eq(evidence.id, opts.screenshotEv)))[0];
    if (!row?.storage_ref) return out;
    const raw = await blobs().get(row.storage_ref);
    const meta = await sharp(raw).metadata();
    const W = meta.width ?? opts.viewport.w; const H = meta.height ?? opts.viewport.h; const k = W / opts.viewport.w;
    const vision = p.capability.body.vision;
    const px = (r: Rect, pad = 2) => { const left = Math.max(0, Math.round((r.x - pad) * k)); const top = Math.max(0, Math.round((r.y - pad) * k)); return { left, top, width: Math.min(W - left, Math.round((r.w + pad * 2) * k)), height: Math.min(H - top, Math.round((r.h + pad * 2) * k)) }; };
    const layers: OverlayOptions[] = [];
    for (const b of plan.blur.slice(0, 90)) {
      const r = px(b.rect); if (r.width < 6 || r.height < 6) continue;
      layers.push({ input: await sharp(raw).extract(r).blur(Math.max(1.2, (b.why === 'skipped' ? 2.4 : 1.8) * k)).toBuffer(), left: r.left, top: r.top });
    }
    if (eyes === 'glance') {
      const top = Math.round(H * 0.55);
      layers.push({ input: await sharp(raw).extract({ left: 0, top, width: W, height: H - top }).blur(5 * k).modulate({ brightness: 0.9 }).toBuffer(), left: 0, top });
    }
    let img = layers.length ? sharp(await sharp(raw).composite(layers).toBuffer()) : sharp(raw);
    const haze = (vision < 0.6 ? (0.6 - vision) * 2.4 * k : 0);
    if (haze > 0.3) img = img.blur(haze);
    out.image = await img.resize({ width: 1100, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
    if (opts.focus) {
      const f = opts.focus; const r = px({ x: f.x - 40, y: f.y - 30, w: f.w + 80, h: f.h + 60 }, 0);
      if (r.width > 20 && r.height > 20) {
        let z = sharp(raw).extract(r).resize({ width: Math.min(1000, Math.round(r.width * 2)) });
        if (haze > 0.6) z = z.blur(haze / 2);       // 凑近了，但眼神不好的人仍然略糊
        out.zoom = await z.jpeg({ quality: 78 }).toBuffer();
      }
    }
    out.perceived_ev = await putEvidence('perceived_screenshot', opts.ctx, { data: out.image, mime: 'image/jpeg' });
  } catch { /* 截图不可用：这一眼什么也没看到 */ }
  return out;
}
