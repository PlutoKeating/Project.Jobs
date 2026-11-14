import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileText, Play, Plus } from 'lucide-react';
import { post, useAppVersions, useMe, useStudies } from '../lib/api.ts';
import { useLabel, useT } from '../lib/i18n.ts';
import { Button, ErrorState, PageHead, Seg, Skeleton } from '../components/ui.tsx';

function RunStudy({ onDone }: { onDone: (id: string) => void }) {
  const { t } = useT(); const av = useAppVersions().data ?? [];
  const [v, setV] = useState(''); const [n, setN] = useState(6); const [steps, setSteps] = useState(30); const [exec, setExec] = useState<'stagehand' | 'midscene'>('stagehand'); const [locale, setLocale] = useState<'zh-CN' | 'en-US' | 'mixed'>('zh-CN'); const [temporal, setTemporal] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <form className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_repeat(2,6rem)]" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await post<{ id: string }>('/studies', { app_version_id: v, sessions: n, steps, executor: exec, locale, temporal }, { 'Idempotency-Key': `web-${v}-${Date.now()}` }); onDone(r.id); } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); } }}>
      <select className="field" value={v} onChange={(e) => setV(e.target.value)} required aria-label={t('app')}>
        <option value="" disabled>{t('app')} · {t('version')}</option>
        {av.map((a) => <option key={a.id} value={a.id}>{a.app} · {a.version}{a.spec ? '' : ' ·'}</option>)}
      </select>
      <input className="field tabular" type="number" min={1} max={40} value={n} onChange={(e) => setN(Number(e.target.value))} aria-label={t('sessions_n')} title={t('sessions_n')} />
      <input className="field tabular" type="number" min={5} max={80} value={steps} onChange={(e) => setSteps(Number(e.target.value))} aria-label={t('steps_n')} title={t('steps_n')} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3">
        <Seg size="sm" value={exec} onChange={setExec} options={[{ value: 'stagehand', label: 'Stagehand' }, { value: 'midscene', label: 'Midscene' }]} />
        <Seg size="sm" value={locale} onChange={setLocale} options={[{ value: 'zh-CN', label: '中' }, { value: 'en-US', label: 'EN' }, { value: 'mixed', label: '中/EN' }]} />
        <label className="inline-flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={temporal} onChange={(e) => setTemporal(e.target.checked)} className="accent-[var(--color-accent)]" />Temporal</label>
        <Button variant="primary" className="ml-auto" disabled={!v || busy}><Play size={14} />{t('start')}</Button>
      </div>
      {err && <p className="text-sm text-danger sm:col-span-3">{err}</p>}
    </form>
  );
}

function NewProject({ onDone }: { onDone: (id: string) => void }) {
  const { t } = useT();
  const [f, setF] = useState({ name: '', url: '', version: 'v1', form: 'web', prd: '', user: '', password: '', sessions: 6, steps: 30 });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: typeof f[k] === 'number' ? Number(e.target.value) : e.target.value });
  return (
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setErr(null); try { const r = await post<{ study_id: string }>('/projects', f); onDone(r.study_id); } catch (x) { setErr(String((x as Error).message)); } finally { setBusy(false); } }}>
      <input className="field" required placeholder="my-app" value={f.name} onChange={set('name')} aria-label="name" />
      <input className="field" required type="url" placeholder="http://127.0.0.1:3000/" value={f.url} onChange={set('url')} aria-label="url" />
      <textarea className="field min-h-24 sm:col-span-2" placeholder="PRD" value={f.prd} onChange={set('prd')} />
      <input className="field" placeholder="user" value={f.user} onChange={set('user')} autoComplete="off" />
      <input className="field" placeholder="password" value={f.password} onChange={set('password')} autoComplete="off" />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Seg size="sm" value={f.form} onChange={(v) => setF({ ...f, form: v })} options={[{ value: 'web', label: 'Web' }, { value: 'h5', label: 'H5' }]} />
        <input className="field h-8 w-20 tabular" value={f.version} onChange={set('version')} aria-label={t('version')} />
        <input className="field h-8 w-16 tabular" type="number" value={f.sessions} onChange={set('sessions')} aria-label={t('sessions_n')} title={t('sessions_n')} />
        <input className="field h-8 w-16 tabular" type="number" value={f.steps} onChange={set('steps')} aria-label={t('steps_n')} title={t('steps_n')} />
        <Button variant="primary" className="ml-auto" disabled={busy}><Play size={14} />{t('start')}</Button>
      </div>
      {err && <p className="text-sm text-danger sm:col-span-2">{err}</p>}
    </form>
  );
}

