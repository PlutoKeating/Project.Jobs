#!/usr/bin/env node
// tModLoader 无界面探针：模拟一个 tModLoader 客户端完成握手并进入世界，验证 JobsWorld mod 的服务端行为。
// 只用 Node 内置模块。用法：
//   node game/tmodloader/tools/tml-probe.mjs [host] [port] [--version "tModLoader v2026.9.3.1!2026.9.3"] [--cmd "/jw who"]… [--ask 人名] [--wait 8] [--download] [--password 密码]
// 默认连 127.0.0.1:57778（tml 容器）；连 127.0.0.1:7777 可同时验证网关按握手版本串分流。
// 输出：服务端 mod 列表、分配的槽位、看到的假玩家（槽位 / 名字 / 位置）、头顶气泡、HUD / 名册 / 详情 ModPacket、/jw who 的回复。
import net from 'node:net';

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const VALUED = ['--version', '--ask', '--wait', '--password', '--cmd'];
const cmds = argv.flatMap((a, i) => (a === '--cmd' ? [argv[i + 1]] : []));
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && VALUED.includes(argv[i - 1])));
const host = pos[0] ?? '127.0.0.1';
const port = Number(pos[1] ?? 57778);
const version = opt('--version', 'tModLoader v2026.9.3.1!2026.9.3');
const waitS = Number(opt('--wait', '8'));
const password = opt('--password', '');
const download = argv.includes('--download');
const PROBE_NAME = `probe${Math.floor(Math.random() * 1000)}`;

// ---- 编码 ----
const str = (s) => { const b = Buffer.from(s, 'utf8'); const p = []; let n = b.length; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; p.push(x); } while (n); return Buffer.concat([Buffer.from(p), b]); };
const u8 = (v) => Buffer.from([v & 0xff]);
const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16LE(v); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b; };
const rgb = (r, g, b) => Buffer.from([r, g, b]);
const packet = (type, ...parts) => { const body = Buffer.concat([u8(type), ...parts]); const out = Buffer.concat([u16(body.length + 2), body]); return out; };

// ---- 解码 ----
class R {
  constructor(b) { this.b = b; this.o = 0; }
  u8() { return this.b[this.o++]; }
  bool() { return this.u8() !== 0; }
  i16() { const v = this.b.readInt16LE(this.o); this.o += 2; return v; }
  u16() { const v = this.b.readUInt16LE(this.o); this.o += 2; return v; }
  i32() { const v = this.b.readInt32LE(this.o); this.o += 4; return v; }
  f32() { const v = this.b.readFloatLE(this.o); this.o += 4; return v; }
  bytes(n) { const v = this.b.subarray(this.o, this.o + n); this.o += n; return v; }
  str() { let len = 0, shift = 0; for (;;) { const x = this.u8(); len |= (x & 0x7f) << shift; shift += 7; if (!(x & 0x80)) break; } return this.bytes(len).toString('utf8'); }
  ntext() { const mode = this.u8(); const t = this.str(); if (mode !== 0) { const n = this.u8(); const subs = []; for (let i = 0; i < n; i++) subs.push(this.ntext()); return subs.length ? `${t} ${JSON.stringify(subs)}` : t; } return t; }
}

const state = { slot: -1, netIds: null, jwNet: -1, joined: false, mods: [], fakes: new Map(), bubbles: [], chat: [], hud: null, roster: null, hello: null, detail: null, answer: null, kicked: null, modBytes: 0 };
const sock = net.connect(port, host, () => sock.write(packet(1, str(version))));
const send = (b) => sock.write(b);
const modPacket = (pkt, ...parts) => packet(250, u8(state.jwNet), u8(pkt), ...parts);

