// 模型接入：从目录选供应商 → 粘贴凭证 → 勾选模型 → 排好全局顺序 → 一次保存。
// 所有改动先落在本页的草稿里（凭证明文只在内存，保存或放弃后清掉）；保存时带上编辑起点的版本，线上已经变了就保留草稿并提示。
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp, Crosshair, Eye, GripVertical, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { ApiError, get, post } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import type { MCatalogLite, MCatalogModel, MCatalogProvider, MConfig, MGcloud, MModel, MPreview, MProvider, MState, MTest, MUse, MVersion } from '../lib/types.ts';
import { Button, ErrorState, Seg, Skeleton } from '../components/ui.tsx';

// crypto.randomUUID 只在安全上下文（HTTPS 或 localhost）里有；用局域网 IP 走 http 打开时没有，getRandomValues 则处处可用。
const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const rid = (p: string) => `${p}_${hex(6)}`;
const newSubmitId = () => hex(16);
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const CHAT_USES: MUse[] = ['step', 'think', 'locate', 'chat'];
const ALL_USES: MUse[] = ['step', 'think', 'locate', 'chat', 'embed', 'image'];
const fmtCtx = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}K`);
const defaultUses = (m: MCatalogModel): MUse[] => (m.kind === 'embed' ? ['embed'] : m.kind === 'image' ? ['image'] : [...(m.caps.vision ? (['step'] as MUse[]) : []), 'think', ...(m.locate ? (['locate'] as MUse[]) : []), 'chat']);

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-fg-display' : 'bg-border-strong'}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

function UseChips({ m, onChange, canLocate }: { m: MModel; onChange?: (uses: MUse[]) => void; canLocate: boolean }) {
  const { t } = useT();
  if (m.kind !== 'chat') return <span className="chip">{t(`m_use_${m.kind === 'embed' ? 'embed' : 'image'}`)}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {CHAT_USES.map((u) => {
        const on = m.uses.includes(u); const can = u === 'think' || u === 'chat' || (m.caps.vision && (u === 'step' || canLocate));
        if (!onChange) return on ? <span key={u} className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-muted">{t(`m_use_${u}`)}</span> : null;
        return <button key={u} type="button" aria-pressed={on} disabled={!can} onClick={() => onChange(on ? m.uses.filter((x) => x !== u) : [...m.uses, u])}
          className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${on ? 'border-fg-display bg-fg-display text-bg' : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'}`}>{t(`m_use_${u}`)}</button>;
      })}
    </span>
  );
}

function TestChips({ tests, version }: { tests: MTest[]; version: number }) {
  const L = useLabel(); const { t } = useT();
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      {tests.map((x) => {
        const stale = x.version !== version;
        return (
          <span key={x.capability} title={`${t('m_version', { n: x.version })} · ${x.cred ?? ''} · ${new Date(x.at).toLocaleTimeString()}${x.detail ? ` · ${x.detail}` : ''}`} className={`inline-flex items-center gap-1 ${stale ? 'text-fg-subtle' : x.ok ? 'text-success' : 'text-danger'}`}>
            {x.ok ? <Check size={12} /> : <X size={12} />}{L(`cap_${x.capability}`)}
            {!x.ok && x.error_class && <span>· {L(x.error_class)}</span>}
            {x.ok && !stale && <span className="tabular text-fg-subtle">{(x.latency_ms / 1000).toFixed(1)}s</span>}
            {stale && <span>· {t('m_stale_test')}</span>}
          </span>
        );
      })}
    </span>
  );
}

