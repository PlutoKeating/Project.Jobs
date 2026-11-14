// 注入到被测页面的脚本。全部以字符串形式注入，避免打包差异。
// 注意：这些脚本只做观测与打断模拟，不改变产品逻辑。

/** context 级 init script：DOM 变更计数、通知拦截、页面可见性控制 */
export const INIT_SCRIPT = String.raw`
(() => {
  if (window.__pux) return;
  const pux = window.__pux = { mutations: 0, notifications: [], hidden: false, lastMutationAt: Date.now() };
  const start = () => {
    try {
      new MutationObserver((ms) => { pux.mutations += ms.length; pux.lastMutationAt = Date.now(); })
        .observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch (e) {}
  };
  if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start);
  // 通知：授予权限并记录（Observation.notifications）
  try {
    const N = function (title, opts) { pux.notifications.push({ title: String(title), body: opts && opts.body ? String(opts.body) : '', at: Date.now() }); this.close = () => {}; };
    N.permission = 'granted';
    N.requestPermission = (cb) => { const p = Promise.resolve('granted'); if (cb) cb('granted'); return p; };
    Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true });
  } catch (e) {}
  // 页面可见性：供 switch_away / lock 打断使用
  try {
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return pux.hidden; } });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return pux.hidden ? 'hidden' : 'visible'; } });
    const origHasFocus = Document.prototype.hasFocus;
    Document.prototype.hasFocus = function () { return pux.hidden ? false : origHasFocus.call(this); };
  } catch (e) {}
  // 下拉框：系统原生的选项列表不在页面里，无界面浏览器的截图拍不到它，人物也就看不见。
  // 这里在页面里画一个样子相同的列表（点开 → 看见选项 → 点选），只替代系统控件的显示，不改变产品逻辑。
  try {
    let pop = null;
    const close = () => { if (pop) { pop.remove(); pop = null; } };
    const open = (sel) => {
      close();
      const r = sel.getBoundingClientRect(); const cs = getComputedStyle(sel);
      pop = document.createElement('div');
      pop.setAttribute('data-pux-select', '1'); pop.setAttribute('role', 'listbox');
      const below = window.innerHeight - r.bottom; const maxH = Math.max(120, Math.min(320, (below > 160 ? below : r.top) - 8));
      pop.style.cssText = 'position:fixed;z-index:2147483647;background:#fff;color:#111;border:1px solid #9aa0a6;border-radius:4px;box-shadow:0 4px 16px rgba(0,0,0,.25);overflow:auto;box-sizing:border-box;padding:4px 0;font-family:' + cs.fontFamily + ';font-size:' + cs.fontSize + ';left:' + Math.max(4, r.left) + 'px;min-width:' + Math.max(120, r.width) + 'px;max-height:' + maxH + 'px;' + (below > 160 ? 'top:' + (r.bottom + 2) + 'px;' : 'bottom:' + (window.innerHeight - r.top + 2) + 'px;');
      Array.from(sel.options).forEach((o, i) => {
        const it = document.createElement('div');
        it.setAttribute('role', 'option'); it.textContent = o.text;
        it.style.cssText = 'padding:7px 14px;cursor:pointer;white-space:nowrap;' + (o.disabled ? 'color:#9aa0a6;' : '') + (i === sel.selectedIndex ? 'background:#1a73e8;color:#fff;' : '');
        if (!o.disabled) it.addEventListener('mousedown', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (sel.selectedIndex !== i) { sel.selectedIndex = i; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
          close();
        }, true);
        pop.appendChild(it);
      });
      document.documentElement.appendChild(pop);
    };
    document.addEventListener('mousedown', (e) => {
      const t = e.target;
      if (pop && pop.contains(t)) return;
      const sel = t && t.closest ? t.closest('select') : null;
      if (sel && !sel.multiple && !sel.disabled && !(sel.size > 1)) { e.preventDefault(); if (pop) close(); else { sel.focus(); open(sel); } return; }
      close();
    }, true);
    window.addEventListener('scroll', (e) => { if (pop && e.target === pop) return; close(); }, true); window.addEventListener('blur', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
  } catch (e) {}
  pux.setHidden = (h) => {
    pux.hidden = !!h;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event(h ? 'blur' : 'focus'));
    if (h) window.dispatchEvent(new Event('pagehide')); else window.dispatchEvent(new Event('pageshow'));
  };
})();
`;

