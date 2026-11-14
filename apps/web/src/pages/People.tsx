import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Plus, Search, Sparkles } from 'lucide-react';
import { post, useMe, usePersonas, useTown, queryClient } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import { useSnapshot } from '../lib/stream.ts';
import { Avatar, Button, ErrorState, PageHead, Seg, Skeleton } from '../components/ui.tsx';

function Generate() {
  const { t } = useT();
  const [open, setOpen] = useState(false); const [n, setN] = useState(4); const [locale, setLocale] = useState<'zh-CN' | 'en-US'>('zh-CN'); const [busy, setBusy] = useState(false); const [err, setErr] = useState(false);
  if (!open) return <Button onClick={() => setOpen(true)}><Plus size={15} />{t('generate')}</Button>;
  return (
    <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(false); try { await post('/personas/generate', { n, locale }); await queryClient.invalidateQueries({ queryKey: ['personas'] }); setOpen(false); } catch { setErr(true); } finally { setBusy(false); } }}>
      <Seg size="sm" value={locale} onChange={setLocale} options={[{ value: 'zh-CN', label: '中' }, { value: 'en-US', label: 'EN' }]} />
      <input type="number" min={1} max={12} value={n} onChange={(e) => setN(Number(e.target.value))} className="field h-9 w-16 tabular" aria-label="n" />
      <Button variant="primary" disabled={busy}><Sparkles size={14} className={busy ? 'live-dot' : ''} />{t('generate')}</Button>
      {err && <span className="text-xs text-danger">{t('error')}</span>}
    </form>
  );
}

export function PeoplePage() {
  const { t, lang } = useT(); const L = useLabel();
  const q = usePersonas(); const me = useMe().data; const snap = useSnapshot(); const town = useTown().data;
  const [seg, setSeg] = useState('all'); const [text, setText] = useState('');
  const segments = useMemo(() => [...new Set((q.data ?? []).map((p) => p.segment))], [q.data]);
  const list = useMemo(() => (q.data ?? [])
    .filter((p) => seg === 'all' || p.segment === seg)
    .filter((p) => !text || `${p.name}${p.occupation}${p.region}`.toLowerCase().includes(text.toLowerCase()))
    .sort((a, b) => b.sessions - a.sessions), [q.data, seg, text]);
  const live = new Map((snap?.personas ?? []).map((p) => [p.id, p]));
  const place = (id?: string) => { const p = town?.places.find((x) => x.id === id); return p ? (lang === 'zh' ? p.name.zh : p.name.en) : ''; };

  return (
    <>
      <PageHead title={t('nav.people')} aside={<>
        <label className="relative"><Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" /><input className="field h-9 w-48 pl-8" placeholder={t('search')} value={text} onChange={(e) => setText(e.target.value)} /></label>
        {me?.admin && <Generate />}
      </>}>
        <p className="tabular mt-1 text-sm text-fg-muted">{q.data ? t('n_people', { n: q.data.length }) : ''}</p>
      </PageHead>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {['all', ...segments].map((s) => (
          <button key={s} onClick={() => setSeg(s)} className={`rounded-full border px-3 py-1 text-xs transition-colors ${seg === s ? 'border-accent bg-accent-soft text-fg-display' : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'}`}>
            {s === 'all' ? t('all') : L(s)}<span className="tabular ml-1.5 text-fg-subtle">{s === 'all' ? q.data?.length : q.data?.filter((p) => p.segment === s).length}</span>
          </button>
        ))}
      </div>
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-x-5 gap-y-8">
          {q.isLoading && Array.from({ length: 10 }, (_, i) => <li key={i}><Skeleton className="aspect-square w-full" /><Skeleton className="mt-3 h-4 w-2/3" /></li>)}
          {list.map((p) => {
            const l = live.get(p.id);
            return (
              <li key={p.id}>
                <Link to="/people/$id" params={{ id: p.id }} className="group block">
                  <div className="relative overflow-hidden rounded-lg bg-surface transition-transform duration-200 group-hover:-translate-y-1">
                    <Avatar id={p.id} size={400} className="!h-auto !w-full aspect-square !rounded-none" />
                    {l?.session && <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded bg-bg/85 px-1.5 py-0.5 text-[11px] font-medium text-accent backdrop-blur"><span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />{l.session.app}</span>}
                    {p.target_user && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-secondary-fg ring-2 ring-bg/60" title={t('target_user')} />}
                  </div>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="truncate font-medium text-fg-display group-hover:text-accent">{p.name}</span>
                    <span className="tabular shrink-0 text-xs text-fg-subtle">{p.age}</span>
                  </div>
                  <p className="truncate text-xs text-fg-muted">{p.occupation}</p>
                  <p className="mt-1 truncate text-xs text-fg-subtle">{l ? `${place(l.place_id) || L(l.place_kind)} · ${l.activity}` : L(p.segment)}</p>
                  <p className="tabular mt-1 text-[11px] text-fg-subtle">{p.sessions ? `${t('n_sessions', { n: p.sessions })} · ${p.apps.length} ${t('nav.apps')}` : '—'}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
