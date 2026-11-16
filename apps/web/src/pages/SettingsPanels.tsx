// 设置页的几个分类：接入 coding agent、飞书、游戏服、版本与升级（原来在顶栏的浮层里，现在都集中到设置）
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, RotateCw, X } from 'lucide-react';
import { ApiError, del, get, post, queryClient } from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { useLang, useT } from '../lib/i18n.ts';
import { useUpdate } from '../lib/update.ts';
import { Button, Section, Skeleton } from '../components/ui.tsx';

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return [copied, (key: string, text: string) => { void copyText(text).then((ok) => { if (!ok) return; setCopied(key); setTimeout(() => setCopied(null), 1600); }); }] as const;
}
const Dot = ({ tone, live }: { tone: 'success' | 'accent' | 'idle' | 'danger'; live?: boolean }) => <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === 'success' ? 'bg-success' : tone === 'accent' ? 'bg-accent' : tone === 'danger' ? 'bg-danger' : 'bg-border-strong'} ${live ? 'live-dot' : ''}`} />;
const Code = ({ text, shown, onClick, title }: { text: string; shown?: string; onClick: () => void; title?: string }) => (
  <button type="button" onClick={onClick} title={title} className="block w-full break-all rounded-md bg-code-bg px-3 py-2 text-left font-mono text-xs leading-relaxed text-code-fg">{shown ?? text}</button>
);

// ---------------------------------------------------------------- coding agent（远程 MCP）
interface AgentsState { mcp_url: string; enabled: boolean; public_url_set: boolean; grants: { id: string; client: string | null; role: 'admin' | 'viewer'; authorized_at: string; last_used_at: string | null }[] }

export function AgentsPanel({ onPublic }: { onPublic: () => void }) {
  const { t } = useT(); const lang = useLang(); const [copied, copy] = useCopy();
  const q = useQuery({ queryKey: ['agents'], queryFn: () => get<AgentsState>('/agents'), refetchInterval: 10_000 });
  const d = q.data;
  if (!d) return <Skeleton className="h-48 w-full" />;
  const cmds = [
    { k: 'claude', label: 'Claude Code', text: `claude mcp add --transport http jobs ${d.mcp_url}` },
    { k: 'codex', label: 'Codex', text: `codex mcp add jobs --url ${d.mcp_url}` },
    { k: 'json', label: 'Cursor · JSON', text: JSON.stringify({ mcpServers: { jobs: { url: d.mcp_url } } }) },
  ];
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  return (
    <>
      <Section title={t('agents')}>
        <button type="button" onClick={() => copy('url', d.mcp_url)} className="block w-full truncate rounded-md border border-border px-3 py-2 text-left font-mono text-sm text-fg-display transition-colors hover:border-fg-subtle">{copied === 'url' ? t('copied') : d.mcp_url}</button>
        {!d.enabled ? <p role="alert" className="mt-2 text-xs text-danger">{t('ag_disabled')}</p> : !d.public_url_set && <p className="mt-2 text-xs text-warning">{t('ag_local_only')} · <button type="button" onClick={onPublic} className="underline underline-offset-2 hover:text-fg">{t('s_public')}</button></p>}
        <ul className="mt-5 space-y-3">
          {cmds.map((c) => <li key={c.k}><p className="text-xs text-fg-muted">{c.label}</p><div className="mt-1"><Code text={c.text} shown={copied === c.k ? t('copied') : undefined} onClick={() => copy(c.k, c.text)} /></div></li>)}
        </ul>
      </Section>
      {d.grants.length > 0 && (
        <Section title={t('ag_granted')} aside={<span className="tabular text-xs text-fg-subtle">{d.grants.length}</span>}>
          <ul className="divide-y divide-border border-y border-border">
            {d.grants.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0"><span className="block truncate text-fg">{g.client ?? 'coding agent'}<span className="ml-2 text-xs text-fg-muted">{t(g.role === 'admin' ? 'ag_admin' : 'ag_viewer')}</span></span><span className="tabular block text-xs text-fg-subtle">{t('ag_last_used', { t: when(g.last_used_at ?? g.authorized_at) })}</span></span>
                <Button variant="ghost" size="sm" className="w-7 shrink-0" aria-label={t('ag_revoke')} title={t('ag_revoke')} onClick={async () => { await del(`/agents/${g.id}`); void q.refetch(); }}><X size={14} /></Button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

// ---------------------------------------------------------------- 飞书
interface FeishuState { connected: boolean; app_id: string | null; brand: string | null; connected_at: string | null; pending: { url: string; qr_svg: string; expires_at: number } | null; error: string | null }

export function FeishuPanel() {
  const { t } = useT();
  const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const q = useQuery({ queryKey: ['feishu'], queryFn: () => get<FeishuState>('/feishu'), refetchInterval: (x) => (x.state.data?.pending ? 2500 : false), retry: false });
  const act = async (path: string) => { setBusy(true); try { const s = await post<FeishuState>(path); if ('connected' in s) queryClient.setQueryData(['feishu'], s); } catch { /* 状态里会带出错误 */ } finally { setBusy(false); void q.refetch(); } };
  const s = q.data;
  return (
    <Section title={t('feishu')}>
      {!s ? <Skeleton className="h-9 w-48" />
        : s.connected ? (
          <>
            <p className="flex items-center gap-2 text-sm text-fg"><Dot tone="success" />{t('fs_connected')}{s.app_id && <span className="tabular text-xs text-fg-subtle">{s.app_id}</span>}</p>
            <div className="mt-4 flex gap-2">
              <Button size="sm" disabled={busy} onClick={async () => { await act('/feishu/test'); setSent(true); setTimeout(() => setSent(false), 1600); }}>{sent ? t('fs_sent') : t('fs_test')}</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('/feishu/disconnect')}>{t('fs_disconnect')}</Button>
            </div>
          </>
        ) : s.pending ? (
          <div className="w-60">
            <a href={s.pending.url} target="_blank" rel="noreferrer" aria-label={t('fs_scan')} className="block rounded-md bg-white p-2 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: s.pending.qr_svg }} />
            <p className="mt-2 flex items-center gap-2 text-xs text-fg-muted"><Dot tone="accent" live />{t('fs_scan')}</p>
          </div>
        ) : (
          <>
            {s.error && <p role="alert" className="mb-3 break-words text-xs text-danger">{s.error}</p>}
            <Button variant="primary" disabled={busy} onClick={() => void act('/feishu/connect')}>{busy ? '…' : t('fs_connect')}</Button>
          </>
        )}
    </Section>
  );
}

// ---------------------------------------------------------------- 游戏服
interface GameState { tshock: { up: boolean; pending: boolean }; tml: { up: boolean; pending: boolean }; can_toggle: boolean; port: number; password: boolean }

export function GamePanel() {
  const { t } = useT(); const [copied, copy] = useCopy(); const [cmd, setCmd] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['game'], queryFn: () => get<GameState>('/game'), refetchInterval: 3000 });
  const toggle = async (kind: 'tshock' | 'tml', on: boolean) => { setCmd(null); try { await post('/game', { kind, on }); } catch (e) { if (e instanceof ApiError && e.status === 409) setCmd(String(e.body?.command ?? `jobsworld game ${on ? 'on' : 'off'} ${kind}`)); } void q.refetch(); };
  const d = q.data;
  if (!d) return <Skeleton className="h-40 w-full" />;
  const addr = `${location.hostname}:${d.port}`;
  return (
    <Section title={t('game')}>
      <button type="button" onClick={() => copy('addr', addr)} className="tabular block w-full max-w-[24rem] rounded-md border border-border px-3 py-2 text-left font-mono text-sm text-fg-display transition-colors hover:border-fg-subtle">{copied === 'addr' ? t('copied') : addr}</button>
      <ul className="mt-5 max-w-[24rem] divide-y divide-border border-y border-border">
        {(['tshock', 'tml'] as const).map((k) => { const g = d[k]; return (
          <li key={k} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span className="flex items-center gap-2"><Dot tone={g.up ? 'success' : g.pending ? 'accent' : 'idle'} live={g.pending} />{t(k === 'tshock' ? 'g_tshock' : 'g_tml')}</span>
            <button type="button" role="switch" aria-checked={g.up} aria-label={t(k === 'tshock' ? 'g_tshock' : 'g_tml')} disabled={g.pending} onClick={() => void toggle(k, !g.up)} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60 ${g.up ? 'bg-fg-display' : 'bg-border-strong'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-[left] ${g.up ? 'left-[18px]' : 'left-0.5'}`} /></button>
          </li>
        ); })}
      </ul>
      {cmd && <div className="mt-4 max-w-[24rem]"><Code text={cmd} shown={copied === 'cmd' ? t('copied') : undefined} title={t('g_run')} onClick={() => copy('cmd', cmd)} /></div>}
    </Section>
  );
}

