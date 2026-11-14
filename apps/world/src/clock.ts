// 世界时钟：默认与现实 1:1，可暂停、调速、跳转；状态存 NATS KV，重启后延续
import type { Bus } from '@pux/jobsworld';
type KV = Bus['kv'];
import { kvGetJson, kvPutJson, toClock, toMin, type ClockMsg } from '@pux/jobsworld';

const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const nextDate = (date: string) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); return localDate(d); };

export class WorldClock {
  date = localDate();
  minute = new Date().getHours() * 60 + new Date().getMinutes() + new Date().getSeconds() / 60;
  day = 0;
  speed = 1;
  paused = false;
  private last = Date.now();
  onNewDay?: (date: string) => void;

  async restore(kv: KV) {
    const s = await kvGetJson<ClockMsg>(kv, 'clock');
    if (!s) return;
    this.day = s.day;
    // 1:1 且未暂停：直接与现实对齐；否则从上次状态继续
    if (s.speed === 1 && !s.paused) return;
    this.date = s.date; this.minute = s.minute; this.speed = s.speed; this.paused = s.paused;
  }

  tick() {
    const now = Date.now(); const dt = now - this.last; this.last = now;
    if (this.paused) return;
    this.minute += (dt / 60000) * this.speed;
    while (this.minute >= 1440) { this.minute -= 1440; this.date = nextDate(this.date); this.day++; this.onNewDay?.(this.date); }
  }

  set(cmd: { paused?: boolean; speed?: number; jump_to?: string }) {
    if (cmd.paused !== undefined) this.paused = cmd.paused;
    if (cmd.speed !== undefined && cmd.speed > 0 && cmd.speed <= 600) this.speed = cmd.speed;
    if (cmd.jump_to && /^\d{1,2}:\d{2}$/.test(cmd.jump_to)) { const m = toMin(cmd.jump_to); if (m < this.minute) { this.date = nextDate(this.date); this.day++; this.onNewDay?.(this.date); } this.minute = m; }
    if (cmd.speed === 1 && !this.paused) { const n = new Date(); this.date = localDate(n); this.minute = n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60; }
  }

  msg(): ClockMsg { return { date: this.date, day: this.day, minute: this.minute, clock: toClock(this.minute), speed: this.speed, paused: this.paused, real_ts: Date.now() }; }
}
