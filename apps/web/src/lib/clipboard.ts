// 复制到剪贴板。navigator.clipboard 只在安全上下文（HTTPS 或 localhost）里有；
// 用局域网 IP 走 http 打开时退回到隐藏文本框 + execCommand('copy')。返回是否真的复制成功。
export async function copyText(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* 退回下面的办法 */ }
  }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove(); active?.focus();
  return ok;
}
