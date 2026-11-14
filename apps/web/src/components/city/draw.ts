// 把城镇图元画进 Pixi Graphics（坐标单位 = 图格；外层容器负责缩放）
import { Graphics } from 'pixi.js';
import type { Appearance, Prim, TownLayout } from '../../lib/types.ts';
import { C, STYLE, rgb, shade } from './palette.ts';

export function extent(layout: TownLayout) {
  const top = Math.min(...layout.places.map((p) => p.top)) - 8;
  const bottom = layout.subway_line.y + layout.subway_line.h + 5;
  return { top, bottom, height: bottom - top, width: layout.width };
}

export function drawGround(g: Graphics, layout: TownLayout) {
  const { bottom } = extent(layout);
  g.rect(0, 1, layout.width, bottom - 1).fill(C.dirt);
  g.rect(0, layout.subway_line.y + layout.subway_line.h + 1, layout.width, bottom).fill(C.dirtDeep);
  for (const p of layout.prims) {
    if (p.t !== 'ground') continue;
    const grass = p.surface === 'grass';
    g.rect(p.x, 0, p.w, 1).fill(grass ? C.grassTop : C.pavementTop);
    g.rect(p.x, 0.5, p.w, 0.5).fill(grass ? C.grass : C.pavement);
  }
  // 地铁隧道与轨道
  const L = layout.subway_line;
  g.rect(0, L.y, layout.width, L.h).fill(C.tunnel);
  g.rect(0, L.y + L.h - 0.25, layout.width, 0.25).fill(C.rail);
  for (let x = 0; x < layout.width; x += 3) g.rect(x, L.y + L.h - 0.5, 1.2, 0.25).fill(shade(C.rail, -0.3));
}

function furniture(g: Graphics, kind: string, x: number, y: number) {
  const f = C.furniture; const hi = C.furnitureHi;
  switch (kind) {
    case 'bed': g.rect(x, y - 1, 4, 1).fill(0xb7a99a); g.rect(x, y - 1.6, 1, 0.6).fill(0xd9d4ca); g.rect(x, y - 1, 0.3, 1).fill(f); break;
    case 'hospital_bed': g.rect(x, y - 1.2, 4, 0.8).fill(0xe8e4dd); g.rect(x + 0.2, y - 0.4, 0.3, 0.4).fill(0x8d877f); g.rect(x + 3.5, y - 0.4, 0.3, 0.4).fill(0x8d877f); break;
    case 'table': case 'desk': g.rect(x, y - 1.2, 3, 0.3).fill(hi); g.rect(x + 0.2, y - 0.9, 0.3, 0.9).fill(f); g.rect(x + 2.5, y - 0.9, 0.3, 0.9).fill(f); if (kind === 'desk') g.rect(x + 1, y - 2, 1.2, 0.8).fill(0x2f3a3f); break;
    case 'chair': g.rect(x, y - 0.8, 1, 0.25).fill(hi); g.rect(x + 0.75, y - 1.8, 0.25, 1).fill(f); g.rect(x, y - 0.55, 0.2, 0.55).fill(f); break;
    case 'sofa': g.rect(x, y - 1, 3, 1).fill(0x7d8f8a); g.rect(x, y - 1.6, 3, 0.6).fill(0x5f726d); break;
    case 'bookcase': case 'shelf': g.rect(x, y - 3.5, 2, 3.5).fill(f); for (let k = 0; k < 3; k++) g.rect(x + 0.2, y - 3.2 + k * 1.1, 1.6, 0.6).fill(kind === 'shelf' ? [0xd9b96a, 0x7fb08f, 0xc97c7c][k] : [0x94504a, 0x5d7883, 0xd9b96a][k]); break;
    case 'counter': g.rect(x, y - 1.4, 4, 1.4).fill(hi); g.rect(x, y - 1.5, 4, 0.2).fill(0xcfc8bc); break;
    case 'lamp': g.rect(x + 0.4, y - 2, 0.2, 2).fill(0x3a3a3e); g.rect(x, y - 2.4, 1, 0.5).fill(C.lampOn); break;
    case 'piano': g.rect(x, y - 1.6, 3, 1.6).fill(0x1d1e23); g.rect(x, y - 1.2, 3, 0.2).fill(0xe8e4dd); break;
    case 'workbench': case 'machine': g.rect(x, y - (kind === 'machine' ? 3 : 1.3), 3, kind === 'machine' ? 3 : 1.3).fill(kind === 'machine' ? 0x5d6a70 : hi); if (kind === 'machine') g.rect(x + 0.5, y - 2.5, 0.8, 0.6).fill(0x7fb08f); break;
    case 'plant': g.rect(x + 0.3, y - 0.6, 0.6, 0.6).fill(0x8a5442); g.rect(x, y - 1.8, 1.2, 1.2).fill(C.leafHi); break;
    case 'blackboard': g.rect(x, y - 4, 4, 2.2).fill(0x2f4a3c); g.rect(x, y - 4.1, 4, 0.15).fill(0x8a6a46); break;
    case 'clock': g.rect(x, y - 5, 1, 1).fill(0xe8e4dd); break;
    default: g.rect(x, y - 1, 1, 1).fill(f);
  }
}

