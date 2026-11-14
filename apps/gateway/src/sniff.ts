// 首包嗅探：HTTP / Terraria 原版 / tModLoader
export type Route = 'http' | 'vanilla' | 'tmodloader' | 'unknown' | 'more';

const HTTP_METHODS = ['GET ', 'POST', 'PUT ', 'HEAD', 'OPTI', 'DELE', 'PATC', 'CONN', 'TRAC'];

/** 读取 .NET BinaryWriter 写入的字符串（7 位变长长度前缀 + UTF-8） */
export function readDotnetString(buf: Buffer, off: number): { value: string; end: number } | null {
  let len = 0; let shift = 0; let i = off;
  for (;;) {
    if (i >= buf.length) return null;
    const b = buf[i++]; len |= (b & 0x7f) << shift; shift += 7;
    if (!(b & 0x80)) break;
    if (shift > 28) return null;
  }
  if (i + len > buf.length) return null;
  return { value: buf.subarray(i, i + len).toString('utf8'), end: i + len };
}

/**
 * Terraria 消息格式：[uint16 长度（含头）][uint8 类型][负载]。
 * 客户端第一条消息是 ConnectRequest（类型 1），负载是版本字符串：原版为 "Terraria<release>"，tModLoader 为 "tModLoader v…"。
 */
export function sniff(buf: Buffer): Route {
  if (buf.length < 4) return 'more';
  const head = buf.subarray(0, 4).toString('latin1');
  if (HTTP_METHODS.includes(head)) return 'http';
  if (buf[0] === 0x16) return 'unknown';                 // TLS：本网关不终止 TLS
  const len = buf.readUInt16LE(0);
  if (buf[2] !== 1 || len < 4 || len > 512) return 'unknown';
  if (buf.length < len) return 'more';
  const s = readDotnetString(buf, 3);
  if (!s) return 'unknown';
  if (s.value.startsWith('tModLoader')) return 'tmodloader';
  if (s.value.startsWith('Terraria')) return 'vanilla';
  return 'unknown';
}
