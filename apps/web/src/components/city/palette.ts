// 城市像素调色板：与 PlutoKeating 暖炭/琥珀体系同调；天空随模拟时钟变化
export const STYLE: Record<string, number> = {
  brick: 0x8a5442, stucco: 0xb9a98e, brick_red: 0x94504a, glass: 0x5d7883, wood: 0x8a6a46, wood_dark: 0x5c4434, marble: 0xcfc8bc, white: 0xd9d4ca, metal: 0x6d7378,
};
export const C = {
  dirt: 0x3a2f27, dirtDeep: 0x2b231d, pavement: 0x6f6b65, pavementTop: 0x8d877f, grass: 0x55724a, grassTop: 0x6f8f55,
  tunnel: 0x18191c, rail: 0x5a5650, hall: 0x2a2b2f, hallFloor: 0x8d857c, platform: 0x8d857c, train: 0xc2cfcb, trainStripe: 0xf0a35e, trainWin: 0x2a3438,
  door: 0x4a3426, trunk: 0x5a4030, leaf: 0x4f6e45, leafHi: 0x67874f, bench: 0x7a5a3c, pond: 0x3f6274, pondHi: 0x58808f, lamp: 0x3a3a3e, lampOn: 0xf5b67c,
  shelter: 0x7d8f8a, sign: 0x2a2620, signText: 0xe8e4dd, furniture: 0x6b5644, furnitureHi: 0x8d7458, star: 0xe8e4dd,
  accent: 0xf0a35e, accentHi: 0xf5b67c, angry: 0xc97c7c, happy: 0x7fb08f, confused: 0xd9b96a,
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function mix(c1: number, c2: number, k: number) {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, k), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, k), b = lerp(c1 & 255, c2 & 255, k);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
export const shade = (c: number, k: number) => mix(c, k < 0 ? 0x000000 : 0xffffff, Math.abs(k));

// 关键时刻的天空颜色（顶部、地平线）
const SKY: [number, number, number][] = [
  [0, 0x0d0f14, 0x1a1c24], [300, 0x0d0f14, 0x1a1c24], [360, 0x2c2a38, 0xb06a48], [420, 0x5d7480, 0xd8a679], [540, 0x6f8b98, 0xb7c3c2],
  [960, 0x6f8b98, 0xb7c3c2], [1080, 0x4f5a72, 0xd08a58], [1140, 0x2a2838, 0x8a5240], [1200, 0x0d0f14, 0x1a1c24], [1440, 0x0d0f14, 0x1a1c24],
];
export function skyAt(minute: number): { top: number; horizon: number; night: number } {
  const m = ((minute % 1440) + 1440) % 1440;
  let i = 0; while (i < SKY.length - 2 && SKY[i + 1][0] <= m) i++;
  const [a0, t0, h0] = SKY[i]; const [a1, t1, h1] = SKY[i + 1];
  const k = (m - a0) / Math.max(1, a1 - a0);
  const night = m < 330 || m > 1170 ? 1 : m < 420 ? (420 - m) / 90 : m > 1080 ? (m - 1080) / 90 : 0;
  return { top: mix(t0, t1, k), horizon: mix(h0, h1, k), night };
}
export const rgb = (c: [number, number, number]) => (c[0] << 16) | (c[1] << 8) | c[2];
export const toneColor = (tone?: string) => (tone === 'angry' ? C.angry : tone === 'happy' ? C.happy : tone === 'confused' ? C.confused : 0xe8e4dd);
