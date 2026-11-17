// 右下角的「问 Jobs」：和飞书、jobsworld chat 是同一个 Jobs Agent。网页与终端共用同一条对话；管理员还能打开飞书里的对话。
// 一轮的输出经 POST /agent/send 的事件流（SSE）进来：文字逐字出现，做的每一步一行，截图、确认卡片、跟居民聊的切换都在流里。
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUp, Check, ImagePlus, Loader2, MessageCircle, RotateCcw, Square, TriangleAlert, X } from 'lucide-react';
import { evidenceUrl, get, post, useMe } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';
import { Avatar, Button } from './ui.tsx';

type Step = { id: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };
type Item =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string; steps?: Step[]; images?: { id: string; caption?: string }[]; confirms?: { id: string; label: string; text: string; state?: string; result?: string }[]; error?: string; live?: boolean }
  | { kind: 'resident'; name: string; persona_id: string; text: string }
  | { kind: 'step'; tool: string; error: boolean }
  | { kind: 'notice'; text: string };
interface SessionView { id: string; title: string | null; mode: { resident: { persona_id: string; name: string; history: { role: 'user' | 'resident'; text: string }[] } } | null; items: ({ kind: 'user' | 'assistant'; text: string } | { kind: 'step'; tool: string; error: boolean })[]; busy: boolean }
interface SessionRow { id: string; channel: string; title: string | null; updated_at: string; busy: boolean }

let openChatFn: ((text?: string) => void) | undefined;
/** 从任何地方打开对话（可以带一句话） */
export const openChat = (text?: string) => openChatFn?.(text);

/** 很小的 Markdown：粗体、行内代码、链接、列表、段落。站内地址点了在页面里跳转 */
function Md({ text }: { text: string }) {
  const nav = useNavigate();
  const inline = (s: string, k: string): ReactNode[] => {
    const out: ReactNode[] = []; const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)|(https?:\/\/[^\s)）]+)/g; let last = 0; let m: RegExpExecArray | null; let i = 0;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      if (m[1]) out.push(<strong key={`${k}b${i}`} className="font-semibold text-fg-display">{m[1]}</strong>);
      else if (m[2]) out.push(<code key={`${k}c${i}`} className="rounded-xs bg-surface-hover px-1 font-mono text-[0.85em]">{m[2]}</code>);
      else { const href = m[4] ?? m[5]; const label = m[3] ?? href; let path: string | null = null; try { const u = new URL(href, location.origin); if (/^\/(products|people|sessions|settings|human)(\/|$)/.test(u.pathname)) path = u.pathname + u.search + u.hash; } catch { /* */ }
        out.push(<a key={`${k}a${i}`} href={path ?? href} target={path ? undefined : '_blank'} rel="noreferrer" className="text-link underline decoration-border-strong underline-offset-2 hover:decoration-fg" onClick={path ? (e) => { e.preventDefault(); void nav({ to: path as '/' }); } : undefined}>{label}</a>); }
      last = m.index + m[0].length; i++;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  };
  const blocks = text.split(/\n{2,}/);
  return <>{blocks.map((b, bi) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*([-*·]|\d+\.)\s+/.test(l) || !l.trim())) return <ul key={bi} className="my-1.5 space-y-1 pl-1">{lines.filter((l) => l.trim()).map((l, li) => <li key={li} className="flex gap-2"><span className="text-fg-subtle">{/^\s*\d+\./.test(l) ? l.trim().split(/\s/)[0] : '·'}</span><span className="min-w-0">{inline(l.replace(/^\s*([-*·]|\d+\.)\s+/, ''), `${bi}-${li}`)}</span></li>)}</ul>;
    return <p key={bi} className="my-1.5 whitespace-pre-wrap break-words">{lines.map((l, li) => <span key={li}>{li > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), `${bi}-${li}`)}</span>)}</p>;
  })}</>;
}

