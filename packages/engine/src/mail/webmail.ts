// 居民手机 / 电脑上的邮箱 App：在这次使用的浏览器里拦截 https://mail.<邮件域名>/ 的请求，直接用收件箱里的信画出页面（不经过网络）。
// 居民像看产品一样只看截图：点开一封信、看清验证码、记住、切回去输入；点信里的链接会真的在这个浏览器里打开。
import type { BrowserContext, Route } from 'playwright';
import { and, desc, eq, getDb, isNull, mailbox, residents } from '@pux/db';

export const webmailOrigin = (domain: string) => `https://mail.${domain}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const senderName = (s: string | null) => (s ?? '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || (s ?? '');

function when(d: Date, zh: boolean, now = new Date()): string {
  const same = d.toDateString() === now.toDateString();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (same) return hm;
  return zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const STYLE = `
*{box-sizing:border-box}body{margin:0;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#1f2328;background:#f6f7f9}
header{position:sticky;top:0;background:#fff;border-bottom:1px solid #e4e6ea;padding:14px 18px;display:flex;align-items:center;gap:12px;z-index:2}
header h1{font-size:19px;margin:0;font-weight:600}header .me{color:#6b7280;font-size:13px;margin-left:auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
a.back{color:#2563eb;text-decoration:none;font-size:15px}
ul{list-style:none;margin:0;padding:0;background:#fff}
li a{display:block;padding:12px 18px;border-bottom:1px solid #eef0f3;color:inherit;text-decoration:none}
li .top{display:flex;gap:8px;align-items:baseline}li .from{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li .time{color:#6b7280;font-size:13px}li .subj{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li .snip{color:#6b7280;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
li.unread .from,li.unread .subj{font-weight:700}li.unread .dot{width:8px;height:8px;border-radius:50%;background:#2563eb;display:inline-block}
.empty{padding:60px 18px;text-align:center;color:#6b7280}
.msg{background:#fff;min-height:calc(100vh - 56px)}.msg .meta{padding:16px 18px;border-bottom:1px solid #eef0f3}
.msg h2{font-size:18px;margin:0 0 8px}.msg .who{color:#4b5563;font-size:13px}
.msg .body{padding:16px 18px}.msg pre{white-space:pre-wrap;word-break:break-word;font:inherit;margin:0}
.msg iframe{width:100%;border:0;display:block;min-height:300px}
.refresh{display:block;text-align:center;padding:14px;color:#2563eb;text-decoration:none;font-size:14px}`;

function page(title: string, body: string, zh: boolean, mobile: boolean): string {
  return `<!doctype html><html lang="${zh ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}${mobile ? '' : 'main{max-width:860px;margin:0 auto}'}</style></head><body><main>${body}</main></body></html>`;
}

/** 收件箱 */
export async function renderInbox(personaId: string, zh: boolean, mobile: boolean): Promise<string> {
  const db = getDb();
  const [me] = await db.select({ email: residents.email }).from(residents).where(eq(residents.persona_id, personaId));
  const rows = await db.select().from(mailbox).where(and(eq(mailbox.persona_id, personaId), eq(mailbox.kind, 'email'))).orderBy(desc(mailbox.created_at)).limit(50);
  const items = rows.map((m) => `<li class="${m.opened_at ? '' : 'unread'}"><a href="/m/${m.id}"><div class="top">${m.opened_at ? '' : '<span class="dot"></span>'}<span class="from">${esc(senderName(m.sender))}</span><span class="time">${when(m.created_at, zh)}</span></div><div class="subj">${esc(m.subject || (zh ? '（无主题）' : '(no subject)'))}</div><div class="snip">${esc(m.body.replace(/\s+/g, ' ').slice(0, 90))}</div></a></li>`).join('');
  const title = zh ? '收件箱' : 'Inbox';
  return page(title, `<header><h1>${title}</h1><span class="me">${esc(me?.email ?? '')}</span></header>${rows.length ? `<ul>${items}</ul>` : `<div class="empty">${zh ? '还没有邮件' : 'No mail yet'}</div>`}<a class="refresh" href="/">${zh ? '刷新' : 'Refresh'}</a>`, zh, mobile);
}

/** 一封信。HTML 邮件放进沙箱 iframe（不执行脚本），链接在这个标签页里打开；纯文本邮件里的网址做成可点的链接 */
export async function renderMessage(personaId: string, id: string, zh: boolean, mobile: boolean): Promise<string | undefined> {
  const db = getDb();
  const [m] = await db.select().from(mailbox).where(and(eq(mailbox.id, id), eq(mailbox.persona_id, personaId)));
  if (!m) return undefined;
  if (!m.opened_at) await db.update(mailbox).set({ opened_at: new Date() }).where(and(eq(mailbox.id, id), isNull(mailbox.opened_at)));
  const body = m.html
    ? `<iframe id="mail" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${esc(`<base target="_top"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;word-break:break-word}img{max-width:100%;height:auto}</style>${m.html.replace(/<script[\s\S]*?<\/script>/gi, '')}`)}"></iframe><script>const f=document.getElementById('mail');const fit=()=>{try{f.style.height=(f.contentDocument.documentElement.scrollHeight+8)+'px'}catch(e){}};f.addEventListener('load',()=>{fit();setTimeout(fit,400);setTimeout(fit,1500)});</script>`
    : `<pre>${esc(m.body).replace(/https?:\/\/[^\s<>"]+/g, (u) => `<a href="${u}">${u}</a>`)}</pre>`;
  const title = m.subject || (zh ? '（无主题）' : '(no subject)');
  return page(title, `<header><a class="back" href="/">‹ ${zh ? '收件箱' : 'Inbox'}</a></header><div class="msg"><div class="meta"><h2>${esc(title)}</h2><div class="who">${esc(m.sender ?? '')} · ${when(m.created_at, zh)}</div></div><div class="body">${body}</div></div>`, zh, mobile);
}

/** 在这次使用的浏览器里装上邮箱 App */
export async function installWebmail(ctx: BrowserContext, o: { personaId: string; domain: string; zh: boolean; mobile: boolean }): Promise<string> {
  const origin = webmailOrigin(o.domain);
  await ctx.route(`${origin}/**`, async (route: Route) => {
    const u = new URL(route.request().url());
    const html = u.pathname.startsWith('/m/') ? await renderMessage(o.personaId, u.pathname.slice(3), o.zh, o.mobile) : await renderInbox(o.personaId, o.zh, o.mobile);
    if (!html) return route.fulfill({ status: 302, headers: { location: `${origin}/` } });
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', headers: { 'cache-control': 'no-store' }, body: html });
  });
  return `${origin}/`;
}