// ---------------------------------------------------------------- 版本与升级
export function VersionPanel() {
  const { t, lang } = useT(); const [copied, copy] = useCopy(); const [checking, setChecking] = useState(false);
  const { q, d, failed, slow, running, go } = useUpdate();
  if (!d) return <Skeleton className="h-40 w-full" />;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const checkNow = async () => { setChecking(true); try { const out = await post<typeof d>('/version/check'); queryClient.setQueryData(['version'], (x: typeof d | undefined) => ({ ...(x ?? d), ...out })); } catch { /* 状态里会带出错误 */ } finally { setChecking(false); void q.refetch(); } };
  return (
    <Section title={t('v_title')}>
      <dl className="grid max-w-[28rem] grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-fg-muted">{t('v_current')}</dt><dd className="tabular text-fg-display">{d.version}</dd>
        <dt className="text-fg-muted">{t('v_latest')}</dt>
        <dd className="tabular">{d.latest ? <a href={d.latest.url} target="_blank" rel="noreferrer" className="text-link hover:text-accent">{d.latest.version}</a> : '—'}{d.check && <span className="ml-2 text-xs text-fg-subtle">{when(d.checked_at)}</span>}</dd>
      </dl>
      {d.error && <p className="mt-2 text-xs text-fg-subtle">{d.error}</p>}
      <div className="mt-5">
        {running ? (
          <p className="flex items-start gap-2 text-sm text-fg" role="status"><span className="mt-1.5"><Dot tone="accent" live /></span>{slow ? t('up_slow') : t('up_running')}</p>
        ) : d.update_available || failed ? (
          <div className="max-w-[28rem]">
            {failed && (<>
              <p role="alert" className="text-sm text-danger">{t('up_failed')}</p>
              {d.update?.log && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-code-bg px-3 py-2 font-mono text-[11px] leading-relaxed text-code-fg">{d.update.log}</pre>}
            </>)}
            {d.can_update ? (<>
              <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t('up_hint')}</p>
              <Button variant="primary" className="mt-3" onClick={() => void go()}>{failed ? t('up_retry') : t('up_now')}</Button>
            </>) : d.command && (<>
              <p className="mt-3 text-xs leading-relaxed text-fg-muted">{t('up_manual')}</p>
              <div className="mt-2"><Code text={d.command} shown={copied === 'cmd' ? t('copied') : undefined} onClick={() => copy('cmd', d.command!)} /></div>
            </>)}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-fg-muted"><Check size={14} className="text-success" />{t('v_latest_ok')}</span>
            {d.check && <Button size="sm" variant="ghost" disabled={checking} onClick={() => void checkNow()}><RotateCw size={13} className={checking ? 'animate-spin' : ''} />{t('v_check')}</Button>}
          </div>
        )}
      </div>
    </Section>
  );
}