async function* sse(path: string, body: unknown, signal: AbortSignal): AsyncGenerator<Record<string, unknown>> {
  const r = await fetch(`/api/v1${path}`, { method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok || !r.body) throw new Error(String(r.status));
  const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) { const { done, value } = await rd.read(); if (done) return; buf += dec.decode(value, { stream: true }); let i: number; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:')); buf = buf.slice(i + 2); if (line) yield JSON.parse(line.slice(5)); } }
}

const fileToB64 = (f: File) => new Promise<{ data: string; mime: string }>((res, rej) => { const r = new FileReader(); r.onload = () => res({ data: String(r.result).split(',')[1] ?? '', mime: f.type || 'image/png' }); r.onerror = rej; r.readAsDataURL(f); });

export function ChatPanel() {
  const { t } = useT(); const me = useMe();
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [resident, setResident] = useState<{ persona_id: string; name: string } | null>(null);
  const [text, setText] = useState(''); const [images, setImages] = useState<{ data: string; mime: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const ac = useRef<AbortController | null>(null); const scroller = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null);
  const role = me.data?.admin ? 'admin' : 'viewer';
  const sid = session ?? `local:${role}`;
  const sessions = useQuery({ enabled: open && !!me.data?.admin, queryKey: ['agent-sessions'], queryFn: () => get<SessionRow[]>('/agent/sessions'), refetchInterval: 30_000 });

  const load = useCallback(async (id: string) => {
    const v = await get<SessionView>(`/agent/sessions/${encodeURIComponent(id)}`).catch(() => null);
    if (!v) return;
    const out: Item[] = []; for (const x of v.items) if (x.kind !== 'step') out.push(x.kind === 'user' ? { kind: 'user', text: x.text } : { kind: 'assistant', text: x.text });
    if (v.mode?.resident) for (const h of v.mode.resident.history) out.push(h.role === 'user' ? { kind: 'user', text: h.text } : { kind: 'resident', name: v.mode.resident.name, persona_id: v.mode.resident.persona_id, text: h.text });
    setItems(out); setResident(v.mode?.resident ? { persona_id: v.mode.resident.persona_id, name: v.mode.resident.name } : null);
  }, []);

  useEffect(() => { openChatFn = (q?: string) => { setOpen(true); if (q) setText(q); setTimeout(() => input.current?.focus(), 50); }; return () => { openChatFn = undefined; }; }, []);
  useEffect(() => { if (open) void load(sid); }, [open, sid, load]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight }); }, [items]);

  /** 一个事件 → 改最后一条 Jobs 的话 */
  const apply = useCallback((e: Record<string, unknown>) => {
    setItems((xs) => {
      const ys = [...xs]; let a = ys[ys.length - 1];
      const ensure = () => { if (a?.kind !== 'assistant' || !a.live) { a = { kind: 'assistant', text: '', steps: [], live: true }; ys.push(a); } return a as Extract<Item, { kind: 'assistant' }>; };
      switch (e.type) {
        case 'start': ensure(); break;
        case 'text': { const x = ensure(); ys[ys.length - 1] = { ...x, text: x.text + String(e.delta) }; break; }
        case 'step': { const x = ensure(); const st = [...(x.steps ?? [])]; const i = st.findIndex((s) => s.id === e.id); const s = { id: String(e.id), label: String(e.label), status: e.status as Step['status'], detail: e.detail as string | undefined }; if (i >= 0) st[i] = s; else st.push(s); ys[ys.length - 1] = { ...x, steps: st }; break; }
        case 'image': { const x = ensure(); ys[ys.length - 1] = { ...x, images: [...(x.images ?? []), { id: String(e.evidence_id), caption: e.caption as string | undefined }] }; break; }
        case 'confirm': { const x = ensure(); ys[ys.length - 1] = { ...x, confirms: [...(x.confirms ?? []), { id: String(e.action_id), label: String(e.label), text: String(e.text) }] }; break; }
        case 'mode': setResident((e.resident as { persona_id: string; name: string } | null) ?? null); break;
        case 'resident': ys.push({ kind: 'resident', name: String(e.name), persona_id: String(e.persona_id), text: String(e.text) }); break;
        case 'notice': ys.push({ kind: 'notice', text: String(e.text) }); break;
        case 'end': {
          if (a?.kind === 'assistant' && a.live) ys[ys.length - 1] = { ...a, live: false, text: a.text || String(e.text ?? ''), error: e.error as string | undefined };
          else if (e.error || (e.text && ys[ys.length - 1]?.kind !== 'resident' && !e.steered)) ys.push({ kind: 'assistant', text: String(e.text ?? ''), error: e.error as string | undefined });
          break;
        }
      }
      return ys;
    });
  }, []);

  // 后台等到结果这类主动消息
  useEffect(() => {
    if (!open) return;
    const es = new EventSource(`/api/v1/agent/stream?session=${encodeURIComponent(sid)}`, { withCredentials: true });
    es.onmessage = (m) => { try { apply(JSON.parse(m.data)); } catch { /* */ } };
    return () => es.close();
  }, [open, sid, apply]);

  const send = async (raw?: string) => {
    const q = (raw ?? text).trim(); if ((!q && !images.length) || busy) return;
    setText(''); const imgs = images; setImages([]);
    setItems((xs) => [...xs, { kind: 'user', text: q + (imgs.length ? ' 🖼' : '') }]);
    setBusy(true); const c = new AbortController(); ac.current = c;
    try { for await (const e of sse('/agent/send', { text: q, images: imgs.length ? imgs : undefined, session: sid }, c.signal)) apply(e); }
    catch (e) { if (!c.signal.aborted) apply({ type: 'end', text: '', error: String((e as Error).message) }); }
    finally { setBusy(false); ac.current = null; void sessions.refetch(); }
  };
  const stop = async () => { await post('/agent/stop', { session: sid }).catch(() => undefined); };
  const decide = async (id: string, approve: boolean) => {
    const o = await post<{ ok: boolean; status: string; text: string }>(`/agent/actions/${id}`, { approve }).catch((e) => ({ ok: false, status: 'failed', text: String((e as Error).message) }));
    setItems((xs) => xs.map((x) => (x.kind === 'assistant' && x.confirms?.some((c) => c.id === id) ? { ...x, confirms: x.confirms.map((c) => (c.id === id ? { ...c, state: o.status, result: o.text } : c)) } : x)));
  };

  if (!me.data?.viewer) return null;
  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} aria-label={t('chat_open')} title={t('chat_open')}
          className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center sm:bottom-5 sm:right-5 sm:h-12 sm:w-12 justify-center rounded-full border border-border-strong bg-surface text-fg-display shadow-lg transition-colors hover:bg-surface-hover">
          <MessageCircle size={20} />
        </button>
      )}
      {open && (
        <section aria-label={t('chat_title')} className="fixed inset-0 z-50 flex flex-col bg-bg sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[min(42rem,calc(100dvh-6rem))] sm:w-[26rem] sm:rounded-lg sm:border sm:border-border-strong sm:shadow-2xl">
          <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
            {resident ? <><Avatar id={resident.persona_id} size={26} /><span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-display">{resident.name}<span className="ml-2 text-xs font-normal text-accent">{t('chat_with_resident')}</span></span><Button size="sm" variant="ghost" onClick={() => void send('结束')}>{t('chat_end_resident')}</Button></>
              : <span className="min-w-0 flex-1 truncate text-sm font-semibold text-fg-display">{t('chat_title')}</span>}
            {me.data?.admin && (sessions.data?.length ?? 0) > 1 && (
              <select aria-label={t('chat_sessions')} value={sid} onChange={(e) => setSession(e.target.value)} className="h-7 max-w-[8.5rem] truncate rounded-md border border-border bg-bg-elevated px-1.5 text-xs text-fg-muted">
                <option value={`local:${role}`}>{t('chat_here')}</option>
                {sessions.data!.filter((s) => s.id !== `local:${role}` && s.id.startsWith('feishu:')).map((s) => <option key={s.id} value={s.id}>{t('chat_feishu')}{s.title ? ` · ${s.title}` : ''}</option>)}
              </select>
            )}
            <button type="button" title={t('chat_new')} aria-label={t('chat_new')} onClick={() => { setItems([]); void send('/new'); }} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"><RotateCcw size={15} /></button>
            <button type="button" title={t('close')} aria-label={t('close')} onClick={() => setOpen(false)} className="rounded-md p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"><X size={16} /></button>
          </header>

          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm leading-relaxed">
            {!items.length && (
              <div className="mt-8 space-y-2 px-2">
                <p className="text-fg-muted">{t('chat_hint')}</p>
                {[t('chat_eg1'), t('chat_eg2'), t('chat_eg3')].map((q) => <button key={q} type="button" onClick={() => void send(q)} className="block w-full rounded-md border border-border px-3 py-2 text-left text-fg hover:bg-surface-hover">{q}</button>)}
              </div>
            )}
            {items.map((x, i) => {
              if (x.kind === 'user') return <div key={i} className="my-2 flex justify-end"><p className="max-w-[85%] whitespace-pre-wrap break-words rounded-lg bg-surface-hover px-3 py-2 text-fg-display">{x.text}</p></div>;
              if (x.kind === 'notice') return <p key={i} className="my-1 text-center text-xs text-fg-subtle">{x.text}</p>;
              if (x.kind === 'step') return null;
              if (x.kind === 'resident') return <div key={i} className="my-2 flex gap-2"><Avatar id={x.persona_id} size={28} /><div className="min-w-0"><p className="text-xs text-accent">{x.name}</p><p className="whitespace-pre-wrap break-words text-fg">{x.text}</p></div></div>;
              return (
                <div key={i} className="my-2 text-fg">
                  {!!x.steps?.length && <ul className="mb-1 space-y-0.5">{x.steps.map((s) => <li key={s.id} className="flex items-center gap-1.5 text-xs text-fg-subtle">{s.status === 'running' ? <Loader2 size={12} className="animate-spin" /> : s.status === 'error' ? <TriangleAlert size={12} className="text-danger" /> : <Check size={12} />}<span>{s.label}</span>{s.detail && <span className="truncate text-danger">{s.detail}</span>}</li>)}</ul>}
                  {x.text ? <Md text={x.text} /> : x.live && !x.steps?.length ? <Loader2 size={14} className="animate-spin text-fg-subtle" /> : null}
                  {x.images?.map((im) => <figure key={im.id} className="my-2"><a href={evidenceUrl(im.id)} target="_blank" rel="noreferrer"><img src={evidenceUrl(im.id)} alt={im.caption ?? ''} loading="lazy" className="max-h-72 rounded-md border border-border" /></a>{im.caption && <figcaption className="mt-1 text-xs text-fg-muted">{im.caption}</figcaption>}</figure>)}
                  {x.confirms?.map((c) => (
                    <div key={c.id} className="my-2 rounded-md border border-border-strong p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-danger"><TriangleAlert size={13} />{c.label}</p>
                      <p className="mt-1 text-fg">{c.text}</p>
                      {c.state ? <p className="mt-2 text-xs text-fg-muted">{c.result}</p> : me.data?.admin ? <div className="mt-2 flex gap-2"><Button size="sm" variant="danger" onClick={() => void decide(c.id, true)}>{t('chat_confirm')}</Button><Button size="sm" variant="ghost" onClick={() => void decide(c.id, false)}>{t('cancel')}</Button></div> : <p className="mt-2 text-xs text-fg-muted">{t('chat_admin_only')}</p>}
                    </div>
                  ))}
                  {x.error && <p className="mt-1 flex items-start gap-1.5 text-xs text-danger"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{x.error}</p>}
                </div>
              );
            })}
          </div>

          <form className="border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            {!!images.length && <div className="mb-1.5 flex gap-1.5 px-1">{images.map((im, i) => <button key={i} type="button" onClick={() => setImages(images.filter((_, j) => j !== i))} className="relative"><img src={`data:${im.mime};base64,${im.data}`} alt="" className="h-12 w-12 rounded-md border border-border object-cover" /><X size={12} className="absolute -right-1 -top-1 rounded-full bg-surface text-fg" /></button>)}</div>}
            <div className="flex items-end gap-1.5">
              <label className="cursor-pointer rounded-md p-2 text-fg-muted hover:bg-surface-hover hover:text-fg" title={t('chat_image')} aria-label={t('chat_image')}>
                <ImagePlus size={17} /><input type="file" accept="image/*" multiple className="hidden" onChange={async (e) => { const fs = [...(e.target.files ?? [])].slice(0, 3); setImages([...images, ...(await Promise.all(fs.map(fileToB64)))].slice(0, 3)); e.target.value = ''; }} />
              </label>
              <textarea ref={input} rows={1} value={text} placeholder={resident ? t('chat_to_resident', { name: resident.name }) : t('chat_placeholder')} onChange={(e) => setText(e.target.value)}
                onPaste={async (e) => { const fs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/')); if (fs.length) { e.preventDefault(); setImages([...images, ...(await Promise.all(fs.map(fileToB64)))].slice(0, 3)); } }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
                className="max-h-36 min-h-9 flex-1 resize-none rounded-md border border-border bg-bg-elevated px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:border-border-strong focus:outline-none" />
              {busy ? <button type="button" onClick={() => void stop()} title={t('chat_stop')} aria-label={t('chat_stop')} className="rounded-md border border-border-strong p-2 text-fg hover:bg-surface-hover"><Square size={15} /></button>
                : <button type="submit" disabled={!text.trim() && !images.length} title={t('chat_send')} aria-label={t('chat_send')} className="rounded-md border border-border-strong p-2 text-fg-display hover:bg-surface-hover disabled:opacity-30"><ArrowUp size={15} /></button>}
            </div>
          </form>
        </section>
      )}
    </>
  );
}