/** 静态层：建筑、公园、地铁站、街具（窗户另画，随昼夜变化） */
export function drawStatic(g: Graphics, layout: TownLayout) {
  for (const p of layout.prims) drawPrim(g, p);
}

function drawPrim(g: Graphics, p: Prim) {
  switch (p.t) {
    case 'building': {
      const base = STYLE[p.style] ?? STYLE.stucco;
      g.rect(p.x, p.y, p.w, p.h).fill(shade(base, -0.55));                    // 室内背景墙
      for (let f = 0; f <= p.floors; f++) { const fy = -f * p.floor_h; if (fy > p.y - 0.5) g.rect(p.x, fy - (f === 0 ? 0 : 0), p.w, f === 0 ? 0 : 1).fill(shade(base, -0.15)); }
      for (let f = 1; f < p.floors; f++) { const fy = -f * p.floor_h; g.rect(p.x + 1, fy, p.w - 2, 1).fill(shade(base, -0.1)); }
      g.rect(p.x, p.y, 1, p.h - 3).fill(base); g.rect(p.x + p.w - 1, p.y, 1, p.h - 3).fill(base);          // 侧墙（底部留门）
      g.rect(p.x - 1, p.y - 1, p.w + 2, 1).fill(shade(base, -0.25));                                       // 屋檐
      if (p.roof === 'gable') { g.poly([p.x - 2, p.y - 1, p.x + p.w / 2, p.y - Math.min(10, p.w / 4), p.x + p.w + 2, p.y - 1]).fill(shade(base, -0.35)); }
      else { g.rect(p.x + 2, p.y - 2, Math.min(6, p.w / 6), 1).fill(shade(base, -0.4)); }
      break;
    }
    case 'door': g.rect(p.x, p.y - 2, 1, 3).fill(C.door); break;
    case 'furniture': furniture(g, p.kind, p.x, p.y); break;
    case 'tree': {
      g.rect(p.x, -p.h * 0.45, 1, p.h * 0.45).fill(C.trunk);
      const r = Math.max(2, Math.round(p.h / 4));
      g.rect(p.x - r, -p.h, r * 2 + 1, p.h * 0.6).fill(C.leaf);
      g.rect(p.x - r + 1, -p.h - 1, r * 2 - 1, 1.5).fill(C.leaf);
      g.rect(p.x - r + 1, -p.h + 0.5, r, 1.5).fill(C.leafHi);
      break;
    }
    case 'bench': g.rect(p.x - 1, -1, 3, 0.35).fill(C.bench); g.rect(p.x - 1, -1.8, 3, 0.3).fill(C.bench); g.rect(p.x - 0.8, -0.65, 0.3, 0.65).fill(shade(C.bench, -0.3)); g.rect(p.x + 1.5, -0.65, 0.3, 0.65).fill(shade(C.bench, -0.3)); break;
    case 'lamp_post': g.rect(p.x, -6, 0.35, 6).fill(C.lamp); g.rect(p.x - 0.4, -6.4, 1.2, 0.5).fill(C.lamp); break;
    case 'pond': g.rect(p.x, 0, p.w, p.d).fill(C.pond); g.rect(p.x, 0, p.w, 0.4).fill(C.pondHi); break;
    case 'hall': g.rect(p.x, p.y, p.w, p.h).fill(C.hall); g.rect(p.x, p.y + p.h, p.w, 1).fill(C.hallFloor); for (let x = p.x + 4; x < p.x + p.w - 3; x += 12) g.rect(x, p.y + 1, 3, 1.4).fill(0xd9b96a); break;
    case 'stairs': {
      const n = Math.abs(p.y2 - p.y1);
      g.rect(p.x - 1, p.y1, 4, n).fill(C.hall);
      for (let k = 0; k < n; k += 1) g.rect(p.x - 1 + (k % 2) * 0.5, p.y1 + k + 0.7, 3, 0.3).fill(C.hallFloor);
      break;
    }
    case 'platform': g.rect(p.x, p.y, p.w, 1).fill(C.platform); g.rect(p.x, p.y, p.w, 0.25).fill(C.trainStripe); break;
    case 'train': {
      for (let c = 0; c < p.cars; c++) {
        const x = p.x + c * (p.car_w + 2);
        g.rect(x, p.y - 6, p.car_w, 5.6).fill(C.train);
        g.rect(x, p.y - 2.2, p.car_w, 0.5).fill(C.trainStripe);
        for (let k = 1.5; k < p.car_w - 2; k += 3.5) g.rect(x + k, p.y - 5, 2.2, 2).fill(C.trainWin);
        g.rect(x + p.car_w / 2 - 1, p.y - 4.6, 2, 4.2).fill(shade(C.train, -0.2));
      }
      break;
    }
    case 'bus_shelter': g.rect(p.x, -6, p.w, 0.6).fill(C.shelter); g.rect(p.x, -5.4, 0.4, 5.4).fill(shade(C.shelter, -0.3)); g.rect(p.x + p.w - 0.4, -5.4, 0.4, 5.4).fill(shade(C.shelter, -0.3)); g.rect(p.x + 1, -1.2, p.w - 2, 0.3).fill(C.bench); break;
    case 'sign': g.rect(p.x - 0.5, p.y - 1.2, 5, 1.4).fill(C.sign); break;
    default: break;
  }
}