function ProviderCard({ p, lite, open, onToggle, update, remove, secrets, setSecret, dropSecret, saved, dirty, tests, version }: {
  p: MProvider; lite?: MCatalogLite; open: boolean; onToggle: () => void; update: (fn: (p: MProvider) => void) => void; remove: () => void;
  secrets: Record<string, string>; setSecret: (id: string, v: string) => void; dropSecret: (id: string) => void; saved: boolean; dirty: boolean; tests: MTest[]; version: number;
}) {
  const { t } = useT(); const qc = useQueryClient();
  const cat = useQuery({ queryKey: ['m-catalog', p.catalog_id], queryFn: () => get<MCatalogProvider>(`/models/catalog/${p.catalog_id}`), enabled: open && !!p.catalog_id, staleTime: Infinity, retry: false });
  const [key, setKey] = useState(''); const [q, setQ] = useState(''); const [only, setOnly] = useState(false); const [custom, setCustom] = useState(''); const [customVision, setCustomVision] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [gc, setGc] = useState<{ busy?: boolean; msg?: string } | null>(null);
  const json = lite?.credential === 'google_json' || p.protocol === 'vertex';
  const hasSavedCred = p.credentials.some((c) => !(c.id in secrets));
  const selected = new Map(p.models.map((m) => [m.model, m]));
  const catModels = cat.data?.models ?? [];
  const known = new Set(catModels.map((m) => m.id));
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    const all: (MCatalogModel & { extra?: boolean })[] = [...p.models.filter((m) => !known.has(m.model)).map((m) => ({ id: m.model, name: m.name ?? m.model, kind: m.kind, caps: m.caps, cost: m.cost ?? null, locate: true, extra: true })), ...catModels];
    return all.filter((m) => (!only || selected.has(m.id)) && (!k || m.id.toLowerCase().includes(k) || m.name.toLowerCase().includes(k)));
  }, [catModels, p.models, q, only]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = rows.slice(0, 60);
  const toggle = (m: MCatalogModel) => update((x) => { const i = x.models.findIndex((y) => y.model === m.id); if (i >= 0) x.models.splice(i, 1); else x.models.push({ id: rid('tgt'), model: m.id, name: m.name, kind: m.kind, uses: defaultUses(m), caps: m.caps, cost: m.cost }); });
  const addKey = () => { const v = key.trim(); if (!v) return; const id = rid('cred'); setSecret(id, v); update((x) => { x.credentials.push({ id, label: '', enabled: true, hint: t('m_new'), secret_id: 'pending' }); }); setKey(''); };
  // 装好的 Jobs 跑在容器里：gcloud 配置目录还没挂进来时，请宿主机补上（重建容器），等服务回来再读一次；之后只剩「在这台机器上 gcloud auth login」
  const addGcloud = async (connected = false) => {
    setGc({ busy: true });
    try {
      const g = await get<MGcloud>('/models/gcloud');
      if (!g.mounted && g.can_connect && !connected) {
        setGc({ busy: true, msg: t('m_gcloud_connecting') });
        await post('/models/gcloud/connect', {});
        const until = Date.now() + 180_000;
        while (Date.now() < until) {
          await new Promise((r) => setTimeout(r, 3000));
          const n = await get<MGcloud>('/models/gcloud').catch(() => null);   // 重启期间请求会失败
          if (n?.mounted) return void (await addGcloud(true));
        }
        setGc({ msg: t('m_gcloud_slow') }); return;
      }
      if (!g.mounted) { setGc({ msg: t('m_gcloud_run_up') }); return; }
      if (!g.found || !g.project) { setGc({ msg: t('m_gcloud_none', { error: g.error ?? '' }) }); return; }
      const id = rid('cred'); setSecret(id, JSON.stringify({ gcloud: 'auto' }));
      update((x) => { x.credentials.push({ id, label: `gcloud · ${g.account}`, enabled: true, hint: 'gcloud', secret_id: 'pending' }); });
      setGc({ msg: t('m_gcloud_added', { account: g.account ?? '', project: g.project }) });
    } catch (e) { setGc({ msg: t('m_gcloud_none', { error: e instanceof ApiError ? e.code : String(e) }) }); }
  };
  const runTest = async (m: MModel) => {
    setBusy(m.id);
    const caps = m.kind === 'embed' ? ['embed'] : m.kind === 'image' ? ['image'] : ['text', ...(m.caps.vision ? ['vision'] : []), 'json', 'tools'];
    try { for (const capability of caps) { await post('/models/test', { target_id: m.id, capability }).catch(() => undefined); await new Promise((r) => setTimeout(r, 350)); } }
    finally { setBusy(null); void qc.invalidateQueries({ queryKey: ['models'] }); }
  };

  return (
    <li className="border-t border-border">
      <div className="flex items-center gap-3 py-3.5">
        <button type="button" aria-expanded={open} onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronDown size={16} className={`shrink-0 text-fg-subtle transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
          <span className={`truncate text-base font-semibold ${p.enabled ? 'text-fg-display' : 'text-fg-subtle'}`}>{p.name}</span>
          <span className="tabular shrink-0 text-xs text-fg-muted">{t('m_n_creds', { n: p.credentials.filter((c) => c.enabled).length })} · {t('m_n_models', { n: p.models.length })}</span>
        </button>
        <Switch on={p.enabled} label={p.name} onChange={(v) => update((x) => { x.enabled = v; })} />
      </div>
      {open && (
        <div className="animate-reveal space-y-7 pb-7 pl-7">
          <section>
            <h3 className="mb-2 text-xs font-semibold text-fg-muted">{t('m_conn')}</h3>
            <div className="grid gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]">
              <input aria-label={t('m_name')} className="field h-9" value={p.name} onChange={(e) => update((x) => { x.name = e.target.value; })} />
              <input aria-label={t('m_base')} className="field h-9 font-mono text-xs" value={p.base_url} readOnly={hasSavedCred} spellCheck={false} onChange={(e) => update((x) => { x.base_url = e.target.value; })} />
              {!p.catalog_id && <Seg size="sm" value={p.protocol} onChange={(v) => update((x) => { x.protocol = v; })} options={[{ value: 'openai', label: 'OpenAI' }, { value: 'anthropic', label: 'Anthropic' }]} />}
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold text-fg-muted">{t('m_creds')}</h3>
            <ul className="mb-2 space-y-1.5">
              {p.credentials.map((c) => (
                <li key={c.id} className="flex items-center gap-3 text-sm">
                  <Switch on={c.enabled} label={c.hint} onChange={(v) => update((x) => { x.credentials.find((y) => y.id === c.id)!.enabled = v; })} />
                  <span className={`tabular min-w-0 flex-1 truncate font-mono text-xs ${c.enabled ? 'text-fg' : 'text-fg-subtle'}`}>{c.id in secrets ? `${t('m_new')} ${c.label || `…${secrets[c.id].trim().slice(-4)}`}` : c.label ? `${c.label} · ${c.hint}` : c.hint}</span>
                  <button type="button" aria-label="remove" onClick={() => { dropSecret(c.id); update((x) => { x.credentials = x.credentials.filter((y) => y.id !== c.id); }); }} className="rounded-xs p-1 text-fg-subtle hover:bg-surface-hover hover:text-danger"><Trash2 size={14} /></button>
                </li>
              ))}
            </ul>
            <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); addKey(); }}>
              {json ? <textarea aria-label={t('m_paste_json')} placeholder={t('m_paste_json')} rows={2} spellCheck={false} className="field font-mono text-xs" value={key} onChange={(e) => setKey(e.target.value)} />
                : <input aria-label={t('m_paste_key')} placeholder={t('m_paste_key')} type="password" autoComplete="off" className="field h-9" value={key} onChange={(e) => setKey(e.target.value)} />}
              <Button type="submit" disabled={!key.trim()}>{t('m_add_cred')}</Button>
            </form>
            {p.protocol === 'vertex' && (
              <div className="mt-2 space-y-2">
                <Button type="button" variant="ghost" size="sm" disabled={gc?.busy} onClick={() => void addGcloud()}>{t('m_gcloud_use')}</Button>
                {gc?.msg && <p role="status" className="text-xs text-fg-muted">{gc.msg}</p>}
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-fg-muted">{t('m_models')}</h3>
              <div className="flex items-center gap-2">
                <input aria-label={t('m_search_model')} placeholder={t('m_search_model')} className="field h-7 w-44 px-2 py-0 text-xs" value={q} onChange={(e) => setQ(e.target.value)} />
                <button type="button" aria-pressed={only} onClick={() => setOnly(!only)} className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${only ? 'border-fg-display bg-fg-display text-bg' : 'border-border text-fg-muted hover:text-fg'}`}>{t('m_only_selected')}</button>
              </div>
            </div>
            {cat.isLoading ? <Skeleton className="h-24 w-full" /> : (
              <ul className="max-h-[22rem] overflow-y-auto rounded-lg border border-border">
                {shown.map((m) => {
                  const sel = selected.get(m.id);
                  const mt = sel ? tests.filter((x) => x.target_id === sel.id) : [];
                  return (
                    <li key={m.id} className="border-b border-border px-3 py-2 last:border-b-0">
                      <label className="flex cursor-pointer items-center gap-3">
                        <input type="checkbox" checked={!!sel} onChange={() => toggle(m)} className="h-4 w-4 shrink-0 accent-[var(--color-fg-display)]" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-sm text-fg-display">{m.name}</span><span className="block truncate font-mono text-xs text-fg-subtle">{m.id}</span></span>
                        <span className="tabular flex shrink-0 items-center gap-2 text-xs text-fg-subtle">
                          {m.caps.vision && <Eye size={13} aria-label={t('m_vision')} />}
                          {m.locate && m.caps.vision && !m.extra && <Crosshair size={13} aria-label={t('m_use_locate')} />}
                          {m.caps.context ? <span>{fmtCtx(m.caps.context)}</span> : null}
                          <span className="hidden w-24 text-right sm:inline">{m.cost ? `$${m.cost.input} / $${m.cost.output}` : t('m_unknown_cost')}</span>
                        </span>
                      </label>
                      {sel && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
                          <UseChips m={sel} canLocate={m.locate} onChange={(uses) => update((x) => { x.models.find((y) => y.id === sel.id)!.uses = uses; })} />
                          {saved && <Button size="sm" variant="ghost" disabled={dirty || busy !== null} onClick={() => void runTest(sel)}>{busy === sel.id ? '…' : t('m_test')}</Button>}
                          {mt.length > 0 && <TestChips tests={mt} version={version} />}
                        </div>
                      )}
                    </li>
                  );
                })}
                {rows.length > shown.length && <li className="px-3 py-2 text-xs text-fg-subtle">{t('m_more', { n: rows.length - shown.length })}</li>}
                {!rows.length && <li className="px-3 py-3 text-xs text-fg-subtle">—</li>}
              </ul>
            )}
            <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); const id = custom.trim(); if (!id || selected.has(id)) return; update((x) => { x.models.push({ id: rid('tgt'), model: id, name: id, kind: /embed/i.test(id) ? 'embed' : 'chat', uses: /embed/i.test(id) ? ['embed'] : customVision ? ['step', 'think', 'locate', 'chat'] : ['think', 'chat'], caps: { vision: customVision && !/embed/i.test(id), json: true }, cost: null, custom: true }); }); setCustom(''); }}>
              <input aria-label={t('m_custom_model')} placeholder={t('m_custom_model')} className="field h-8 w-56 font-mono text-xs" spellCheck={false} value={custom} onChange={(e) => setCustom(e.target.value)} />
              <label className="flex items-center gap-1.5 text-xs text-fg-muted"><input type="checkbox" checked={customVision} onChange={(e) => setCustomVision(e.target.checked)} className="accent-[var(--color-fg-display)]" />{t('m_vision')}</label>
              <Button size="sm" type="submit" disabled={!custom.trim()}><Plus size={13} /></Button>
            </form>
          </section>

          <Button size="sm" variant="ghost" className="!text-danger" onClick={remove}><Trash2 size={13} />{t('m_remove')}</Button>
        </div>
      )}
    </li>
  );
}

