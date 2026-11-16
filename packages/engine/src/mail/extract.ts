// 从一封信里认出验证码和链接。只作仪器（工程附录里的「信多久才到」「他是不是抄错了码」），从不交给居民：
// 居民要自己切到邮箱、看信、记住验证码、切回来输入。

const CODE_HINT = /(验证码|校验码|动态码|确认码|安全码|登录码|code|otp|passcode|pin|one[- ]time|verification|verify|confirm)/i;
const LINK_HINT = /(verify|verification|confirm|activate|magic|login|log-in|signin|sign-in|auth|token|reset|invite|validate|callback)/i;

/** 正文里像验证码的串：4–8 位数字，或 6–8 位大写字母加数字；靠近「验证码 / code」等字样的排在前面。排除年份、电话、日期样的数字 */
export function findCodes(text: string): string[] {
  const out: { code: string; score: number }[] = [];
  const re = /(?<![\w-])([0-9]{4,8}|[A-Z0-9]{6,8})(?![\w-])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const code = m[1];
    if (/^[A-Z]+$/.test(code)) continue;                       // 纯字母是单词
    if (/[A-Z]/.test(code) && !/[0-9]/.test(code)) continue;
    if (/^(19|20)\d{2}$/.test(code)) continue;                 // 年份
    const around = text.slice(Math.max(0, m.index - 80), m.index + code.length + 40);
    if (/(\d{3,4}[- ]\d{3,4})|(\+\d)|电话|phone|tel/i.test(around) && !CODE_HINT.test(around)) continue;
    let score = CODE_HINT.test(around) ? 2 : 0;
    if (/^\d{6}$/.test(code)) score += 1;
    out.push({ code, score });
  }
  const seen = new Set<string>();
  return out.sort((a, b) => b.score - a.score).filter((x) => x.score > 0 && !seen.has(x.code) && seen.add(x.code)).map((x) => x.code).slice(0, 4);
}

/** 信里的链接：像验证、登录、确认用的排在前面；去掉退订、图片、追踪像素 */
export function findLinks(html: string | undefined, text: string): string[] {
  const urls = new Set<string>();
  if (html) for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) urls.add(m[1].replace(/&amp;/g, '&'));
  for (const m of text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)) urls.add(m[0]);
  const list = [...urls].filter((u) => /^https?:\/\//i.test(u) && !/unsubscribe|退订|\.(png|jpe?g|gif|svg)(\?|$)/i.test(u));
  return list.sort((a, b) => Number(LINK_HINT.test(b)) - Number(LINK_HINT.test(a))).slice(0, 8);
}
