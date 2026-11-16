// 设置（仅管理员）：所有「配置」性质的功能都在这里，按分类分成二级标签：
// 模型、公网链接、居民邮箱、接入 coding agent、飞书、游戏服、版本与升级。
import { useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { AlertTriangle, ArrowUpCircle, Bot, Check, CircleDashed, Copy, ExternalLink, Gamepad2, Globe, Mail, MessageCircle, Power, RotateCw, SlidersHorizontal } from 'lucide-react';
import { ApiError, del, get, post, useMe } from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { useT } from '../lib/i18n.ts';
import { useUpdate } from '../lib/update.ts';
import { Button, ErrorState, PageHead, Section, Skeleton } from '../components/ui.tsx';
import { MailList, type MailBrief } from '../components/Mail.tsx';
import { ModelsPanel } from './Models.tsx';
import { AgentsPanel, FeishuPanel, GamePanel, VersionPanel } from './SettingsPanels.tsx';

export const SETTINGS_TABS = ['models', 'public', 'mail', 'agents', 'feishu', 'game', 'version'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

interface MailStatus {
  status: 'off' | 'deploying' | 'ready' | 'error'; error?: string; note?: string; domain: string; real: boolean; token_hint?: string; zone?: string; deployed_at?: string;
  cloudflare?: { enabled: boolean; status?: string } | { error: string };
  routes: { used: number; cap: number }; unowned: number; permissions: string[]; warming: boolean;
  check?: { address: string; created_at: string; received_at?: string; sender?: string; subject?: string };
}
interface Settings { public_url: string; public_url_env: string; public_url_effective: string; mail: MailStatus }

const put = async <T,>(p: string, json: unknown): Promise<T> => {
  const r = await fetch(`/api/v1${p}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, (b as { error?: string }).error ?? String(r.status), b);
  return b as T;
};
const errText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status !== 500 ? e.code : fallback);
const isLocal = (u: string) => { try { const h = new URL(u).hostname; return h === 'localhost' || /^127\./.test(h) || /^(10|192\.168)\./.test(h); } catch { return true; } };
const CF_TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens';

/** 公网链接与居民邮箱共用一份 /settings 状态；which 决定显示哪一部分 */
function SiteSettings({ which, onPublic }: { which: 'public' | 'mail'; onPublic: () => void }) {
  const { t } = useT(); const qc = useQueryClient();
  const [checking, setChecking] = useState(false);
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/settings?live=1'), refetchInterval: checking ? 3000 : false });
  const unowned = useQuery({ queryKey: ['mail-unowned'], queryFn: () => get<MailBrief[]>('/settings/mail/unowned'), enabled: !!q.data?.mail.unowned });
  const [url, setUrl] = useState(''); const [urlBusy, setUrlBusy] = useState(false); const [urlMsg, setUrlMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [token, setToken] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (q.data) setUrl(q.data.public_url || q.data.public_url_env); }, [q.data?.public_url, q.data?.public_url_env]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = q.data?.mail.check;
  useEffect(() => { setChecking(!!check && !check.received_at); }, [check?.address, check?.received_at]); // eslint-disable-line react-hooks/exhaustive-deps
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton className="h-96 w-full" />;
  const d = q.data; const m = d.mail;
  const effective = d.public_url_effective; const httpsPublic = effective.startsWith('https://') && !isLocal(effective);
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings'] });

  const saveUrl = async () => {
    setUrlBusy(true); setUrlMsg(null);
    try { await put('/settings', { public_url: url }); await refresh(); setUrlMsg({ ok: true, text: m.real && new URL(url.includes('://') ? url : `https://${url}`).hostname !== m.domain.replace(/^mail\./, '') ? t('s_change_url_warn') : t('s_saved') }); }
    catch (e) { setUrlMsg({ ok: false, text: errText(e, t('error')) }); } finally { setUrlBusy(false); }
  };
  const deploy = async () => {
    setBusy(true); setErr(null);
    try { await post('/settings/mail', token.trim() ? { token: token.trim() } : {}); setToken(''); await refresh(); }
    catch (e) { setErr(errText(e, t('error'))); await refresh(); } finally { setBusy(false); }
  };
  const disable = async () => { if (!window.confirm(t('s_disable_confirm'))) return; setBusy(true); try { await del('/settings/mail'); await refresh(); } finally { setBusy(false); } };
  const startCheck = async () => { setErr(null); try { await post('/settings/mail/check'); await refresh(); } catch (e) { setErr(errText(e, t('error'))); } };
  const endCheck = async () => { await del('/settings/mail/check'); await refresh(); };

  if (which === 'public') return (
      <Section title={t('s_public')}>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void saveUrl(); }}>
          <input className="field h-9 min-w-0 flex-1" type="url" inputMode="url" placeholder={t('s_public_ph')} value={url} onChange={(e) => { setUrl(e.target.value); setUrlMsg(null); }} aria-label={t('s_public')} />
          <Button disabled={urlBusy || url.trim() === (d.public_url || d.public_url_env)}>{t('s_save')}</Button>
        </form>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle">
          {httpsPublic ? <Check size={12} className="text-success" /> : <AlertTriangle size={12} className="text-warning" />}
          <span className="tabular">{effective}</span>
          {!d.public_url && d.public_url_env && <span>· {t('s_from_env')}</span>}
          {!httpsPublic && <span>· {t('s_local')}</span>}
        </p>
        {urlMsg && <p role={urlMsg.ok ? 'status' : 'alert'} className={`mt-1 text-xs ${urlMsg.ok ? 'text-fg-muted' : 'text-danger'}`}>{urlMsg.text}</p>}
      </Section>
  );

  return (
    <>
      <Section title={t('s_mail')}
        aside={m.real && <span className="tabular text-xs text-fg-subtle" title={t('s_rules')}>{t('s_rules')} {t('s_rules_n', { n: m.routes.used, cap: m.routes.cap })}</span>}>
        <p className="flex items-center gap-2 text-sm">
          {m.real ? <Check size={15} className="text-success" /> : <CircleDashed size={15} className="text-fg-subtle" />}
          <span className={m.real ? 'text-fg-display' : 'text-fg-muted'}>{m.real ? t('s_mail_on', { d: m.domain }) : t('s_mail_off', { d: m.domain })}</span>
        </p>
        {m.note && <p className="mt-2 text-xs text-fg-muted">{m.note}</p>}
        {m.real && m.warming && <p className="mt-2 flex items-center gap-1.5 text-xs text-warning"><RotateCw size={12} className="animate-spin" />{t('s_warming')}</p>}
        {(err || m.error) && <p role="alert" className="mt-2 text-xs text-danger">{err || m.error}</p>}

        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void deploy(); }}>
          <label className="block">
            <span className="flex items-center gap-2 text-xs text-fg-muted">{t('s_cf_token')}{m.token_hint && <span className="tabular text-fg-subtle">{m.token_hint}{m.zone ? ` · ${m.zone}` : ''}</span>}
              <a href={CF_TOKEN_URL} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-fg-subtle hover:text-fg">{t('s_cf_create')}<ExternalLink size={11} /></a></span>
            <input className="field mt-1 h-9 font-mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder={m.token_hint ?? ''} />
          </label>
          <details className="text-xs text-fg-subtle">
            <summary className="cursor-pointer select-none">{t('s_cf_perms')}</summary>
            <ul className="mt-1.5 space-y-0.5 pl-4">{m.permissions.map((p) => <li key={p} className="font-mono">{p}</li>)}</ul>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy || !httpsPublic || (!token.trim() && !m.token_hint)} title={!httpsPublic ? t('s_need_public') : undefined}>
              {busy ? <><RotateCw size={14} className="animate-spin" />{t('s_enabling')}</> : m.real ? <><RotateCw size={14} />{t('s_redeploy')}</> : t('s_enable')}
            </Button>
            {m.real && <Button type="button" variant="ghost" disabled={busy} onClick={() => void disable()}><Power size={14} />{t('s_disable')}</Button>}
            {!httpsPublic && <button type="button" onClick={onPublic} className="text-xs text-warning underline underline-offset-2 hover:text-fg">{t('s_need_public')}</button>}
          </div>
        </form>

        {m.real && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs text-fg-muted">{t('s_check')}</p>
            {!check ? <Button className="mt-2" size="sm" onClick={() => void startCheck()}>{t('s_check_start')}</Button> : (
              <div className="mt-2 space-y-2">
                <p className="text-xs text-fg-subtle">{t('s_check_send')}</p>
                <div className="flex items-center gap-2">
                  <code className="tabular rounded-md bg-surface px-2 py-1 text-sm text-fg-display">{check.address}</code>
                  <Button size="sm" variant="ghost" aria-label="copy" onClick={() => void copyText(check.address)}><Copy size={13} /></Button>
                </div>
                <p className={`flex items-center gap-1.5 text-sm ${check.received_at ? 'text-success' : 'text-fg-muted'}`} role="status">
                  {check.received_at ? <><Check size={14} />{t('s_check_ok')}{check.subject ? ` · ${check.subject}` : ''}</> : <><RotateCw size={13} className="animate-spin" />{t('s_check_wait')}</>}
                </p>
                <Button size="sm" variant="ghost" onClick={() => void endCheck()}>{t('s_check_end')}</Button>
              </div>
            )}
          </div>
        )}
      </Section>

      {m.unowned > 0 && (
        <Section title={t('s_unowned')} aside={<span className="tabular text-xs text-fg-subtle">{m.unowned}</span>}>
          {unowned.data ? <MailList items={unowned.data} showAddress /> : <Skeleton className="h-20 w-full" />}
        </Section>
      )}
    </>
  );
}

