import { describe, expect, it } from 'vitest';
import { sniff } from '../apps/gateway/src/sniff.ts';

const connect = (v: string) => { const s = Buffer.from(v, 'utf8'); const body = Buffer.concat([Buffer.from([1, s.length]), s]); const h = Buffer.alloc(2); h.writeUInt16LE(body.length + 2); return Buffer.concat([h, body]); };

describe('网关首包嗅探', () => {
  it('HTTP 请求走网页', () => { expect(sniff(Buffer.from('GET / HTTP/1.1\r\n'))).toBe('http'); expect(sniff(Buffer.from('POST /api'))).toBe('http'); });
  it('原版 Terraria 握手走 TShock', () => { expect(sniff(connect('Terraria315'))).toBe('vanilla'); });
  it('tModLoader 握手走 tML', () => { expect(sniff(connect('tModLoader v2026.9.3.1'))).toBe('tmodloader'); });
  it('数据不够时等待，乱码拒绝', () => { expect(sniff(connect('Terraria315').subarray(0, 6))).toBe('more'); expect(sniff(Buffer.from([0x16, 3, 1, 0]))).toBe('unknown'); expect(sniff(Buffer.from([9, 0, 7, 0, 0, 0]))).toBe('unknown'); });
});
