// 人物外观：按年龄/性别/职业确定性映射 Terraria 外观；网页的像素头像使用同一组颜色
import type { PersonaSpec } from '@pux/core';
import type { Appearance } from './protocol.ts';
import { hashNum } from './town.ts';

type RGB = [number, number, number];
const SKIN: RGB[] = [[255, 224, 196], [241, 194, 160], [224, 172, 132], [198, 134, 98], [141, 85, 54]];
const HAIR_YOUNG: RGB[] = [[34, 26, 22], [58, 40, 30], [92, 62, 40], [20, 20, 24], [120, 80, 50]];
const HAIR_OLD: RGB[] = [[200, 200, 200], [170, 168, 165], [120, 118, 116], [225, 222, 215]];
const EYES: RGB[] = [[60, 40, 30], [40, 70, 110], [70, 90, 60], [30, 30, 30]];

// Terraria 发型 ID（原版 0–162 有效）
const HAIR_F = [5, 6, 7, 9, 10, 16, 17, 18, 21, 26, 27, 44, 52];
const HAIR_M = [0, 1, 2, 3, 4, 8, 11, 12, 14, 15, 24, 31, 33];
const HAIR_CHILD = [5, 18, 21, 26, 0, 2, 4];
const HAIR_OLD_IDX = [15, 20, 23, 40, 7];

interface Outfit { shirt: RGB; under: RGB; pants: RGB; shoes: RGB; vanity: [number, number, number] }
// 时装物品 ID：Nurse 套装 1949/1950/1951（白衣）；Tuxedo 978/979/980（西装）；School 学生装 3871?（不保证存在时为 0）
const OUTFITS: { re: RegExp; o: Outfit }[] = [
  { re: /医生|护士|doctor|nurse/i, o: { shirt: [240, 240, 240], under: [210, 230, 240], pants: [230, 230, 230], shoes: [250, 250, 250], vanity: [0, 0, 0] } },
  { re: /经理|产品|运营|marketing|manager|设计|designer|工程师|engineer|coordinator/i, o: { shirt: [60, 72, 96], under: [235, 235, 240], pants: [40, 44, 56], shoes: [30, 26, 24], vanity: [0, 0, 0] } },
  { re: /老师|教师|teacher/i, o: { shirt: [150, 110, 90], under: [240, 236, 226], pants: [70, 66, 80], shoes: [70, 50, 40], vanity: [0, 0, 0] } },
  { re: /工人|流水线|工厂|machinist|factory/i, o: { shirt: [56, 92, 140], under: [200, 200, 200], pants: [50, 60, 80], shoes: [60, 50, 40], vanity: [0, 0, 0] } },
  { re: /学生|student/i, o: { shirt: [220, 120, 60], under: [250, 250, 250], pants: [60, 70, 110], shoes: [240, 240, 240], vanity: [0, 0, 0] } },
  { re: /退休|retired/i, o: { shirt: [120, 100, 80], under: [220, 210, 190], pants: [80, 74, 66], shoes: [50, 40, 34], vanity: [0, 0, 0] } },
  { re: /剪辑|video|editor|自由|freelanc/i, o: { shirt: [30, 30, 34], under: [70, 70, 76], pants: [44, 50, 70], shoes: [220, 220, 220], vanity: [0, 0, 0] } },
];
const DEFAULT_OUTFIT: Outfit = { shirt: [110, 140, 120], under: [235, 230, 220], pants: [64, 70, 90], shoes: [60, 46, 38], vanity: [0, 0, 0] };

export function appearanceFor(p: PersonaSpec): Appearance {
  const h = hashNum(p.id);
  const age = p.identity.age ?? 30;
  const female = /女|female|woman|f$/i.test(`${p.identity.gender ?? ''}`);
  const occ = `${p.identity.occupation ?? ''}`;
  const pick = <T>(a: T[], salt: number) => a[(h >>> salt) % a.length];
  const hair = age >= 60 ? pick(HAIR_OLD_IDX, 3) : age < 13 ? pick(HAIR_CHILD, 5) : female ? pick(HAIR_F, 7) : pick(HAIR_M, 9);
  const hairColor = age >= 60 ? pick(HAIR_OLD, 11) : pick(HAIR_YOUNG, 13);
  const skinColor = /zh/i.test(p.locale) ? pick(SKIN.slice(0, 3), 2) : pick(SKIN, 4);
  const outfit = age < 13
    ? { shirt: pick<RGB>([[240, 90, 90], [90, 160, 240], [250, 200, 60], [120, 200, 120]], 6), under: [255, 255, 255] as RGB, pants: [50, 60, 110] as RGB, shoes: [240, 240, 240] as RGB, vanity: [0, 0, 0] as [number, number, number] }
    : (OUTFITS.find((o) => o.re.test(occ))?.o ?? DEFAULT_OUTFIT);
  return {
    hair, skinVariant: female ? 4 : 0,
    hairColor, skinColor, eyeColor: pick(EYES, 8),
    shirtColor: outfit.shirt, underShirtColor: outfit.under, pantsColor: outfit.pants, shoeColor: outfit.shoes,
    vanity: outfit.vanity, held: 0,
  };
}


/** 头像生成前的占位：中性像素剪影（不画五官，避免与生成的头像形成两套画风） */
export function pixelAvatarSvg(_p: PersonaSpec, size = 128): string {
  const G = 16; const c = '#3a3b40'; const bg = '#1d1e23';
  const r = (x: number, y: number, w: number, h: number, f: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
  const body = [r(0, 0, G, G, bg), r(5, 3, 6, 7, c), r(4, 4, 8, 5, c), r(7, 10, 2, 2, c), r(2, 12, 12, 4, c), r(3, 11, 10, 1, c)].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" width="${size}" height="${size}" shape-rendering="crispEdges">${body}</svg>`;
}
