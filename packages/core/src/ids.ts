import { customAlphabet } from 'nanoid';
import { createHash } from 'node:crypto';

const alpha = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
/** 带前缀的可读 ID，例如 ses_x1y2z3... */
export const newId = (prefix: string) => `${prefix}_${alpha()}`;
export const sha256 = (data: string | Buffer | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const shortHash = (data: string, n = 12) => sha256(data).slice(0, n);
/** 稳定 JSON 序列化（键排序），用于版本哈希与指纹 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
}
