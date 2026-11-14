// 城镇布局：YAML → 渲染无关的图元（网页小地图、TShock、tModLoader 共用同一份计算结果）
import { configPath, readYaml, z } from '@pux/core';

const L10n = z.object({ zh: z.string(), en: z.string() });
export const PlaceKind = z.enum(['home', 'school', 'park', 'bus_stop', 'subway', 'office', 'cafe', 'restaurant', 'shop', 'library', 'hospital', 'factory', 'road', 'street']);
export type PlaceKindT = z.infer<typeof PlaceKind>;

export const TownSchema = z.object({
  id: z.string(),
  name: L10n,
  width: z.number().int(),
  ground_depth: z.number().int().default(40),
  subway_line: z.object({ y: z.number().int(), h: z.number().int() }),
  places: z.array(z.object({
    id: z.string(), kind: PlaceKind, name: L10n, x: z.number().int(), w: z.number().int(),
    floors: z.number().int().default(1), floor_h: z.number().int().default(9), style: z.string().default('stucco'),
    depth: z.number().int().optional(),
  })),
  place_match: z.array(z.object({ kind: PlaceKind, words: z.array(z.string()) })),
});
export type Town = z.infer<typeof TownSchema>;
export type TownPlace = Town['places'][number];

/** 渲染图元。坐标单位为图格；x 从城镇左端起，地面 y=0，向上为负 */
export type Prim =
  | { t: 'ground'; x: number; w: number; surface: 'grass' | 'pavement' | 'asphalt' }
  | { t: 'building'; id: string; kind: PlaceKindT; x: number; y: number; w: number; h: number; style: string; floor_h: number; floors: number; roof: 'flat' | 'gable' }
  | { t: 'door'; x: number; y: number }
  | { t: 'window'; x: number; y: number; w: number; h: number }
  | { t: 'furniture'; kind: Furniture; x: number; y: number }
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

export type Furniture = 'bed' | 'table' | 'chair' | 'sofa' | 'bookcase' | 'desk' | 'counter' | 'shelf' | 'lamp' | 'piano' | 'workbench' | 'sink' | 'clock' | 'plant' | 'blackboard' | 'hospital_bed' | 'machine';

export interface Spot { id: string; place_id: string; x: number; y: number; floor: number; pose: 'stand' | 'sit' | 'lie'; unit?: number }

export interface PlaceLayout { id: string; kind: PlaceKindT; name: { zh: string; en: string }; x: number; w: number; top: number; bottom: number; floors: number; floor_h: number }

export interface TownLayout {
  id: string; name: { zh: string; en: string }; width: number; ground_depth: number;
  subway_line: { y: number; h: number };
  places: PlaceLayout[];
  prims: Prim[];
  spots: Spot[];
  /** 每个住宅单元（用于给人物分配家） */
  homes: { place_id: string; unit: number; x: number; y: number; floor: number }[];
  version: string;
}

export function loadTown(path = configPath('jobsworld', 'town.yaml')): Town { return TownSchema.parse(readYaml(path)); }

const FURNISH: Partial<Record<PlaceKindT, Furniture[]>> = {
  office: ['desk', 'chair', 'desk', 'chair', 'plant', 'desk', 'chair', 'bookcase'],
  school: ['blackboard', 'desk', 'chair', 'desk', 'chair', 'desk', 'chair'],
  cafe: ['counter', 'table', 'chair', 'table', 'chair', 'plant'],
  restaurant: ['counter', 'table', 'chair', 'table', 'chair', 'table', 'chair'],
  shop: ['shelf', 'shelf', 'counter', 'shelf', 'shelf'],
  library: ['bookcase', 'table', 'chair', 'bookcase', 'table', 'chair', 'bookcase'],
  hospital: ['hospital_bed', 'chair', 'chair', 'counter', 'hospital_bed', 'plant'],
  factory: ['machine', 'workbench', 'machine', 'workbench', 'machine'],
};

