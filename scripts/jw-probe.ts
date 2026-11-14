// JobsWorld 游戏服探针：一个最小的原版 Terraria 1.4.5.8 协议客户端（无第三方依赖）。
// 用法：npx tsx scripts/jw-probe.ts [--host 127.0.0.1] [--port 57777] [--password xxx] [--name Probe]
//                                   [--secs 25] [--cmd "/jw who"]...
// 完成握手并出生后持续监听，打印：世界名、PlayerInfo/PlayerActive 中的玩家（应包含人物假玩家）、
// 每个玩家收到的 PlayerUpdate 次数与最后位置、聊天消息（含作者槽位，人物气泡即作者为假玩家的聊天）、
// 以及从图格分区里解出的告示牌文字（证明城镇已建成并下发到客户端）。
import net from 'node:net';
import { inflateRawSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

const RELEASE = 326; // Terraria 1.4.5.8 的 curRelease；握手串为 "Terraria326"
const argv = process.argv.slice(2);
const arg = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const cmds: string[] = []; argv.forEach((a, i) => { if (a === '--cmd') cmds.push(argv[i + 1]); });
const host = arg('host', '127.0.0.1')!; const port = Number(arg('port', '57777'));
const password = arg('password', process.env.JW_GAME_PASSWORD ?? '')!; const myName = arg('name', `Probe${Math.floor(Math.random() * 900 + 100)}`)!;
const secs = Number(arg('secs', '25'));

// ---- 编解码 ----
class W {
  b: number[] = [];
  u8(v: number) { this.b.push(v & 255); return this; }
  bool(v: boolean) { return this.u8(v ? 1 : 0); }
  u16(v: number) { return this.u8(v).u8(v >> 8); }
  i16(v: number) { return this.u16(v & 0xffff); }
  i32(v: number) { const x = Buffer.alloc(4); x.writeInt32LE(v); this.b.push(...x); return this; }
  f32(v: number) { const x = Buffer.alloc(4); x.writeFloatLE(v); this.b.push(...x); return this; }
  str(s: string) { const u = Buffer.from(s, 'utf8'); let n = u.length; do { let c = n & 0x7f; n >>= 7; if (n) c |= 0x80; this.u8(c); } while (n); this.b.push(...u); return this; }
  rgb(r: number, g: number, b: number) { return this.u8(r).u8(g).u8(b); }
}
class R {
  o = 0; constructor(public b: Buffer) {}
  u8() { return this.b[this.o++]; }
  bool() { return this.u8() !== 0; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  str() { let n = 0, s = 0, c; do { c = this.u8(); n |= (c & 0x7f) << s; s += 7; } while (c & 0x80); const v = this.b.toString('utf8', this.o, this.o + n); this.o += n; return v; }
  /** NetworkText：mode(0 字面 / 1 格式化 / 2 本地化键) + 文本 + 子项 */
  ntext(): string { const mode = this.u8(); const t = this.str(); if (mode === 0) return t; const n = this.u8(); const subs = Array.from({ length: n }, () => this.ntext()); return subs.length ? `${t} {${subs.join(', ')}}` : t; }
}

const sock = net.connect({ host, port });
let slot = -1; let worldName = ''; let spawn = { x: -1, y: -1 };
const players = new Map<number, { name?: string; active?: boolean; updates: number; x?: number; y?: number; vx?: number }>();
const chats: { author: number; name: string; text: string; color: string }[] = [];
const signs = new Set<string>();
let timeSync = 0; let lastTime = '';
let sections = 0; let sectionBytes = 0; let kicked = ''; let firstTime = '';
const P = (i: number) => { let p = players.get(i); if (!p) { p = { updates: 0 }; players.set(i, p); } return p; };

function send(type: number, w: W = new W()) {
  const len = w.b.length + 3; const h = Buffer.alloc(3); h.writeUInt16LE(len); h[2] = type;
  sock.write(Buffer.concat([h, Buffer.from(w.b)]));
}

function hello() {
  // 玩家信息：外观随便给，名字用于在服务器上显示
  const w = new W().u8(slot).u8(0).u8(1).f32(0).u8(0).str(myName).u8(0).u16(0).u8(0);
  for (const c of [[215, 90, 55], [255, 125, 90], [105, 90, 75], [175, 165, 140], [160, 180, 215], [255, 230, 175], [160, 105, 60]]) w.rgb(c[0], c[1], c[2]);
  w.u8(0).u8(0).u8(0);
  send(4, w);
  send(68, new W().str(randomUUID()));
  send(16, new W().u8(slot).i16(100).i16(100));
  send(42, new W().u8(slot).i16(20).i16(20));
  send(50, new W().u8(slot).u16(0));
  send(6);
}

function chat(text: string) { send(82, new W().u16(1).str('Say').str(text)); }

/** 在解压后的分区数据里找 .NET 字符串形式的告示牌文字（含换行与中文） */
function scanSigns(buf: Buffer) {
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (let i = 0; i < buf.length - 4; i++) {
    const n = buf[i]; if (n < 4 || n > 127 || i + 1 + n > buf.length) continue;
    try { const s = dec.decode(buf.subarray(i + 1, i + 1 + n)); if (s.includes('\n') && /[一-鿿]/.test(s) && !/[\u0000-\u0009\u000b-\u001f]/.test(s)) signs.add(s.replace('\n', ' / ')); } catch { /* 非字符串 */ }
  }
}

function onPacket(type: number, r: R) {
  switch (type) {
    case 2: kicked = r.ntext(); console.log(`✗ 被服务器断开：${kicked}`); break;
    case 3: slot = r.u8(); console.log(`✓ 分配到槽位 ${slot}`); hello(); break;
    case 37: console.log('… 服务器要求密码'); send(38, new W().str(password)); break;
    case 7: {
      r.i32(); r.u8(); r.u8(); r.i16(); r.i16(); spawn = { x: r.i16(), y: r.i16() }; r.i16(); r.i16(); r.i32(); worldName = r.str();
      if (!firstTime) { firstTime = 'x'; console.log(`✓ 世界：${worldName}，出生点 (${spawn.x}, ${spawn.y})`); send(8, new W().i32(spawn.x).i32(spawn.y).u8(0)); }
      break;
    }
    case 49: send(12, new W().u8(slot).i16(-1).i16(-1).i32(0).i16(0).i16(0).u8(0).u8(1)); console.log('✓ 已出生（SpawnPlayer）');
      setTimeout(() => cmds.forEach((c, i) => setTimeout(() => { console.log(`→ 发送：${c}`); chat(c); }, i * 1500)), 2500);
      break;
    case 4: { const s = r.u8(); r.u8(); r.u8(); r.f32(); r.u8(); const name = r.str(); const p = P(s); if (p.name !== name) console.log(`  PlayerInfo #${s} ${name}`); p.name = name; break; }
    case 14: { const s = r.u8(); const a = r.u8() === 1; const p = P(s); if (p.active !== a) console.log(`  PlayerActive #${s} ${a ? '上线' : '下线'}${p.name ? ' ' + p.name : ''}`); p.active = a; break; }
    case 13: { const s = r.u8(); r.u8(); const f2 = r.u8(); r.u8(); r.u8(); r.u8(); const x = r.f32(), y = r.f32(); const p = P(s); p.updates++; p.x = x; p.y = y; if (f2 & 4) { p.vx = r.f32(); r.f32(); } else p.vx = 0; break; }
    case 18: { const day = r.u8() === 1; const t = r.i32(); timeSync++; const m = day ? 270 + t / 60 : (1170 + t / 60) % 1440; lastTime = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}（${day ? '白天' : '夜晚'} time=${t}）`; break; }
    case 10: { sections++; sectionBytes += r.b.length; try { scanSigns(inflateRawSync(r.b)); } catch { /* 部分分区未压缩 */ } break; }
    case 82: {
      const mod = r.u16();
      if (mod === 1) { const author = r.u8(); const text = r.ntext(); const c = `${r.u8()},${r.u8()},${r.u8()}`; const name = author === 255 ? '服务器' : (players.get(author)?.name ?? `#${author}`); chats.push({ author, name, text, color: c }); console.log(`  💬 [${author === 255 ? 'server' : '#' + author}] ${name}: ${text}  (rgb ${c})`); }
      break;
    }
  }
}

let pending = Buffer.alloc(0);
sock.on('connect', () => { console.log(`连接 ${host}:${port}，握手 "Terraria${RELEASE}"`); send(1, new W().str(`Terraria${RELEASE}`)); });
sock.on('data', (d) => {
  pending = Buffer.concat([pending, d]);
  while (pending.length >= 2) {
    const len = pending.readUInt16LE(0); if (len < 3 || pending.length < len) break;
    const type = pending[2]; const body = pending.subarray(3, len); pending = pending.subarray(len);
    try { onPacket(type, new R(Buffer.from(body))); } catch (e) { console.log(`  （解析 ${type} 失败：${(e as Error).message}）`); }
  }
});
sock.on('error', (e) => { console.log(`✗ 连接错误：${e.message}`); process.exit(2); });
sock.on('close', () => { if (!done) summary(); });

let done = false;
function summary() {
  done = true;
  const fakes = [...players.entries()].filter(([s, p]) => s !== slot && p.name);
  console.log('\n===== 汇总 =====');
  console.log(`世界：${worldName || '?'}　我的槽位：${slot}　图格分区：${sections} 个（${(sectionBytes / 1024).toFixed(0)} KB）`);
  console.log(`其他玩家 ${fakes.length} 个：`);
  for (const [s, p] of fakes.sort((a, b) => b[0] - a[0])) console.log(`  #${s} ${p.name}  active=${p.active}  PlayerUpdate×${p.updates}  pos=(${p.x !== undefined ? (p.x / 16).toFixed(1) : '?'}, ${p.y !== undefined ? ((p.y + 42) / 16).toFixed(1) : '?'})${p.vx ? ' 走动中' : ''}`);
  const bubbles = chats.filter((c) => c.author !== 255 && c.author !== slot);
  console.log(`时间同步 SetTime×${timeSync}，最后一次对应世界时钟 ${lastTime || '?'}`);
  console.log(`聊天 ${chats.length} 条，其中假玩家气泡 ${bubbles.length} 条`);
  console.log(`告示牌（从图格分区解出）${signs.size} 个：${[...signs].slice(0, 12).join(' | ')}`);
  sock.destroy();
  process.exit(kicked ? 1 : 0);
}
setTimeout(summary, secs * 1000);