function onPacket(type, r) {
  switch (type) {
    case 2: state.kicked = r.ntext(); break;
    case 37: if (password) send(packet(38, str(password))); else state.kicked = '需要密码（--password）'; break;
    case 251: { // SyncMods
      const n = r.i32();
      for (let i = 0; i < n; i++) { const name = r.str(); const ver = r.str(); r.bytes(20); const cfg = r.i32(); for (let j = 0; j < cfg; j++) { r.str(); r.str(); } state.mods.push(`${name} v${ver}`); }
      send(packet(251));
      break;
    }
    case 252: { // 模组文件（--download 时）
      state.modBytes += r.b.length;
      break;
    }
    case 3: { // 分配槽位 → 发送玩家信息并请求世界
      state.slot = r.u8();
      const s = state.slot;
      send(packet(4, u8(s), u8(0), u8(0), str(PROBE_NAME), u8(0), u16(0), u8(0), rgb(30, 20, 20), rgb(240, 200, 160), rgb(60, 40, 30), rgb(120, 140, 120), rgb(230, 230, 220), rgb(60, 70, 90), rgb(60, 40, 30), u8(0), u8(0), u8(0)));
      send(packet(68, str('00000000-0000-0000-0000-000000000000')));
      send(packet(16, u8(s), i16(100), i16(100)));
      send(packet(42, u8(s), i16(20), i16(20)));
      send(packet(6));
      break;
    }
    case 7: if (!state.worldRequested) { state.worldRequested = true; send(packet(8, i32(-1), i32(-1))); } break;
    case 49: send(packet(12, u8(state.slot), i16(-1), i16(-1), i32(0), i16(0), i16(0), u8(1))); state.joined = true; setTimeout(afterJoin, 1500); break;
    case 14: { const slot = r.u8(); const active = r.u8(); if (slot >= 100) { const f = state.fakes.get(slot) ?? { slot }; f.active = active === 1; state.fakes.set(slot, f); } break; }
    case 4: { const slot = r.u8(); r.u8(); const hair = r.u8(); const name = r.str(); if (slot >= 100) { const f = state.fakes.get(slot) ?? { slot }; f.name = name; f.hair = hair; state.fakes.set(slot, f); } break; }
    case 13: { const slot = r.u8(); r.u8(); const b2 = r.u8(); r.u8(); r.u8(); r.u8(); const x = r.f32(), y = r.f32(); if (slot >= 100 && state.fakes.has(slot)) { const f = state.fakes.get(slot); f.x = Math.round(x / 16); f.y = Math.round(y / 16); f.moves = (f.moves ?? 0) + 1; } void b2; break; }
    case 82: { // NetModules：1 = 文本（聊天 / 头顶气泡）
      const mod = r.u16();
      if (mod !== 1) break;
      const author = r.u8(); const text = r.ntext();
      if (author >= 100 && author < 255) state.bubbles.push(`#${author} ${state.fakes.get(author)?.name ?? '?'}: ${text}`);
      else state.chat.push(text);
      break;
    }
    case 250: {
      if (!state.netIds) { const n = r.i32(); state.netIds = []; for (let i = 0; i < n; i++) state.netIds.push(r.str()); state.jwNet = state.netIds.indexOf('JobsWorld'); break; }
      const net = state.netIds.length < 256 ? r.u8() : r.i16();
      if (net !== state.jwNet) break;
      const pkt = r.u8();
      if (pkt === 1) { state.hello = { apiBase: r.str(), evidenceKey: r.str(), admin: r.bool(), en: r.bool(), town: r.str(), places: r.u16() }; }
      else if (pkt === 2) { const n = r.u16(); const list = []; for (let i = 0; i < n; i++) list.push({ slot: r.u8(), id: r.str(), name: r.str(), occupation: r.str(), age: r.u16(), mode: r.str(), app: r.str(), activity: r.str() }); state.roster = list; }
      else if (pkt === 3) { state.hud = { clock: r.str(), date: r.str(), paused: r.bool(), speed: r.f32(), using: r.u16(), total: r.u16() }; }
      else if (pkt === 4) { const id = r.str(); const ok = r.bool(); const json = r.str(); state.detail = { id, ok, bytes: Buffer.byteLength(json), json }; }
      else if (pkt === 5) { state.answer = { id: r.str(), ok: r.bool(), text: r.str() }; }
      break;
    }
  }
}

function afterJoin() {
  // 聊天命令 /jw who（NetTextModule 客户端消息：模块 1，命令 "Say"，文本）
  (cmds.length ? cmds : ['/jw who']).forEach((c, i) => setTimeout(() => send(packet(82, u16(1), str('Say'), str(c))), i * 400));
  if (state.jwNet >= 0 && state.roster?.length) {
    const target = state.roster.find((e) => e.app) ?? state.roster[0];
    send(modPacket(20, str(target.id)));                       // DetailReq
    const askName = opt('--ask', '');
    if (askName) send(modPacket(21, str(state.roster.find((e) => e.name.includes(askName))?.id ?? askName), str('你觉得刚才那个软件怎么样？')));
  }
  if (download) send(packet(252, str('JobsWorld')));
}

let buf = Buffer.alloc(0);
sock.on('data', (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 2) {
    const len = buf.readUInt16LE(0);
    if (len < 3 || buf.length < len) break;
    const type = buf[2];
    const body = buf.subarray(3, len);
    buf = buf.subarray(len);
    try { onPacket(type, new R(body)); } catch (e) { /* 忽略解析不到的包 */ }
  }
});
sock.on('error', (e) => { console.error('连接错误：', e.message); process.exit(1); });

setTimeout(() => {
  const fakes = [...state.fakes.values()].filter((f) => f.active);
  console.log(JSON.stringify({
    target: `${host}:${port}`, version, kicked: state.kicked, mods: state.mods, slot: state.slot, joined: state.joined,
    fake_players: { count: fakes.length, sample: fakes.slice(0, 6).map((f) => ({ slot: f.slot, name: f.name, x: f.x, y: f.y, moves: f.moves ?? 0 })) },
    bubbles: state.bubbles.slice(0, 8), chat: state.chat.slice(0, 30),
    hello: state.hello, hud: state.hud, roster: state.roster ? { count: state.roster.length, sample: state.roster.slice(0, 3) } : null,
    detail: state.detail ? { id: state.detail.id, ok: state.detail.ok, bytes: state.detail.bytes, head: state.detail.json.slice(0, 300) } : null,
    answer: state.answer, mod_download_bytes: download ? state.modBytes : undefined,
  }, null, 2));
  sock.destroy();
  process.exit(state.kicked ? 2 : 0);
}, waitS * 1000);
