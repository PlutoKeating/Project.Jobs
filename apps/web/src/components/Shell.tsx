import { useEffect, useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Gamepad2, LogOut, Moon, Pause, Sun } from 'lucide-react';
import { post, useMe, useTown, queryClient } from '../lib/api.ts';
import { setLang, useT } from '../lib/i18n.ts';
import { startStream, useConnected, useSnapshot } from '../lib/stream.ts';
import { CityCanvas } from './city/CityCanvas.tsx';
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
      {c && c.speed !== 1 && <span>×{c.speed}</span>}
      {c?.paused && <Pause size={12} className="text-warning" aria-label="paused" />}
    </span>
  );
}

function JoinGame({ port }: { port: number }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  const addr = `${location.hostname}:${port}`;
  return (
    <Button variant="ghost" size="sm" title={`${t('game')} · ${addr}`} aria-label={t('game')}
      onClick={() => { void navigator.clipboard?.writeText(addr); setDone(true); setTimeout(() => setDone(false), 1600); }}>
      <Gamepad2 size={16} /><span className="hidden tabular lg:inline">{done ? t('copied') : addr}</span>
    </Button>
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

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden><rect x="2" y="6" width="4" height="8" fill="var(--color-secondary)" /><rect x="7" y="3" width="4" height="11" fill="var(--color-secondary-fg)" /><rect x="12" y="8" width="2" height="6" fill="var(--color-secondary)" /><rect x="8" y="5" width="1" height="1" fill="var(--color-accent)" /><rect x="9" y="8" width="1" height="1" fill="var(--color-accent)" /><rect x="0" y="14" width="16" height="2" fill="var(--color-accent)" /></svg>
      <span className="text-[15px] font-semibold tracking-tight text-fg-display">JobsWorld</span>
    </Link>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  return <Link to={to} activeOptions={{ exact: to === '/' }} className="relative rounded-md px-3 py-1.5 text-sm text-fg-muted transition-colors hover:text-fg data-[status=active]:text-fg-display data-[status=active]:after:absolute data-[status=active]:after:inset-x-3 data-[status=active]:after:-bottom-[9px] sm:data-[status=active]:after:-bottom-[13px] data-[status=active]:after:h-0.5 data-[status=active]:after:bg-accent">{children}</Link>;
}

/** 底部常驻街道：每一页都能看到城里的人此刻在哪 */
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
  useEffect(() => { if (me.data?.viewer) startStream(); }, [me.data?.viewer]);
  useEffect(() => { const f = () => void queryClient.invalidateQueries({ queryKey: ['me'] }); window.addEventListener('jw:auth', f); return () => window.removeEventListener('jw:auth', f); }, []);
  if (me.isLoading) return <div className="min-h-dvh bg-bg" />;
  if (me.data && !me.data.viewer) return <Login />;
  const onWorld = path === '/';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-surface-glass backdrop-blur-[var(--blur-glass)]">
        <div className="mx-auto flex max-w-[var(--container-wide)] flex-wrap items-center gap-x-2 px-4 sm:h-[var(--ds-header-height)] sm:flex-nowrap sm:px-6">
          <Wordmark className="mr-4 h-[var(--ds-header-height)]" />
          <nav className="order-last -mx-1 flex w-full items-center gap-0.5 overflow-x-auto pb-2 sm:order-none sm:mx-0 sm:w-auto sm:pb-0">
            <NavLink to="/">{t('nav.world')}</NavLink>
            <NavLink to="/people">{t('nav.people')}</NavLink>
            <NavLink to="/apps">{t('nav.apps')}</NavLink>
            <NavLink to="/studies">{t('nav.studies')}</NavLink>
            <NavLink to="/human">{t('nav.human')}</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Clock />
            {me.data && <JoinGame port={me.data.game_port} />}
            <Button variant="ghost" size="sm" onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} aria-label="language" className="w-9 tabular">{lang === 'zh' ? 'EN' : '中'}</Button>
            <Button variant="ghost" size="sm" onClick={toggle} aria-label="theme" className="w-9">{theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}</Button>
            {me.data?.auth_required && <Button variant="ghost" size="sm" aria-label={t('logout')} onClick={async () => { await post('/auth/logout'); await queryClient.invalidateQueries(); }}><LogOut size={15} /></Button>}
          </div>
        </div>
      </header>
      <main className={onWorld ? 'flex min-h-0 flex-col' : 'mx-auto w-full max-w-[var(--container-wide)] flex-1 px-4 pb-16 pt-8 sm:px-6'}>
        <Outlet />
      </main>
      {!onWorld && <div className="sticky bottom-0 z-20 bg-bg"><Horizon /></div>}
    </div>
  );
}
