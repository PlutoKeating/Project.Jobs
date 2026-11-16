// 部署到 Cloudflare 上的转发 Worker：只转发，不存任何东西。
// 收到一封信 → 读出原始邮件（MIME）→ 用签名密钥做 HMAC → POST 到 <公网链接>/inbound/email。
// 收信、解析、存储全在 Jobs 容器里。Jobs 回答 4xx（不认识的收件人、签名不对）时退信，5xx 或连不上时抛错（让对方稍后重投）。

export const WORKER_NAME = 'jobsworld-mail';
export const WORKER_COMPAT_DATE = '2026-06-01';
/** 单封信的上限（字节）：再大的信不转发，直接退回 */
export const MAX_MAIL_BYTES = 10 * 1024 * 1024;

export const WORKER_SOURCE = `// JobsWorld 居民邮箱的转发 Worker（由 Jobs 自动部署，请不要手动修改）
const MAX = ${MAX_MAIL_BYTES};
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export default {
  async email(message, env) {
    if (message.rawSize > MAX) { message.setReject('Message too large'); return; }
    const raw = await new Response(message.raw).arrayBuffer();
    const ts = String(Date.now());
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.JOBS_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const head = new TextEncoder().encode(ts + '.' + message.to + '.');
    const body = new Uint8Array(head.length + raw.byteLength); body.set(head, 0); body.set(new Uint8Array(raw), head.length);
    const sig = hex(await crypto.subtle.sign('HMAC', key, body));
    const res = await fetch(env.JOBS_INBOUND_URL, {
      method: 'POST',
      headers: { 'content-type': 'message/rfc822', 'x-jobs-timestamp': ts, 'x-jobs-to': message.to, 'x-jobs-from': message.from, 'x-jobs-signature': sig },
      body: raw,
    });
    if (res.ok) return;
    if (res.status >= 400 && res.status < 500) { message.setReject('Mailbox unavailable'); return; }
    throw new Error('Jobs inbound returned ' + res.status);
  },
};
`;