/** 计算完整布局（纯函数，结果可复现） */
export function computeLayout(town: Town = loadTown()): TownLayout {
  const prims: Prim[] = [];
  const spots: Spot[] = [];
  const homes: TownLayout['homes'] = [];
  const places: PlaceLayout[] = [];
  const line = town.subway_line;

  // 地表：公园为草地，其余为人行道
  let cursor = 0;
  const parks = town.places.filter((p) => p.kind === 'park').sort((a, b) => a.x - b.x);
  for (const p of parks) { if (p.x > cursor) prims.push({ t: 'ground', x: cursor, w: p.x - cursor, surface: 'pavement' }); prims.push({ t: 'ground', x: p.x, w: p.w, surface: 'grass' }); cursor = p.x + p.w; }
  if (cursor < town.width) prims.push({ t: 'ground', x: cursor, w: town.width - cursor, surface: 'pavement' });
  // 贯穿全镇的地铁隧道
  prims.push({ t: 'tunnel', x: 0, y: line.y, w: town.width, h: line.h });
  // 路灯
  for (let x = 8; x < town.width; x += 48) if (!town.places.some((p) => p.kind !== 'park' && x >= p.x && x < p.x + p.w)) prims.push({ t: 'lamp_post', x });

  for (const p of town.places) {
    const sign = (x: number, y: number): Prim => ({ t: 'sign', x, y, text: p.name.zh, text_en: p.name.en });
    if (p.kind === 'park') {
      places.push({ id: p.id, kind: p.kind, name: p.name, x: p.x, w: p.w, top: -14, bottom: 0, floors: 1, floor_h: 14 });
      const pondX = p.x + Math.floor(p.w * 0.55); const pondW = Math.min(26, Math.floor(p.w * 0.25));
      prims.push({ t: 'pond', x: pondX, w: pondW, d: 4 });
      for (let x = p.x + 4, i = 0; x < p.x + p.w - 3; x += 9, i++) {
        if (x >= pondX - 2 && x <= pondX + pondW + 1) continue;
        if (i % 3 === 1) { prims.push({ t: 'bench', x }); spots.push({ id: `${p.id}:${spots.length}`, place_id: p.id, x, y: 0, floor: 0, pose: 'sit' }); }
        else prims.push({ t: 'tree', x, h: 9 + ((x * 7) % 6) });
      }
      for (let x = p.x + 3; x < p.x + p.w - 2; x += 6) if (!(x >= pondX - 1 && x <= pondX + pondW)) spots.push({ id: `${p.id}:${spots.length}`, place_id: p.id, x, y: 0, floor: 0, pose: 'stand' });
      prims.push(sign(p.x + 2, -1));
      continue;
    }
    if (p.kind === 'bus_stop') {
      places.push({ id: p.id, kind: p.kind, name: p.name, x: p.x, w: p.w, top: -6, bottom: 0, floors: 1, floor_h: 6 });
      prims.push({ t: 'bus_shelter', x: p.x, w: p.w }, sign(p.x + 1, -1));
      for (let x = p.x + 2; x < p.x + p.w - 1; x += 3) spots.push({ id: `${p.id}:${spots.length}`, place_id: p.id, x, y: 0, floor: 0, pose: 'stand' });
      continue;
    }
    if (p.kind === 'subway') {
      const depth = line.y + line.h; // 站台地面 = 隧道底
      places.push({ id: p.id, kind: p.kind, name: p.name, x: p.x, w: p.w, top: -5, bottom: depth, floors: 1, floor_h: depth });
      // 站厅（地下一层）
      prims.push({ t: 'hall', x: p.x + 4, y: 6, w: p.w - 8, h: 9 });
      prims.push({ t: 'stairs', x: p.x + 2, y1: 0, y2: 15, dir: 1 }, { t: 'stairs', x: p.x + p.w - 3, y1: 0, y2: 15, dir: -1 });
      prims.push({ t: 'stairs', x: p.x + Math.floor(p.w / 2) - 8, y1: 15, y2: line.y, dir: 1 });
      // 站台与列车
      prims.push({ t: 'platform', x: p.x + 4, y: depth, w: p.w - 8 });
      const carW = 22; const cars = Math.max(2, Math.floor((p.w - 16) / (carW + 2)));
      const trainX = p.x + 8;
      prims.push({ t: 'train', x: trainX, y: depth, cars, car_w: carW });
      for (let c = 0; c < cars; c++) for (let k = 3; k < carW - 2; k += 4) spots.push({ id: `${p.id}:${spots.length}`, place_id: p.id, x: trainX + c * (carW + 2) + k, y: depth, floor: -2, pose: 'stand' });
      for (let x = p.x + 8; x < p.x + p.w - 8; x += 6) spots.push({ id: `${p.id}:${spots.length}`, place_id: p.id, x, y: 15, floor: -1, pose: 'stand' });
      prims.push(sign(p.x + 6, -1), { t: 'sign', x: p.x + p.w - 8, y: -1, text: p.name.zh, text_en: p.name.en });
      continue;
    }
    // 建筑类
    const H = p.floors * p.floor_h;
    places.push({ id: p.id, kind: p.kind, name: p.name, x: p.x, w: p.w, top: -H - 1, bottom: 0, floors: p.floors, floor_h: p.floor_h });
    prims.push({ t: 'building', id: p.id, kind: p.kind, x: p.x, y: -H, w: p.w, h: H, style: p.style, floor_h: p.floor_h, floors: p.floors, roof: p.kind === 'home' && p.floors <= 3 ? 'gable' : 'flat' });
    prims.push({ t: 'door', x: p.x, y: -1 }, { t: 'door', x: p.x + p.w - 1, y: -1 });
    prims.push(sign(p.x + Math.floor(p.w / 2) - 2, -H - 2));
    for (let f = 0; f < p.floors; f++) {
      const floorY = -f * p.floor_h;                // 该层地面（站立面）
      const inner = { x: p.x + 2, w: p.w - 4 };
      // 窗户（背景墙上的玻璃）
      for (let x = inner.x + 2; x < inner.x + inner.w - 3; x += 7) prims.push({ t: 'window', x, y: floorY - p.floor_h + 2, w: 3, h: Math.max(2, p.floor_h - 5) });
      if (p.kind === 'home') {
        const units = Math.max(1, Math.floor(inner.w / 18));
        const uw = Math.floor(inner.w / units);
        for (let u = 0; u < units; u++) {
          const ux = inner.x + u * uw;
          prims.push({ t: 'furniture', kind: 'bed', x: ux + 2, y: floorY }, { t: 'furniture', kind: 'table', x: ux + 8, y: floorY }, { t: 'furniture', kind: 'chair', x: ux + 11, y: floorY }, { t: 'furniture', kind: u % 2 ? 'sofa' : 'bookcase', x: ux + uw - 5, y: floorY });
          const unit = homes.length;
          homes.push({ place_id: p.id, unit, x: ux + Math.floor(uw / 2), y: floorY, floor: f });
          spots.push({ id: `${p.id}:u${unit}`, place_id: p.id, x: ux + Math.floor(uw / 2), y: floorY, floor: f, pose: 'stand', unit });
        }
        continue;
      }
      const set = FURNISH[p.kind] ?? ['table', 'chair'];
      const step = Math.max(4, Math.floor(inner.w / (set.length + 1)));
      set.forEach((kind, i) => prims.push({ t: 'furniture', kind, x: inner.x + 2 + i * step, y: floorY }));
      for (let x = inner.x + 3; x < inner.x + inner.w - 2; x += 5) spots.push({ id: `${p.id}:${spots.length}`, place_id: p.id, x, y: floorY, floor: f, pose: 'stand' });
    }
  }
  // 街道上的落脚点（散步、打车、上路）
  for (let x = 4; x < town.width; x += 12) spots.push({ id: `street:${spots.length}`, place_id: 'street', x, y: 0, floor: 0, pose: 'stand' });

  const version = hashStr(JSON.stringify({ prims, spots }));
  return { id: town.id, name: town.name, width: town.width, ground_depth: town.ground_depth, subway_line: line, places, prims, spots, homes, version };
}

export function hashStr(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
export function hashNum(s: string): number { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** 世界模板的地点描述 → 地点类型 */
export function matchPlaceKind(town: Town, text: string | undefined | null): PlaceKindT {
  const s = (text ?? '').toLowerCase();
  for (const r of town.place_match) if (r.words.some((w) => s.includes(w.toLowerCase()))) return r.kind;
  return 'street';
}

/** 地点类型 → 具体地点 id（同类多个时按种子挑选；家则用该人物自己的家） */
export function placeForKind(layout: TownLayout, kind: PlaceKindT, seed: string, homePlaceId?: string): string {
  if (kind === 'home' && homePlaceId) return homePlaceId;
  if (kind === 'road' || kind === 'street') return 'street';
  const c = layout.places.filter((p) => p.kind === kind);
  if (!c.length) return 'street';
  return c[hashNum(seed) % c.length].id;
}
