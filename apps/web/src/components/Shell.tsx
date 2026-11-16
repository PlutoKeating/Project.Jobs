import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { ArrowUpCircle, Gamepad2, LogOut, Moon, Pause, Settings as SettingsIcon, Sun } from 'lucide-react';
import { get, post, useMe, useOverview, useTown, queryClient } from '../lib/api.ts';
import { copyText } from '../lib/clipboard.ts';
import { setLang, useT } from '../lib/i18n.ts';
import { useUpdate } from '../lib/update.ts';
import { startStream, useConnected, useSnapshot } from '../lib/stream.ts';
import { CityCanvas } from './city/CityCanvas.tsx';
import { PublishDialog, openPublish } from './Publish.tsx';
import { Button } from './ui.tsx';

function useTheme(): ['dark' | 'light', () => void] {
  const sys = () => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (document.documentElement.dataset.theme as 'dark' | 'light') || sys());
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('jw.theme', theme); } catch { /* */ } }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function Clock() {
  const snap = useSnapshot(); const connected = useConnected();
  const c = snap?.clock;
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 text-xs text-fg-muted tabular" title={c ? `${c.date} · ×${c.speed}` : undefined}>
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-accent live-dot' : 'bg-fg-subtle'}`} />
      <span className="text-fg-display text-sm font-medium">{c?.clock ?? '--:--'}</span>
      {c && c.speed !== 1 && <span className="hidden sm:inline">×{c.speed}</span>}
      {c?.paused && <Pause size={12} className="text-warning" aria-label="paused" />}
    </span>
  );
}

interface GameState { tshock: { up: boolean; pending: boolean }; tml: { up: boolean; pending: boolean }; port: number }

