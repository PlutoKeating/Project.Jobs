// 收件箱：一个人（或一次使用、或设置页的无主信）收到的邮件与短信。点开一封看全文；HTML 邮件放在不执行脚本的沙箱里。
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Eye, FileDown, Mail, MessageSquare } from 'lucide-react';
import { evidenceUrl, get } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';

export interface MailBrief { id: string; kind: 'email' | 'sms'; address: string; sender: string | null; subject: string | null; body: string; has_html: boolean; opened_at: string | null; session_id: string | null; real: boolean; at: string }
interface MailFull extends MailBrief { html: string | null; raw_ev: string | null; links: string[] }

const who = (s: string | null) => (s ?? '').replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || s || '—';

function Body({ id }: { id: string }) {
  const q = useQuery({ queryKey: ['mail', id], queryFn: () => get<MailFull>(`/mail/${id}`), staleTime: Infinity });
  const { t } = useT();
  if (!q.data) return <div className="mt-2 h-24 animate-pulse rounded-md bg-surface-hover" />;
  const m = q.data;
  return (
    <div className="mt-3">
      {m.html
        ? <iframe title={m.subject ?? 'mail'} sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={`<base target="_blank"><style>body{margin:12px;font:14px/1.5 system-ui,sans-serif;background:#fff;color:#111;word-break:break-word}img{max-width:100%;height:auto}</style>${m.html}`} className="h-[420px] w-full rounded-md border border-border bg-white" />
        : <pre className="whitespace-pre-wrap break-words rounded-md bg-surface px-3 py-2 font-sans text-sm leading-relaxed text-fg">{m.body}</pre>}
      {m.raw_ev && <a href={evidenceUrl(m.raw_ev)} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"><FileDown size={12} />{t('mail_raw')}</a>}
    </div>
  );
}

export function MailList({ items, showAddress = false }: { items: MailBrief[]; showAddress?: boolean }) {
  const { t, lang } = useT(); const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return <p className="text-sm text-fg-subtle">{t('inbox_empty')}</p>;
  const fmt = (s: string) => new Date(s).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  return (
    <ul className="divide-y divide-border">
      {items.map((m) => (
        <li key={m.id} className="py-3">
          <button type="button" onClick={() => setOpen(open === m.id ? null : m.id)} aria-expanded={open === m.id} className="flex w-full items-start gap-2.5 text-left">
            {m.kind === 'sms' ? <MessageSquare size={15} className="mt-0.5 shrink-0 text-fg-subtle" aria-label={t('mail_sms')} /> : <Mail size={15} className="mt-0.5 shrink-0 text-fg-subtle" />}
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="truncate text-sm font-medium text-fg-display">{who(m.sender)}</span>
                <span className="tabular ml-auto shrink-0 text-xs text-fg-subtle">{fmt(m.at)}</span>
              </span>
              {m.subject && <span className="block truncate text-sm text-fg">{m.subject}</span>}
              {open !== m.id && <span className="block truncate text-xs text-fg-subtle">{showAddress ? `${m.address} · ` : ''}{m.body.replace(/\s+/g, ' ').slice(0, 140)}</span>}
            </span>
            {m.kind === 'email' && <span title={m.opened_at ? t('mail_opened') : t('mail_unopened')} className="mt-1 shrink-0"><Eye size={13} className={m.opened_at ? 'text-success' : 'text-fg-subtle opacity-40'} aria-label={m.opened_at ? t('mail_opened') : t('mail_unopened')} /></span>}
          </button>
          {open === m.id && <Body id={m.id} />}
        </li>
      ))}
    </ul>
  );
}
