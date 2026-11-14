// 「用户看得见的东西」相关的图像工具：两张截图之间有没有肉眼可见的变化；把浏览器原生弹窗画进截图。
import sharp from 'sharp';

/**
 * 两张截图之间肉眼可见的变化量。
 * 返回 changed：变化的像素数（灰度差 > 30）；ratio：占比。光标闪烁这类极小变化（< 40 像素）不算。
 */
export async function visualDelta(a: Buffer | undefined, b: Buffer | undefined): Promise<{ changed: number; ratio: number; visible: boolean }> {
  if (!a || !b) return { changed: 0, ratio: 0, visible: true };
  try {
    const A = await sharp(a).greyscale().raw().toBuffer({ resolveWithObject: true });
    const B = await sharp(b).greyscale().resize(A.info.width, A.info.height, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const n = Math.min(A.data.length, B.data.length); let changed = 0;
    for (let i = 0; i < n; i++) if (Math.abs(A.data[i] - B.data[i]) > 30) changed++;
    return { changed, ratio: n ? changed / n : 0, visible: changed >= 40 };
  } catch { return { changed: 0, ratio: 0, visible: true }; }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface DialogLayout { ok: [number, number, number, number]; cancel?: [number, number, number, number] }

/** 原生弹窗（alert / confirm / prompt）在页面截图里看不到，这里按浏览器的样子画上去，并返回按钮位置 */
export function dialogLayout(vw: number, vh: number, hasCancel: boolean): DialogLayout & { box: [number, number, number, number] } {
  const w = Math.min(440, vw - 32); const h = 168; const x = Math.round((vw - w) / 2); const y = Math.round(Math.max(24, vh * 0.18));
  const bw = 84; const bh = 34; const by = y + h - bh - 16;
  const ok: [number, number, number, number] = [x + w - bw - 16, by, bw, bh];
  const cancel: [number, number, number, number] | undefined = hasCancel ? [x + w - bw * 2 - 28, by, bw, bh] : undefined;
  return { box: [x, y, w, h], ok, cancel };
}

export async function drawDialog(base: Buffer, opts: { vw: number; vh: number; host: string; message: string; kind: string; okLabel: string; cancelLabel: string }): Promise<Buffer> {
  const meta = await sharp(base).metadata();
  const W = meta.width ?? opts.vw; const H = meta.height ?? opts.vh; const k = W / opts.vw;
  const L = dialogLayout(opts.vw, opts.vh, opts.kind !== 'alert');
  const [x, y, w, h] = L.box;
  const lines: string[] = []; const perLine = Math.max(10, Math.floor((w - 40) / 15));
  for (const para of opts.message.split('\n')) for (let i = 0; i < para.length; i += perLine) lines.push(para.slice(i, i + perLine));
  const text = lines.slice(0, 3).map((l, i) => `<text x="${x + 20}" y="${y + 64 + i * 22}" font-size="15" fill="#202124">${esc(l)}</text>`).join('');
  const btn = (b: [number, number, number, number], label: string, primary: boolean) => `<rect x="${b[0]}" y="${b[1]}" width="${b[2]}" height="${b[3]}" rx="17" fill="${primary ? '#1a73e8' : '#ffffff'}" stroke="${primary ? '#1a73e8' : '#dadce0'}"/><text x="${b[0] + b[2] / 2}" y="${b[1] + 22}" font-size="14" text-anchor="middle" fill="${primary ? '#ffffff' : '#1a73e8'}">${esc(label)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${opts.vw} ${opts.vh}" font-family="Noto Sans CJK SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif">
<rect width="${opts.vw}" height="${opts.vh}" fill="#000" fill-opacity="0.32"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="#fff" stroke="#dadce0"/>
<text x="${x + 20}" y="${y + 34}" font-size="15" font-weight="600" fill="#202124">${esc(opts.host)}</text>
${text}${L.cancel ? btn(L.cancel, opts.cancelLabel, false) : ''}${btn(L.ok, opts.okLabel, true)}
</svg>`;
  void k;
  return sharp(base).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).jpeg({ quality: 72 }).toBuffer();
}
