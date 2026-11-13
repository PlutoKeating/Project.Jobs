import sharp from 'sharp';
import { loadConfig, type PersonaSpec, type UIElement } from '@pux/core';
import { blobs } from '@pux/storage';
import { getDb, evidence, eq } from '@pux/db';
import { putEvidence } from '@pux/executor';
import { filterByLiteracy } from './literacy.ts';

export interface PerceivedElement { ref: string; role: string; label: string; kind: UIElement['kind']; disabled?: boolean; value?: string }
export interface Perception {
  elements: PerceivedElement[];         // Operator 可定位的子集（Persona 看见了的）
  summary: string;                      // 给 Persona Mind 的画面文字描述（无 ref）
  image?: Buffer;                       // 感知过滤后的截图（给 Mind）
  perceived_ev?: string;
  hidden_count: number;                 // 被感知过滤掉的元素数
  unreadable: number;                   // 看不懂/看不清的文本数
}

const roleZh: Record<string, string> = { button: '按钮', link: '链接', textbox: '输入框', searchbox: '搜索框', checkbox: '复选框', radio: '单选', combobox: '下拉框', heading: '标题', img: '图片', tab: '标签页', switch: '开关', slider: '滑块', canvas: '画布', file: '文件选择', menuitem: '菜单项', option: '选项', video: '视频' };

/**
 * 感知过滤（§7.1）：只作用于 Persona Mind；Operator 仍用清晰画面定位，但只能执行 Persona「看到」的目标。
 * - 扫读：长段文字只看到开头；小字被忽略
 * - 只能瞥一眼（eyes=glance）：只看到最醒目的少数元素
 * - 视力差：低对比度/小字号看不清
 * - 儿童：超出识字量的字显示为 □
 */
export async function perceive(opts: { persona: PersonaSpec; elements: UIElement[]; screenshotEv?: string; eyes: 'full' | 'glance' | 'none'; attention: number; ctx: { study_id?: string; session_id?: string; step_idx?: number; persona_id?: string }; lang: 'zh' | 'en' }): Promise<Perception> {
  const { persona: p, eyes, lang } = opts;
  const cfg = loadConfig().perception;
  const scan = p.behavior_policy.reading === 'scan';
  const vision = p.capability.body.vision;
  const lit = p.capability.cognition.literacy_chars;
  let hidden = 0; let unreadable = 0;
  let els = opts.elements.filter((e) => e.in_viewport || e.selector.startsWith('dialog:'));
  // 视觉显著度：标题/按钮/大字/靠上 优先
  const salience = (e: UIElement) => (e.kind === 'heading' ? 3 : e.kind === 'interactive' ? 2 : 1) + (e.font_px ?? 14) / 14 - e.bbox[1] / 1200 + (e.selector.startsWith('dialog:') ? 10 : 0);
  if (eyes === 'glance' || opts.attention < 0.25) {
    const keep = Math.max(4, Math.round(cfg.glance_max_elements * (eyes === 'glance' ? 1 : 1.5)));
    const sorted = [...els].sort((a, b) => salience(b) - salience(a));
    hidden += Math.max(0, sorted.length - keep);
    els = sorted.slice(0, keep).sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  }
  const out: PerceivedElement[] = [];
  for (const e of els) {
    let label = (e.name || e.placeholder || '').replace(/\s+/g, ' ').trim();
    const small = (e.font_px ?? 15) < 13;
    const lowContrast = e.contrast !== undefined && e.contrast !== null && e.contrast < 3;
    if (vision < 0.6 && (small || lowContrast)) { unreadable++; label = lang === 'zh' ? '（一行看不清的小字）' : '(some text too small to read)'; if (e.kind === 'text') { hidden++; continue; } }
    if (scan && e.kind === 'text') {
      if ((e.text_len ?? label.length) > cfg.scan_max_text_len) label = label.slice(0, 18) + (lang === 'zh' ? '…（大段文字，没细看）' : '… (long text, skimmed)');
      if ((e.font_px ?? 15) < cfg.scan_min_font_px - 2) { hidden++; continue; }
    } else if (e.kind === 'text') label = label.slice(0, 220);
    if (lit) { const f = filterByLiteracy(label, lit); if (f.unknownRatio > 0.3) unreadable++; label = f.text; }
    if (!label && e.kind === 'interactive') label = lang === 'zh' ? `（一个没有文字的${roleZh[e.role] ?? '图标'}）` : `(an unlabeled ${e.role} icon)`;
    if (!label) continue;
    out.push({ ref: e.ref, role: e.role, label: label.slice(0, 160), kind: e.kind, disabled: e.disabled, value: e.value ? e.value.slice(0, 80) : undefined });
  }
  const summary = out.slice(0, 120).map((e) => {
    const r = e.kind === 'heading' ? (lang === 'zh' ? '【标题】' : '[heading] ') : e.kind === 'text' ? '' : e.kind === 'image' ? (lang === 'zh' ? '[图片] ' : '[image] ') : `[${lang === 'zh' ? (roleZh[e.role] ?? e.role) : e.role}] `;
    return `${r}${e.label}${e.disabled ? (lang === 'zh' ? '（灰色不可点）' : ' (greyed out)') : ''}${e.value ? (lang === 'zh' ? ` 当前内容：「${e.value}」` : ` currently: "${e.value}"`) : ''}`;
  }).join('\n');

  // 感知过滤后的截图
  let image: Buffer | undefined; let perceived_ev: string | undefined;
  if (opts.screenshotEv) {
    try {
      const row = (await getDb().select().from(evidence).where(eq(evidence.id, opts.screenshotEv)))[0];
      if (row?.storage_ref) {
        const raw = await blobs().get(row.storage_ref);
        let img = sharp(raw).resize({ width: 900, withoutEnlargement: true });
        const blur = (vision < 0.6 ? (0.6 - vision) * 6 : 0) + (eyes === 'glance' ? 1.2 : 0);
        if (eyes === 'glance') { const m = await sharp(raw).metadata(); img = sharp(raw).extract({ left: 0, top: 0, width: m.width ?? 900, height: Math.round((m.height ?? 600) * 0.6) }).resize({ width: 900, withoutEnlargement: true }); }
        if (blur > 0.3) img = img.blur(Math.min(4, blur));
        image = await img.jpeg({ quality: 60 }).toBuffer();
        if (blur > 0.3 || eyes === 'glance') perceived_ev = await putEvidence('perceived_screenshot', opts.ctx, { data: image, mime: 'image/jpeg' });
      }
    } catch { /* 截图不可用时只用文字 */ }
  }
  return { elements: out, summary, image, perceived_ev, hidden_count: hidden, unreadable };
}
