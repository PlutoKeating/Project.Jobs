/** 可复现的随机数（mulberry32），World Simulator 与采样器使用，种子会被记录以便确定性重放 */
export class Rng {
  private s: number;
  constructor(public readonly seed: number) { this.s = seed >>> 0; }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  bool(p: number) { return this.next() < p; }
  int(min: number, max: number) { return Math.floor(this.next() * (max - min + 1)) + min; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  weighted<T>(items: readonly { item: T; weight: number }[]): T {
    const total = items.reduce((a, b) => a + Math.max(0, b.weight), 0);
    let r = this.next() * total;
    for (const it of items) { r -= Math.max(0, it.weight); if (r <= 0) return it.item; }
    return items[items.length - 1].item;
  }
  normal(mean = 0, sd = 1) {
    const u = 1 - this.next(); const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  shuffle<T>(arr: T[]): T[] { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
}
export const seedFrom = (s: string) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
