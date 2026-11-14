// 发布：粘贴网址、名字、一句话。发布之后的事交给城里的人。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ApiError, get, post, queryClient } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import type { Launch } from '../lib/types.ts';
import { Button } from './ui.tsx';

let open = false;
const subs = new Set<() => void>();
const setOpen = (v: boolean) => { open = v; for (const f of subs) f(); };
export const openPublish = () => setOpen(true);

/** 没写协议的地址（localhost:3000）按 http 处理 */
export const normalizeUrl = (raw: string) => { const s = raw.trim(); return !s || /^https?:\/\//i.test(s) ? s : `http://${s}`; };

export function PublishDialog() {
  const isOpen = useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => open);
  const ref = useRef<HTMLDialogElement>(null);
  const { t, lang } = useT(); const nav = useNavigate();
  // 随包的示例产品（带着真实的小毛病）：没有自己的产品时先拿它们试
  const demos = useQuery({ queryKey: ['demos'], queryFn: () => get<{ id: string; name: string; name_en: string; tagline: string; flawed_url: string }[]>('/demos'), enabled: isOpen, staleTime: 60_000, retry: false });
  const [url, setUrl] = useState(''); const [name, setName] = useState(''); const [tagline, setTagline] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const d = ref.current; if (!d) return; if (isOpen && !d.open) d.showModal(); else if (!isOpen && d.open) d.close(); }, [isOpen]);
  const ready = url.trim() && name.trim() && tagline.trim();

  return (
    <dialog ref={ref} onClose={() => setOpen(false)} onClick={(e) => { if (e.target === ref.current && !busy) setOpen(false); }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border border-border-strong bg-bg-elevated p-0 text-fg backdrop:bg-overlay">
      <form className="p-6" onSubmit={async (e) => {
        e.preventDefault(); if (!ready || busy) return;
        setBusy(true); setErr(null);
        try {
          const l = await post<Launch>('/launches', { url: normalizeUrl(url), name: name.trim(), tagline: tagline.trim() });
          await queryClient.invalidateQueries({ queryKey: ['launches'] });
          setOpen(false); setUrl(''); setName(''); setTagline('');
          void nav({ to: '/products/$id', params: { id: l.id } });
        } catch (x) { setErr(x instanceof ApiError && x.status !== 500 ? x.code : t('error')); } finally { setBusy(false); }
      }}>
        <h2 className="text-lg font-semibold">{t('publish_title')}</h2>
        <label className="mt-5 block text-xs text-fg-muted" htmlFor="pub-url">{t('f_url')}</label>
        <input id="pub-url" className="field mt-1.5" inputMode="url" autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:3000/" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <label className="mt-4 block text-xs text-fg-muted" htmlFor="pub-name">{t('f_name')}</label>
        <input id="pub-name" className="field mt-1.5" maxLength={40} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="mt-4 block text-xs text-fg-muted" htmlFor="pub-tagline">{t('f_tagline')}</label>
        <input id="pub-tagline" className="field mt-1.5" maxLength={80} autoComplete="off" value={tagline} onChange={(e) => setTagline(e.target.value)} required />
        {err && <p role="alert" className="mt-3 break-words text-xs text-danger">{err}</p>}
        <div className="mt-6 flex items-center justify-end gap-2">
          {(demos.data?.length ?? 0) > 0 && (
            <select aria-label={t('examples')} value="" disabled={busy} onChange={(e) => { const d = demos.data!.find((x) => x.id === e.target.value); if (d) { setUrl(d.flawed_url); setName(lang === 'zh' ? d.name : d.name_en); setTagline(d.tagline); } }}
              className="mr-auto h-9 max-w-[9rem] rounded-md border border-border bg-transparent px-2 text-sm text-fg-muted hover:border-border-strong hover:text-fg">
              <option value="">{t('examples')}</option>
              {demos.data!.map((d) => <option key={d.id} value={d.id}>{lang === 'zh' ? d.name : d.name_en}</option>)}
            </select>
          )}
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!ready || busy}>{busy ? t('publishing') : t('publish')}</Button>
        </div>
      </form>
    </dialog>
  );
}
