import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { avatarUrl } from '../lib/api.ts';
import { useT } from '../lib/i18n.ts';

export function Button({ variant = 'quiet', size = 'md', className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' | 'ghost' | 'danger'; size?: 'sm' | 'md' }) {
  const v = {
    primary: 'bg-fg-display text-bg hover:opacity-90',
    quiet: 'border border-border-strong text-fg hover:bg-surface-hover hover:border-fg-subtle',
    ghost: 'text-fg-muted hover:text-fg hover:bg-surface-hover',
    danger: 'border border-border-strong text-danger hover:bg-surface-hover',
  }[variant];
  const s = size === 'sm' ? 'h-7 px-2.5 text-xs gap-1.5' : 'h-9 px-3.5 text-sm gap-2';
  return <button {...p} className={`inline-flex shrink-0 items-center justify-center rounded-md font-medium transition-colors duration-150 ${v} ${s} ${className}`} />;
}

export function Seg<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  return (
    <div role="radiogroup" className="inline-flex rounded-md border border-border bg-bg-elevated p-0.5">
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} title={o.title} onClick={() => onChange(o.value)}
          className={`rounded-[5px] ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'} transition-colors ${value === o.value ? 'bg-surface-hover text-fg-display shadow-sm' : 'text-fg-muted hover:text-fg'}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function Avatar({ id, size = 40, ring = false, className = '' }: { id: string; size?: number; ring?: boolean; className?: string }) {
  const [ok, setOk] = useState(true);
  return (
    <span className={`relative inline-block shrink-0 overflow-hidden rounded-md bg-surface-hover ${ring ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : ''} ${className}`} style={{ width: size, height: size }}>
      {ok && <img src={avatarUrl(id)} alt="" width={size} height={size} loading="lazy" onError={() => setOk(false)} className="pixel h-full w-full object-cover" />}
    </span>
  );
}

/** 0–1 的横向量条（数值本身也显示） */
export function Meter({ value, max = 1, tone = 'secondary', label, fmt }: { value: number | null | undefined; max?: number; tone?: 'secondary' | 'accent' | 'danger' | 'success'; label?: ReactNode; fmt?: (v: number) => string }) {
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(1, value / max));
  const bar = { secondary: 'bg-secondary', accent: 'bg-accent', danger: 'bg-danger', success: 'bg-success' }[tone];
  return (
    <div className="flex items-center gap-3">
      {label && <span className="w-24 shrink-0 text-xs text-fg-muted">{label}</span>}
      <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border"><span className={`absolute inset-y-0 left-0 rounded-full ${bar}`} style={{ width: `${pct * 100}%` }} /></span>
      <span className="tabular w-10 shrink-0 text-right text-xs text-fg">{value === null || value === undefined ? '—' : fmt ? fmt(value) : value.toFixed(2)}</span>
    </div>
  );
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
export const num = (v: number | null | undefined, d = 0) => (v === null || v === undefined ? '—' : v.toFixed(d));

export function Sev({ s }: { s: string }) {
  const c = { P0: 'bg-danger text-bg', P1: 'bg-danger/60 text-fg-display', P2: 'bg-warning/80 text-bg', P3: 'bg-border-strong text-fg' }[s] ?? 'bg-border text-fg';
  return <span className={`inline-flex h-5 w-7 items-center justify-center rounded-xs text-xs font-semibold tabular ${c}`}>{s}</span>;
}

export function Skeleton({ className = '' }: { className?: string }) { return <div className={`animate-pulse rounded-md bg-surface-hover ${className}`} />; }

export function Empty({ icon, title, action }: { icon?: ReactNode; title: ReactNode; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-fg-muted">{icon && <span className="text-fg-subtle">{icon}</span>}<p className="text-sm">{title}</p>{action}</div>;
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useT();
  return <Empty title={t('error')} action={onRetry && <Button size="sm" onClick={onRetry}>{t('retry')}</Button>} />;
}

export function PageHead({ title, aside, children }: { title: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0"><h1 className="text-2xl font-semibold">{title}</h1>{children}</div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  );
}

export function Section({ title, aside, children, className = '' }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`mt-10 ${className}`}>
      <div className="mb-3 flex items-baseline justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export function PersonLink({ id, name, size = 24 }: { id: string; name: string; size?: number }) {
  return <Link to="/people/$id" params={{ id }} className="inline-flex min-w-0 items-center gap-2 hover:text-accent"><Avatar id={id} size={size} /><span className="truncate">{name}</span></Link>;
}

export function Stat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return <div className="min-w-0"><div className="text-xs text-fg-muted">{label}</div><div className="tabular mt-0.5 text-xl font-semibold text-fg-display">{value}{sub && <span className="ml-1 text-xs font-normal text-fg-subtle">{sub}</span>}</div></div>;
}