/** 全局顺序：跨供应商的一套顺序。可以拖，也可以点按钮或用键盘（空格拿起、方向键移动、空格放下、Esc 取消） */
function OrderList({ cfg, setOrder, reasons }: { cfg: MConfig; setOrder: (o: string[]) => void; reasons: Map<string, string> }) {
  const { t } = useT(); const L = useLabel();
  const byId = new Map(cfg.providers.flatMap((p) => p.models.map((m) => [m.id, { p, m }] as const)));
  const order = cfg.order.filter((id) => byId.has(id));
  const [drag, setDrag] = useState<number | null>(null); const [over, setOver] = useState<number | null>(null);
  const [picked, setPicked] = useState<{ id: string; from: string[] } | null>(null); const [say, setSay] = useState('');
  const move = (from: number, to: number) => { if (to < 0 || to >= order.length || from === to) return; const o = [...order]; const [x] = o.splice(from, 1); o.splice(to, 0, x); setOrder(o); const e = byId.get(x)!; setSay(t('m_moved', { name: e.m.name ?? e.m.model, n: to + 1 })); };
  if (!order.length) return <p className="py-6 text-sm text-fg-subtle">—</p>;
  return (
    <>
      <ol className="border-b border-border">
        {order.map((id, i) => {
          const { p, m } = byId.get(id)!; const off = !p.enabled ? 'provider_off' : !p.credentials.some((c) => c.enabled) ? 'no_credential' : reasons.get(id);
          return (
            <li key={id} draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; }} onDragOver={(e) => { e.preventDefault(); setOver(i); }} onDragEnd={() => { setDrag(null); setOver(null); }}
              onDrop={(e) => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); setOver(null); }}
              className={`grid grid-cols-[1.5rem_1.25rem_minmax(0,1fr)_auto] items-center gap-2 border-t py-2.5 ${over === i && drag !== null && drag !== i ? 'border-t-2 border-accent' : 'border-border'} ${drag === i ? 'opacity-40' : ''} ${picked?.id === id ? 'bg-surface-hover' : ''}`}>
              <span className="tabular text-right text-xs text-fg-subtle">{i + 1}</span>
              <button type="button" aria-label={`${t('m_drag')}：${m.name ?? m.model}`} aria-pressed={picked?.id === id} className="cursor-grab rounded-xs text-fg-subtle hover:text-fg active:cursor-grabbing"
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setPicked(picked?.id === id ? null : { id, from: order }); }
                  else if (picked?.id === id && e.key === 'ArrowUp') { e.preventDefault(); move(i, i - 1); }
                  else if (picked?.id === id && e.key === 'ArrowDown') { e.preventDefault(); move(i, i + 1); }
                  else if (picked?.id === id && e.key === 'Escape') { e.preventDefault(); setOrder(picked.from); setPicked(null); }
                }} onBlur={() => setPicked(null)}><GripVertical size={15} /></button>
              <span className="min-w-0">
                <span className={`block truncate text-sm ${off ? 'text-fg-subtle' : 'text-fg-display'}`}><span className="text-fg-muted">{p.name} / </span>{m.name ?? m.model}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5"><UseChips m={m} canLocate />{off && <span className="text-xs text-warning">{L(off)}</span>}</span>
              </span>
              <span className="flex shrink-0 text-fg-subtle">
                {([['m_top', ChevronsUp, 0], ['m_up', ChevronUp, i - 1], ['m_down', ChevronDown, i + 1], ['m_bottom', ChevronsDown, order.length - 1]] as const).map(([k, Icon, to]) => (
                  <button key={k} type="button" aria-label={t(k)} title={t(k)} disabled={to === i || to < 0 || to >= order.length} onClick={() => move(i, to)} className="rounded-xs p-1 hover:bg-surface-hover hover:text-fg"><Icon size={14} /></button>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
      <span aria-live="polite" className="sr-only">{say}</span>
    </>
  );
}

function AddProvider({ list, onPick, fetchedAt, onRefresh }: { list: MCatalogLite[]; onPick: (c: MCatalogLite | null) => void; fetchedAt: string; onRefresh: () => Promise<void> }) {
  const { t } = useT();
  const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f); }, []);
  const k = q.trim().toLowerCase();
  const hits = list.filter((p) => !k || p.name.toLowerCase().includes(k) || p.id.includes(k)).slice(0, k ? 30 : 16);
  return (
    <div ref={box} className="relative">
      <div className="flex items-center gap-2">
        <input role="combobox" aria-expanded={open} aria-controls="m-providers" aria-label={t('m_add')} placeholder={t('m_add')} className="field h-10" value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && hits[0]) { onPick(hits[0]); setQ(''); setOpen(false); } }} />
        <Button variant="ghost" aria-label={t('m_refresh')} title={`${t('m_refresh')} · ${t('m_from_catalog', { d: new Date(fetchedAt).toLocaleDateString() })}`} disabled={busy} onClick={async () => { setBusy(true); try { await onRefresh(); } finally { setBusy(false); } }}><RefreshCw size={15} className={busy ? 'animate-spin' : ''} /></Button>
      </div>
      {open && (
        <ul id="m-providers" role="listbox" className="absolute inset-x-0 top-11 z-20 max-h-80 overflow-y-auto rounded-lg border border-border-strong bg-bg-elevated py-1">
          {hits.map((p) => (
            <li key={p.id}><button type="button" role="option" aria-selected={false} onClick={() => { onPick(p); setQ(''); setOpen(false); }} className="flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-surface-hover">
              <span className="truncate text-sm text-fg-display">{p.name}</span><span className="tabular shrink-0 text-xs text-fg-subtle">{t('m_n_models', { n: p.models })}</span>
            </button></li>
          ))}
          <li className="border-t border-border"><button type="button" role="option" aria-selected={false} onClick={() => { onPick(null); setQ(''); setOpen(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-fg-muted hover:bg-surface-hover hover:text-fg"><Plus size={14} />{t('m_custom')}</button></li>
        </ul>
      )}
    </div>
  );
}

function Block({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return <section className="mt-10"><div className="mb-3 flex items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{aside}</div>{children}</section>;
}

/** 设置 › 模型：一页草稿、一次保存 */
export function ModelsPanel() {
  const { t } = useT(); const L = useLabel(); const qc = useQueryClient();
  const q = useQuery({ queryKey: ['models'], queryFn: () => get<MState>('/models'), refetchInterval: 5000, retry: false });
  const [base, setBase] = useState<{ version: number; config: MConfig } | null>(null);
  const [draft, setDraft] = useState<MConfig | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [phase, setPhase] = useState<'edit' | 'confirm' | 'saving'>('edit');
  const [err, setErr] = useState<string | null>(null);
  const submitId = useRef(newSubmitId());
  const dirty = !!base && !!draft && (JSON.stringify(base.config) !== JSON.stringify(draft) || Object.keys(secrets).length > 0);
  const adopt = (s: { version: number; config: MConfig }) => { setBase({ version: s.version, config: clone(s.config) }); setDraft(clone(s.config)); setSecrets({}); setPhase('edit'); setErr(null); submitId.current = newSubmitId(); };
  useEffect(() => { if (q.data && (!base || (!dirty && q.data.version !== base.version))) adopt(q.data); }, [q.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dirty) return; const f = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', f); return () => window.removeEventListener('beforeunload', f); }, [dirty]);

  const draftKey = draft ? JSON.stringify(draft) : '';
  const [debounced, setDebounced] = useState(draftKey);
  useEffect(() => { const h = setTimeout(() => setDebounced(draftKey), 350); return () => clearTimeout(h); }, [draftKey]);
  const preview = useQuery({ queryKey: ['m-preview', debounced], queryFn: () => post<MPreview>('/models/preview', { config: JSON.parse(debounced) as MConfig }), enabled: !!debounced, retry: false, placeholderData: (p) => p });
  const versions = useQuery({ queryKey: ['m-versions', base?.version], queryFn: () => get<MVersion[]>('/models/versions'), enabled: !!base });

  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data || !base || !draft) return <div className="space-y-4"><Skeleton className="h-12 w-1/2" /><Skeleton className="h-64 w-full" /></div>;
  const s = q.data;
  const conflict = s.version > base.version && dirty;
  const change = (fn: (c: MConfig) => void) => setDraft((d) => { const n = clone(d!); fn(n); const ids = new Set(n.providers.flatMap((p) => p.models.map((m) => m.id))); n.order = [...n.order.filter((id) => ids.has(id)), ...[...ids].filter((id) => !n.order.includes(id))]; return n; });
  const nameOf = (id: string) => { for (const p of draft.providers) { const m = p.models.find((x) => x.id === id); if (m) return `${p.name} / ${m.name ?? m.model}`; } return id; };
  const routes = preview.data?.routes ?? [];
  const reasons = new Map<string, string>();
  for (const r of routes) for (const sk of r.skipped) if (!reasons.has(sk.id) && sk.reason !== 'no_vision' && sk.reason !== 'wrong_family') reasons.set(sk.id, sk.reason);
  const save = async (baseVersion = base.version) => {
    setPhase('saving'); setErr(null);
    try { const out = await post<MState>('/models/publish', { base_version: baseVersion, submit_id: submitId.current, config: draft, new_secrets: secrets }); qc.setQueryData(['models'], out); adopt(out); void qc.invalidateQueries({ queryKey: ['me'] }); }
    catch (e) { setPhase('edit'); if (e instanceof ApiError && e.status === 409) void q.refetch(); else setErr(e instanceof ApiError ? e.code : String(e)); }
  };
  const d = preview.data?.diff;
  const diffLines: ReactNode[] = d ? [
    ...[...d.providers_added, ...d.models_added].map((n) => <li key={`+${n}`}><span className="text-success">+ </span>{n}</li>),
    ...[...d.providers_removed, ...d.models_removed].map((n) => <li key={`-${n}`}><span className="text-danger">− </span>{n}</li>),
    ...(d.order_changed ? [<li key="o">{t('m_order_changed')}</li>] : []),
    ...(d.credentials.before !== d.credentials.after ? [<li key="c" className="tabular">{t('m_creds')} {d.credentials.before} → {d.credentials.after}</li>] : []),
    ...ALL_USES.filter((u) => d.effective[u].before !== d.effective[u].after).map((u) => <li key={u} className={`tabular ${d.effective[u].after === 0 && u !== 'embed' && u !== 'image' && u !== 'chat' ? 'text-danger' : ''}`}>{t(`m_use_${u}`)} · {t('m_effective')} {d.effective[u].before} → {d.effective[u].after}</li>),
  ] : [];

  return (
    <div>
      <header className="sticky top-[var(--ds-header-height)] z-20 -mx-4 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 lg:pt-0">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{t('m_title')}</h2>
            <p className="tabular mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted" role="status">
              {conflict ? <span className="text-danger">{t('m_conflict', { n: s.version })}</span> : dirty ? <span className="inline-flex items-center gap-1.5 text-warning"><span className="h-1.5 w-1.5 rounded-full bg-warning" />{t('m_dirty')}</span> : <span>{t('m_version', { n: base.version })}</span>}
              {!dirty && s.instances.map((i) => (i.version === s.version
                ? <span key={i.id} className="inline-flex items-center gap-1 text-success"><Check size={12} />{L(`inst_${i.kind}`)}</span>
                : <span key={i.id} className="text-warning">{t('m_behind', { who: L(`inst_${i.kind}`), n: i.version })}</span>))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {conflict ? <><Button onClick={() => adopt(s)}>{t('m_take_theirs')}</Button><Button variant="primary" onClick={() => void save(s.version)}>{t('m_keep_mine')}</Button></>
              : phase === 'confirm' ? <><Button variant="ghost" onClick={() => setPhase('edit')}>{t('m_back')}</Button><Button variant="primary" onClick={() => void save()}>{t('m_confirm')}</Button></>
              : <>{dirty && <Button variant="ghost" disabled={phase === 'saving'} onClick={() => adopt(base)}>{t('m_discard')}</Button>}<Button variant="primary" disabled={!dirty || phase === 'saving'} onClick={() => setPhase('confirm')}>{phase === 'saving' ? t('m_saving') : t('m_save')}</Button></>}
          </div>
        </div>
        {err && <p role="alert" className="mt-2 break-words text-xs text-danger">{err}</p>}
        {phase === 'confirm' && <ul className="mt-3 space-y-0.5 border-t border-border pt-3 text-sm">{diffLines.length ? diffLines : <li className="text-fg-muted">{t('m_no_change')}</li>}</ul>}
      </header>

      <dl className="mt-6 grid gap-x-8 gap-y-3 sm:grid-cols-3">
        {ALL_USES.map((u) => {
          const r = routes.find((x) => x.use === u); const first = r?.eligible[0]; const need = u !== 'embed' && u !== 'image';
          if (!need && !first) return null;
          return (
            <div key={u} className="min-w-0">
              <dt className="text-xs text-fg-muted">{t(`m_use_${u}`)}</dt>
              <dd className={`mt-0.5 truncate text-sm ${first ? 'text-fg-display' : u === 'chat' ? 'text-fg-muted' : 'text-danger'}`} title={r?.eligible.map(nameOf).join(' → ')}>{first ? <>{nameOf(first)}{r!.eligible.length > 1 && <span className="tabular text-fg-subtle"> +{r!.eligible.length - 1}</span>}</> : u === 'chat' ? t('m_chat_fallback') : t('m_none')}</dd>
            </div>
          );
        })}
      </dl>

      <Block title={t('m_add')}>
        <AddProvider list={s.catalog.providers} fetchedAt={s.catalog.fetched_at} onRefresh={async () => { await post('/models/catalog/refresh').catch(() => undefined); await q.refetch(); }}
          onPick={(c) => { const id = rid('prov'); change((cfg) => { cfg.providers.push(c ? { id, name: c.name, catalog_id: c.id, protocol: c.protocol, base_url: c.base_url, enabled: true, credentials: [], models: [] } : { id, name: t('m_custom'), protocol: 'openai', base_url: 'https://', enabled: true, credentials: [], models: [] }); }); setOpenId(id); }} />
        <ul className="mt-4 border-b border-border">
          {draft.providers.map((p) => (
            <ProviderCard key={p.id} p={p} lite={s.catalog.providers.find((c) => c.id === p.catalog_id)} open={openId === p.id} onToggle={() => setOpenId(openId === p.id ? null : p.id)}
              update={(fn) => change((cfg) => { fn(cfg.providers.find((x) => x.id === p.id)!); })} remove={() => { change((cfg) => { cfg.providers = cfg.providers.filter((x) => x.id !== p.id); }); setSecrets((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !p.credentials.some((c) => c.id === k)))); }}
              secrets={secrets} setSecret={(id, v) => setSecrets((x) => ({ ...x, [id]: v }))} dropSecret={(id) => setSecrets((x) => { const n = { ...x }; delete n[id]; return n; })}
              saved={base.config.providers.some((x) => x.id === p.id)} dirty={dirty} tests={s.tests} version={s.version} />
          ))}
        </ul>
      </Block>

      <Block title={t('m_order')}><OrderList cfg={draft} setOrder={(o) => change((cfg) => { cfg.order = o; })} reasons={reasons} /></Block>

      {(versions.data?.length ?? 0) > 1 && (
        <Block title={t('m_history')}>
          <ul className="border-b border-border">
            {versions.data!.slice(0, 8).map((v) => (
              <li key={v.version} className="tabular flex flex-wrap items-center justify-between gap-3 border-t border-border py-2.5 text-sm">
                <span className="text-fg-display">{t('m_version', { n: v.version })}<span className="ml-3 text-xs text-fg-subtle">{new Date(v.created_at).toLocaleString()} · {t('m_n_models', { n: v.models })}{v.note ? ` · ${v.note}` : ''}</span></span>
                {v.version !== s.version && <Button size="sm" variant="ghost" disabled={dirty} onClick={async () => { try { const out = await post<MState>('/models/rollback', { version: v.version }); qc.setQueryData(['models'], out); adopt(out); } catch (e) { setErr(e instanceof ApiError ? e.code : String(e)); } }}>{t('m_rollback')}</Button>}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  );
}