/** 用 Terraria 走进同一座城：地址（点一下复制）与两个游戏服此刻开没开。开关在「设置 › 游戏服」 */
function JoinGame({ port }: { port: number }) {
  const { t } = useT();
  const [open, setOpen] = useState(false); const [done, setDone] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['game'], queryFn: () => get<GameState>('/game'), enabled: open, refetchInterval: open ? 3000 : false });
  useEffect(() => { if (!open) return; const f = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); }; const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); }; document.addEventListener('mousedown', f); document.addEventListener('keydown', k); return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); }; }, [open]);
  const addr = `${location.hostname}:${port}`;
  const copy = (text: string) => { void copyText(text).then((ok) => { if (!ok) return; setDone(true); setTimeout(() => setDone(false), 1600); }); };
  return (
    <div ref={box} className="relative hidden sm:block">
      <Button variant="ghost" size="sm" aria-expanded={open} aria-label={t('game')} title={t('game')} onClick={() => setOpen(!open)}><Gamepad2 size={16} /><span className="hidden tabular lg:inline">{addr}</span></Button>
      {open && (
        <div role="dialog" aria-label={t('game')} className="animate-reveal absolute right-0 top-9 z-40 w-72 rounded-lg border border-border-strong bg-bg-elevated p-4 shadow-md">
          <button type="button" onClick={() => copy(addr)} className="tabular block w-full rounded-md border border-border px-3 py-2 text-left font-mono text-sm text-fg-display transition-colors hover:border-fg-subtle">{done ? t('copied') : addr}</button>
          <ul className="mt-3 space-y-2">
            {(['tshock', 'tml'] as const).map((k) => { const g = q.data?.[k]; return (
              <li key={k} className="flex items-center gap-2 text-sm"><span className={`h-1.5 w-1.5 rounded-full ${g?.up ? 'bg-success' : g?.pending ? 'bg-accent live-dot' : 'bg-border-strong'}`} />{t(k === 'tshock' ? 'g_tshock' : 'g_tml')}</li>
            ); })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 有新版本（或正在升级）时，管理员在右上角看到它；点开是「设置 › 版本」 */
function UpdateBadge() {
  const { t } = useT();
  const { d, failed, running } = useUpdate();
  if (!d || (!d.update_available && !running && !failed)) return null;
  return (
    <Link to="/settings" search={{ tab: 'version' }} title={t('up_title')} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-fg transition-colors hover:bg-surface-hover">
      <span className="relative inline-flex"><ArrowUpCircle size={15} /><span className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${failed ? 'bg-danger' : 'bg-accent'} ${running ? 'live-dot' : ''}`} /></span>
      {d.latest && <span className="tabular hidden md:inline">{t('up_new', { v: d.latest.version })}</span>}
    </Link>
  );
}

export function Login() {
  const { t } = useT();
  const [code, setCode] = useState(''); const [err, setErr] = useState(false); const [busy, setBusy] = useState(false);
  return (
    <div className="grid min-h-dvh place-items-center bg-bg px-6">
      <form className="w-full max-w-xs" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(false); try { await post('/auth/login', { passcode: code }); await queryClient.invalidateQueries(); } catch { setErr(true); } finally { setBusy(false); } }}>
        <Wordmark className="mb-8" />
        <input autoFocus type="password" className="field" placeholder={t('passcode')} value={code} onChange={(e) => setCode(e.target.value)} aria-invalid={err} />
        {err && <p className="mt-2 text-xs text-danger">{t('bad_passcode')}</p>}
        <Button variant="primary" className="mt-4 w-full" disabled={!code || busy}>{t('enter')}</Button>
      </form>
    </div>
  );
}

function Wordmark({ className = '', version }: { className?: string; version?: string }) {
  return (
    <Link to="/" title={version ? `Jobs ${version}` : undefined} className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden><rect x="2" y="6" width="4" height="8" fill="var(--color-secondary)" /><rect x="7" y="3" width="4" height="11" fill="var(--color-secondary-fg)" /><rect x="12" y="8" width="2" height="6" fill="var(--color-secondary)" /><rect x="8" y="5" width="1" height="1" fill="var(--color-accent)" /><rect x="9" y="8" width="1" height="1" fill="var(--color-accent)" /><rect x="0" y="14" width="16" height="2" fill="var(--color-accent)" /></svg>
      <span className="text-[15px] font-semibold tracking-tight text-fg-display">Jobs</span>
    </Link>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} activeOptions={{ exact: to === '/' }} className="relative flex h-10 shrink-0 items-center px-3 text-sm text-fg-muted transition-colors hover:text-fg sm:h-full data-[status=active]:text-fg-display data-[status=active]:after:absolute data-[status=active]:after:inset-x-3 data-[status=active]:after:bottom-0 data-[status=active]:after:h-0.5 data-[status=active]:after:bg-accent">{children}</Link>;
}

/** 页脚的街道：读完一页，城里的人此刻在哪还在眼前。跟在内容后面，不盖住内容 */
function Horizon() {
  const town = useTown().data; const snap = useSnapshot(); const nav = useNavigate();
  if (!town) return <div style={{ height: 'var(--horizon-h)' }} className="border-t border-border" />;
  return (
    <div className="border-t border-border" style={{ height: 'var(--horizon-h)' }}>
      <CityCanvas mode="horizon" layout={town} personas={snap?.personas ?? []} minute={snap?.clock.minute ?? 720} className="h-full w-full"
        onSelect={(id) => void nav({ to: '/', search: { focus: id } })} onPlace={(id) => void nav({ to: '/', search: { place: id } })} />
    </div>
  );
}

export function Shell() {
  const me = useMe(); const { t, lang } = useT(); const [theme, toggle] = useTheme();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const ov = useOverview(!!me.data?.viewer).data;
  const pending = ov?.human_pending ?? 0;
  const nav = useNavigate();
  // 还没接入模型的管理员，第一次打开时直接带到「设置 › 模型」（只带一次，之后由他自己决定去哪）
  const needModels = !!me.data?.admin && me.data.models_ready === false;
  useEffect(() => { if (!needModels || path !== '/') return; try { if (sessionStorage.getItem('jw.models-nudged')) return; sessionStorage.setItem('jw.models-nudged', '1'); } catch { /* */ } void nav({ to: '/settings' }); }, [needModels, path, nav]);
  useEffect(() => { if (me.data?.viewer) startStream(); }, [me.data?.viewer]);
  useEffect(() => { const f = () => void queryClient.invalidateQueries({ queryKey: ['me'] }); window.addEventListener('jw:auth', f); return () => window.removeEventListener('jw:auth', f); }, []);
  if (me.isLoading) return <div className="min-h-dvh bg-bg" />;
  if (me.data && !me.data.viewer) return <Login />;
  const onWorld = path === '/';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface-glass backdrop-blur-[var(--blur-glass)]">
        <div className="flex w-full flex-wrap items-center gap-x-2 px-4 sm:h-[var(--ds-header-height)] sm:flex-nowrap sm:px-6 lg:px-8">
          <Wordmark className="mr-1 h-[var(--ds-header-height)] sm:mr-4" version={me.data?.version} />
          <nav className="order-last -mx-3 flex w-[calc(100%+1.5rem)] items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:order-none sm:mx-0 sm:h-full sm:w-auto sm:overflow-visible">
            <NavLink to="/">{t('nav.world')}</NavLink>
            <NavLink to="/products">{t('nav.products')}</NavLink>
            <NavLink to="/people">{t('nav.people')}</NavLink>
            {(pending > 0 || path === '/human') && <NavLink to="/human">{t('nav.human')}{pending > 0 && <span className="tabular ml-1.5 rounded-xs bg-accent px-1 text-xs text-accent-fg">{pending}</span>}</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            {ov && ov.spend_usd > 0 && <span className="tabular hidden px-1.5 text-xs text-fg-muted md:inline" title={t('spent')}>${ov.spend_usd.toFixed(2)}</span>}
            {me.data?.admin && <UpdateBadge />}
            <Clock />
            {me.data && <JoinGame port={me.data.game_port} />}
            <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label="language" className="w-8 tabular sm:w-9">{lang === 'zh' ? 'EN' : '中'}</Button>
            <Button variant="ghost" size="sm" onClick={toggle} aria-label="theme" className="w-8 sm:w-9">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</Button>
            {me.data?.auth_required && <Button variant="ghost" size="sm" aria-label={t('logout')} onClick={async () => { await post('/auth/logout'); await queryClient.invalidateQueries(); }}><LogOut size={15} /></Button>}
            {me.data?.admin && <Link to="/settings" aria-label={t('nav.settings')} title={t('nav.settings')} className="relative inline-flex h-7 w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg data-[status=active]:text-fg-display"><SettingsIcon size={15} />{needModels && <span className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-accent live-dot" />}</Link>}
            {me.data?.admin && !path.startsWith('/settings') && <Button variant="primary" size="sm" className="ml-1.5 h-8 px-3.5 text-sm" onClick={openPublish}>{t('publish')}</Button>}
          </div>
        </div>
      </header>
      <main className={onWorld ? 'flex min-h-0 flex-col' : 'w-full flex-1 px-4 pb-16 pt-8 sm:px-6 lg:px-8'}>
        <Outlet />
      </main>
      {!onWorld && <footer><Horizon /></footer>}
      <PublishDialog />
    </div>
  );
}