/** 抽取页面元素：可交互元素 + 文本块 + 标题 + 图片。返回 UIElement[] 与页面信息 */
export const EXTRACT_SCRIPT = String.raw`
(() => {
  const out = []; let n = 0;
  const vw = window.innerWidth, vh = window.innerHeight;
  const xpath = (el) => {
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && document.querySelectorAll('#' + el.id).length === 1) return '//*[@id="' + el.id + '"]';
    const parts = [];
    for (let e = el; e && e.nodeType === 1; e = e.parentNode) {
      let i = 1; for (let s = e.previousElementSibling; s; s = s.previousElementSibling) if (s.nodeName === e.nodeName) i++;
      parts.unshift(e.nodeName.toLowerCase() + '[' + i + ']');
      if (e === document.documentElement) break;
    }
    return '/' + parts.join('/');
  };
  const visible = (el, r) => {
    if (r.width <= 1.5 || r.height <= 1.5) return false;        // 含「只给读屏软件看」的 1px 隐藏文字
    const cs = getComputedStyle(el);
    if (cs.clipPath && /inset\(\s*(50|100)%/.test(cs.clipPath)) return false;
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const lum = (c) => { const m = c.match(/[\d.]+/g); if (!m) return null; const [r, g, b, a] = m.map(Number); if (a === 0) return null; const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = (el) => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const l = lum(getComputedStyle(e).backgroundColor); if (l !== null) return l; } return 1; };
  const contrast = (el) => { const fg = lum(getComputedStyle(el).color); if (fg === null) return null; const bg = bgOf(el); const [a, b] = fg > bg ? [fg, bg] : [bg, fg]; return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100; };
  const labelFor = (el) => {
    const al = el.getAttribute('aria-label'); if (al) return al.trim();
    const lb = el.getAttribute('aria-labelledby'); if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ').trim(); if (t) return t; }
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return l.innerText.trim(); }
    const pl = el.closest('label'); if (pl && pl !== el) return pl.innerText.trim();
    return '';
  };
  const roleOf = (el) => {
    const r = el.getAttribute('role'); if (r) return r;
    const t = el.tagName.toLowerCase();
    if (t === 'a' && el.hasAttribute('href')) return 'link';
    if (t === 'button' || (t === 'input' && ['button', 'submit', 'reset'].includes(el.type))) return 'button';
    if (t === 'input') return ({ checkbox: 'checkbox', radio: 'radio', range: 'slider', file: 'file', search: 'searchbox' })[el.type] || 'textbox';
    if (t === 'textarea') return 'textbox';
    if (t === 'select') return 'combobox';
    if (/^h[1-6]$/.test(t)) return 'heading';
    if (t === 'img') return 'img';
    if (t === 'canvas') return 'canvas';
    if (t === 'video' || t === 'audio') return t;
    if (el.isContentEditable) return 'textbox';
    return t;
  };
  const isInteractive = (el) => {
    const t = el.tagName.toLowerCase();
    if (['a', 'button', 'input', 'textarea', 'select', 'summary', 'canvas', 'video'].includes(t)) return true;
    if (el.isContentEditable && el.getAttribute('contenteditable') !== 'false') return true;
    const r = el.getAttribute('role'); if (r && /button|link|tab|menuitem|checkbox|radio|switch|option|textbox|combobox|slider/.test(r)) return true;
    if (el.hasAttribute('onclick') || (el.tabIndex >= 0 && el.hasAttribute('tabindex'))) return true;
    const cs = getComputedStyle(el); if (cs.cursor === 'pointer' && el.children.length <= 3 && (el.innerText || '').trim().length < 60) { const p = el.parentElement; if (!p || getComputedStyle(p).cursor !== 'pointer') return true; }
    return false;
  };
  const seen = new Set();
  const push = (el, kind) => {
    if (seen.has(el)) return; seen.add(el);
    const r = el.getBoundingClientRect(); if (!visible(el, r)) return;
    const inVp = r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    let occluded = false;
    if (inVp && kind === 'interactive') {
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      occluded = !!top && top !== el && !el.contains(top) && !top.contains(el);
    }
    const t = el.tagName.toLowerCase();
    const txt = (el.innerText || el.value || '').replace(/\s+/g, ' ').trim();
    let name = labelFor(el) || (t === 'img' ? el.alt || '' : '') || el.getAttribute('title') || '';
    if (!name) name = txt.slice(0, 120);
    if (!name && el.placeholder) name = el.placeholder;
    const cs = getComputedStyle(el);
    // 屏幕上实际渲染出来的字：不含 aria-label / alt / title 这些肉眼看不到的属性
    let vis = '';
    if (t === 'input' || t === 'textarea') vis = el.type === 'password' ? '' : (el.value || el.placeholder || (['button', 'submit', 'reset'].includes(el.type) ? el.value : '') || '');
    else if (t === 'select') vis = (el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : '') || '';
    else if (t !== 'img') vis = txt;
    vis = String(vis).replace(/\s+/g, ' ').trim().slice(0, 120);
    out.push({ ref: 'e' + (++n), role: roleOf(el), name, vis_text: vis || undefined, tag: t, bbox: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], in_viewport: inVp, occluded,
      selector: 'xpath=' + xpath(el), value: ('value' in el && t !== 'button') ? String(el.value).slice(0, 200) : undefined, placeholder: el.placeholder || undefined,
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', checked: el.checked === true ? true : undefined, href: el.getAttribute && el.getAttribute('href') || undefined,
      text_len: txt.length, font_px: parseFloat(cs.fontSize) || undefined, contrast: kind !== 'image' ? contrast(el) : undefined, kind,
      aria_label: el.getAttribute('aria-label') || undefined });
  };
  const all = document.querySelectorAll('body *');
  for (const el of all) { if (out.length > 400) break; if (isInteractive(el)) push(el, 'interactive'); }
  for (const el of document.querySelectorAll('h1,h2,h3,h4,[role=heading]')) push(el, 'heading');
  for (const el of document.querySelectorAll('p,li,td,label,span,div,[role=alert],[role=status],article,blockquote,pre')) {
    if (out.length > 600) break;
    if (seen.has(el)) continue;
    const direct = Array.from(el.childNodes).filter((c) => c.nodeType === 3).map((c) => c.textContent).join('').trim();
    if (direct.length < 2) continue;
    push(el, 'text');
  }
  for (const el of document.querySelectorAll('img,svg[role=img],video,canvas')) push(el, el.tagName === 'VIDEO' ? 'media' : 'image');
  const captcha = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="turnstile"],.g-recaptcha,.h-captcha,[data-captcha]') || /人机验证|滑动验证|请完成验证|captcha/i.test((document.body && document.body.innerText || '').slice(0, 5000));
  const text = (document.body ? document.body.innerText : '').replace(/\s+\n/g, '\n').slice(0, 4000);
  const notif = (window.__pux && window.__pux.notifications) || [];
  return { elements: out, captcha, text, scroll: { y: Math.round(scrollY), max_y: Math.max(0, document.documentElement.scrollHeight - vh) },
    mutations: window.__pux ? window.__pux.mutations : 0, lastMutationAt: window.__pux ? window.__pux.lastMutationAt : 0, notifications: notif.map((x) => x.title + (x.body ? '：' + x.body : '')),
    hidden: !!(window.__pux && window.__pux.hidden), dialogsInDom: document.querySelectorAll('[role=dialog]:not([hidden]),[role=alertdialog],dialog[open],.modal.show,.modal[open]').length };
})()
`;

export const PROBE_SCRIPT = String.raw`
(() => ({ url: location.href, mutations: window.__pux ? window.__pux.mutations : 0, lastMutationAt: window.__pux ? window.__pux.lastMutationAt : 0,
  scrollY: Math.round(scrollY), dialogsInDom: document.querySelectorAll('[role=dialog]:not([hidden]),[role=alertdialog],dialog[open],.modal.show,.modal[open]').length,
  textLen: document.body ? document.body.innerText.length : 0 }))()
`;