export function StudiesPage() {
  const { t } = useT(); const L = useLabel(); const q = useStudies(); const me = useMe().data; const nav = useNavigate();
  const [panel, setPanel] = useState<'none' | 'run' | 'new'>('none');
  const done = (id: string) => { setPanel('none'); void nav({ to: '/studies/$id', params: { id } }); };
  return (
    <>
      <PageHead title={t('nav.studies')} aside={me?.admin && <>
        <Button variant={panel === 'run' ? 'primary' : 'quiet'} onClick={() => setPanel(panel === 'run' ? 'none' : 'run')}><Play size={14} />{t('run_study')}</Button>
        <Button variant={panel === 'new' ? 'primary' : 'quiet'} onClick={() => setPanel(panel === 'new' ? 'none' : 'new')}><Plus size={14} />{t('new_project')}</Button>
      </>} />
      {panel !== 'none' && <div className="mb-8 animate-reveal rounded-xl border border-border bg-surface p-5">{panel === 'run' ? <RunStudy onDone={done} /> : <NewProject onDone={done} />}</div>}
      {q.isError ? <ErrorState onRetry={() => void q.refetch()} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-xs text-fg-subtle"><th className="pb-3 font-normal">{t('app')}</th><th className="pb-3 font-normal">{t('status')}</th><th className="pb-3 text-right font-normal">{t('sessions')}</th><th className="pb-3 text-right font-normal">Tokens</th><th className="pb-3 text-right font-normal">{t('cost')}</th><th className="pb-3 pl-6 font-normal" /><th className="pb-3 text-right font-normal" /></tr></thead>
            <tbody className="divide-y divide-border border-t border-border">
              {q.isLoading && Array.from({ length: 6 }, (_, i) => <tr key={i}><td colSpan={7} className="py-3"><Skeleton className="h-6 w-full" /></td></tr>)}
              {q.data?.map((s) => (
                <tr key={s.id} className="group hover:bg-surface">
                  <td className="py-3 pr-4"><Link to="/studies/$id" params={{ id: s.id }} className="block"><span className="font-medium text-fg-display group-hover:text-accent">{s.app}</span> <span className="text-fg-subtle">{s.version}</span><span className="tabular block text-xs text-fg-subtle">{new Date(s.created_at).toLocaleString()}</span></Link></td>
                  <td className="py-3"><span className={`inline-flex items-center gap-1.5 text-xs ${s.status === 'running' || s.status === 'evaluating' ? 'text-accent' : s.status === 'failed' ? 'text-danger' : 'text-fg-muted'}`}>{(s.status === 'running' || s.job) && <span className="h-1.5 w-1.5 rounded-full bg-accent live-dot" />}{L(s.status)}</span></td>
                  <td className="tabular py-3 text-right">{s.sessions}</td>
                  <td className="tabular py-3 text-right text-fg-muted">{s.tokens.toLocaleString()}</td>
                  <td className="tabular py-3 text-right text-fg-muted">${s.cost_usd.toFixed(2)}</td>
                  <td className="max-w-[16rem] truncate py-3 pl-6 text-xs text-fg-subtle">{s.stop_reason ?? ''}</td>
                  <td className="py-3 text-right">{s.report && <a href={`/reports/${s.id}/index.html`} target="_blank" rel="noreferrer" className="inline-flex text-fg-subtle hover:text-accent" aria-label={t('report_html')}><FileText size={15} /></a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