export function SettingsPage() {
  const { t } = useT(); const nav = useNavigate(); const me = useMe().data;
  const search = useSearch({ strict: false }) as { tab?: SettingsTab };
  const tab: SettingsTab = search.tab ?? 'models';
  const go = (x: SettingsTab) => void nav({ to: '/settings', search: x === 'models' ? {} : { tab: x }, replace: true });
  const up = useUpdate(!!me?.admin);
  const needModels = me?.models_ready === false;
  const hasUpdate = !!up.d?.update_available || up.running || up.failed;
  const tabs: { id: SettingsTab; icon: ReactNode; label: string; dot?: boolean }[] = [
    { id: 'models', icon: <SlidersHorizontal size={14} />, label: t('nav.models'), dot: needModels },
    { id: 'public', icon: <Globe size={14} />, label: t('s_public') },
    { id: 'mail', icon: <Mail size={14} />, label: t('s_mail') },
    { id: 'agents', icon: <Bot size={14} />, label: t('st_agents') },
    { id: 'feishu', icon: <MessageCircle size={14} />, label: t('feishu') },
    { id: 'game', icon: <Gamepad2 size={14} />, label: t('st_game') },
    { id: 'version', icon: <ArrowUpCircle size={14} />, label: t('st_version'), dot: hasUpdate },
  ];
  if (me && !me.admin) return <ErrorState />;
  return (
    <article>
      <PageHead title={t('nav.settings')} />
      <nav role="tablist" aria-label={t('nav.settings')} className="-mx-4 flex overflow-x-auto border-b border-border px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {tabs.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => go(x.id)}
            className={`relative flex h-10 shrink-0 items-center gap-1.5 px-3 text-sm transition-colors first:pl-0 ${tab === x.id ? 'text-fg-display after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-accent first:after:left-0' : 'text-fg-muted hover:text-fg'}`}>
            <span className={tab === x.id ? 'text-fg-display' : 'text-fg-subtle'}>{x.icon}</span>{x.label}
            {x.dot && <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />}
          </button>
        ))}
      </nav>
      <div role="tabpanel" className={tab === 'models' ? 'mt-0' : 'max-w-3xl [&>section:first-child]:mt-8'}>
        {tab === 'models' && <ModelsPanel />}
        {(tab === 'public' || tab === 'mail') && <SiteSettings which={tab} onPublic={() => go('public')} />}
        {tab === 'agents' && <AgentsPanel onPublic={() => go('public')} />}
        {tab === 'feishu' && <FeishuPanel />}
        {tab === 'game' && <GamePanel />}
        {tab === 'version' && <VersionPanel />}
      </div>
    </article>
  );
}