/** 窗户层：白天映天色，夜里一部分亮灯（确定性） */
export function drawWindows(g: Graphics, layout: TownLayout, sky: number, night: number) {
  g.clear();
  let i = 0;
  for (const p of layout.prims) {
    if (p.t === 'window') {
      const lit = night > 0.4 && ((p.x * 7 + p.y * 13 + i) % 5) < 3;
      g.rect(p.x, p.y, p.w, p.h).fill({ color: lit ? C.lampOn : sky, alpha: lit ? 0.85 : 0.55 });
      i++;
    } else if (p.t === 'lamp_post' && night > 0.3) {
      g.circle(p.x + 0.2, -5.6, 3.2).fill({ color: C.lampOn, alpha: 0.12 * night });
      g.rect(p.x - 0.3, -6, 1, 0.4).fill(C.lampOn);
    }
  }
}

/** 人物精灵：2×3 图格，脚踩在 (0,0)；按 Terraria 外观上色 */
export function drawPerson(g: Graphics, a: Appearance, pose: string, facing: 1 | -1, frame: number) {
  g.clear();
  const skin = rgb(a.skinColor), hair = rgb(a.hairColor), shirt = rgb(a.shirtColor), pants = rgb(a.pantsColor), shoes = rgb(a.shoeColor), under = rgb(a.underShirtColor);
  if (pose === 'lie') {
    g.rect(-1.5, -0.9, 3, 0.9).fill(shirt); g.rect(1.5 * facing - (facing > 0 ? 0.8 : 0), -1, 0.8, 0.9).fill(skin); g.rect(1.5 * facing - (facing > 0 ? 0.8 : 0), -1.15, 0.8, 0.35).fill(hair);
    return;
  }
  const sit = pose === 'sit';
  const legH = sit ? 0.5 : 1;
  const step = pose === 'walk' && frame % 2 ? 0.25 : 0;
  // 腿与鞋
  g.rect(-0.55 + step, -legH, 0.45, legH).fill(pants); g.rect(0.1 - step, -legH, 0.45, legH).fill(pants);
  g.rect(-0.6 + step, -0.2, 0.55, 0.2).fill(shoes); g.rect(0.05 - step, -0.2, 0.55, 0.2).fill(shoes);
  const by = -legH;
  // 上身
  g.rect(-0.65, by - 1.05, 1.3, 1.05).fill(shirt); g.rect(-0.2, by - 1.05, 0.4, 0.35).fill(under);
  // 头
  g.rect(-0.5, by - 1.95, 1, 0.9).fill(skin);
  g.rect(-0.55, by - 2.15, 1.1, 0.4).fill(hair);
  g.rect(facing > 0 ? -0.55 : 0.3, by - 1.9, 0.25, 0.6).fill(hair);
  g.rect(facing > 0 ? 0.2 : -0.3, by - 1.6, 0.12, 0.12).fill(0x1d1e23);
  // 手与手机
  g.rect(facing > 0 ? 0.5 : -0.75, by - 0.8, 0.25, 0.55).fill(skin);
}
