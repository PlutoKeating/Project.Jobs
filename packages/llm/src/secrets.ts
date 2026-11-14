// 凭证的加密存储：AES-256-GCM，密文绑定所属连接（换到别的连接上解不开）。
// 主密钥与业务数据分开：来自环境变量 JOBS_SECRET_KEY；从源码运行且没设置时，在 data/ 下生成一份只有本机用户能读的密钥文件。
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { dataPath } from '@pux/core';

let key: Buffer | undefined;
export function masterKey(): Buffer {
  if (key) return key;
  let raw = process.env.JOBS_SECRET_KEY?.trim();
  if (!raw) {
    const f = dataPath('secret.key');
    if (!existsSync(f)) { mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, randomBytes(32).toString('base64'), { mode: 0o600 }); try { chmodSync(f, 0o600); } catch { /* 非 POSIX 文件系统 */ } }
    raw = readFileSync(f, 'utf8').trim();
  }
  // 任意长度的口令都收敛成 32 字节；本来就是 32 字节的 base64 / hex 原样使用
  const b64 = Buffer.from(raw, 'base64'); const hex = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : undefined;
  key = hex ?? (b64.length === 32 ? b64 : createHash('sha256').update(raw).digest());
  return key;
}
/** 测试用：换一把密钥 */
export const _setMasterKey = (k: Buffer | undefined) => { key = k; };

export function seal(plain: string, bind: string): string {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', masterKey(), iv); c.setAAD(Buffer.from(bind));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1.${iv.toString('base64')}.${c.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function open(cipher: string, bind: string): string {
  const [v, iv, tag, ct] = cipher.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('凭证密文格式不对');
  const d = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(iv, 'base64')); d.setAAD(Buffer.from(bind)); d.setAuthTag(Buffer.from(tag, 'base64'));
  try { return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8'); }
  catch { throw new Error('凭证解不开：主密钥变了，或者这份凭证不属于这个连接'); }
}
