import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import { Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { RiskLevel, Substance, WorkType } from '../api/types.ts';
import Bulb, { type BulbState } from '../components/Bulb.tsx';
import { WORK_CATEGORIES, WORK_TYPE_LABEL, categoryShares, workTypeColor } from '../workTypes.ts';
import { timeAgo } from '../dates.ts';

/* ── Buttons ───────────────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE = 'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-label transition-[background-color,color,opacity] duration-[120ms] ease-out disabled:opacity-50';
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 coarse:h-11',
  md: 'h-9 px-3.5 coarse:h-11',
  lg: 'h-11 px-4 text-[14px]',
};
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-fg font-semibold text-canvas [&:hover:not(:disabled)]:opacity-90',
  secondary: 'border border-line-strong bg-surface-2 text-fg [&:hover:not(:disabled)]:bg-surface-3',
  ghost: 'text-fg-muted [&:hover:not(:disabled)]:bg-surface-2 [&:hover:not(:disabled)]:text-fg',
  danger: 'bg-risk-high-wash text-risk-high [&:hover:not(:disabled)]:opacity-90',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra = ''): string {
  return `${BASE} ${SIZE[size]} ${VARIANT[variant]} ${extra}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant; size?: ButtonSize; busy?: boolean;
}>(function Button({ variant = 'secondary', size = 'md', busy, className = '', children, disabled, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
});

export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className={`grid size-9 shrink-0 place-items-center rounded-md text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg coarse:size-11 ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <kbd className={`inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line bg-surface-2 px-1 font-mono text-[11px] text-fg-muted ${className}`}>{children}</kbd>;
}

/* ── Text and form ─────────────────────────────────────────────────────── */

export const inputClass = 'h-9 w-full rounded-md border border-line-strong bg-surface-2 px-3 text-body text-fg placeholder:text-fg-subtle focus:border-fg/40 focus:outline-none focus:ring-2 focus:ring-fg/15 aria-[invalid=true]:border-risk-high coarse:h-11';
export const textareaClass = 'w-full resize-y rounded-md border border-line-strong bg-surface-2 px-3 py-2 text-body text-fg placeholder:text-fg-subtle focus:border-fg/40 focus:outline-none focus:ring-2 focus:ring-fg/15';
export const srOnly = 'sr-only';

export function Field({ label, help, error, htmlFor, children }: {
  label: ReactNode; help?: ReactNode; error?: string | null; htmlFor?: string; children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-label text-fg">{label}</label>
      {children}
      {error ? <p className="text-caption font-normal text-risk-high" role="alert">{error}</p>
        : help ? <p className="text-caption font-normal text-fg-muted">{help}</p> : null}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-md bg-surface-2 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className="h-7 rounded-[5px] px-3 text-label text-fg-muted transition-colors hover:text-fg aria-pressed:bg-surface-1 aria-pressed:text-fg aria-pressed:shadow-[0_1px_2px_rgba(0,0,0,0.2)] coarse:h-9"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Badges ────────────────────────────────────────────────────────────── */

const TONE = {
  neutral: 'bg-surface-3 text-fg-muted',
  high: 'bg-risk-high-wash text-risk-high',
  med: 'bg-risk-med-wash text-risk-med',
  low: 'bg-surface-3 text-risk-low',
  ok: 'bg-ok-wash text-ok',
  maestro: 'bg-maestro-wash text-maestro-ink',
} as const;

export function Badge({ tone = 'neutral', children, className = '' }: { tone?: keyof typeof TONE; children: ReactNode; className?: string }) {
  return <span className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-caption ${TONE[tone]} ${className}`}>{children}</span>;
}

const RISK_META: Record<RiskLevel, { label: string; tone: 'high' | 'med' | 'low'; Icon: typeof Info; color: string }> = {
  high: { label: 'High', tone: 'high', Icon: OctagonAlert, color: 'var(--risk-high)' },
  medium: { label: 'Medium', tone: 'med', Icon: TriangleAlert, color: 'var(--risk-med)' },
  low: { label: 'Low', tone: 'low', Icon: Info, color: 'var(--risk-low)' },
};

export function riskColor(level: RiskLevel): string { return RISK_META[level].color; }

/** Risk level always shows an icon and a word, never colour alone. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  const m = RISK_META[level];
  return <Badge tone={m.tone}><m.Icon size={12} aria-hidden="true" />{m.label}</Badge>;
}

export function WorkTypeTag({ type }: { type: WorkType | null }) {
  if (!type) return <Badge>Not labeled</Badge>;
  return (
    <span className="inline-flex h-5 items-center rounded-[4px] bg-surface-2 px-1.5 text-caption font-normal text-fg" style={{ boxShadow: `inset 2px 0 0 ${workTypeColor(type)}` }}>
      {WORK_TYPE_LABEL[type]}
    </span>
  );
}

export function SubstanceDots({ value }: { value: Substance | null }) {
  if (!value) return null;
  const n = value === 'low' ? 1 : value === 'medium' ? 2 : 3;
  return (
    <span role="img" aria-label={`${value} substance`} title={`${value[0].toUpperCase()}${value.slice(1)} substance`} className="inline-flex gap-0.5">
      {[0, 1, 2].map(i => <span key={i} className={`size-1.5 rounded-full ${i < n ? 'bg-fg-muted' : 'border border-line-strong'}`} />)}
    </span>
  );
}

/* ── People ────────────────────────────────────────────────────────────── */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 1)).toUpperCase();
}

export function Avatar({ name, login, size = 24 }: { name: string; login?: string | null; size?: 20 | 24 | 32 | 48 }) {
  const text = size >= 32 ? initials(name) : initials(name).slice(0, 1);
  const font = size === 48 ? 'text-[18px]' : size === 32 ? 'text-[13px]' : size === 24 ? 'text-[11px]' : 'text-[10px]';
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-surface-3 font-semibold text-fg ring-1 ring-line-strong ring-inset ${font}`} style={{ width: size, height: size }} aria-hidden="true">
      {text}
      {login && !login.includes('[bot]') && (
        <img src={`https://github.com/${encodeURIComponent(login)}.png?size=${size * 2}`} alt="" className="absolute inset-0 size-full object-cover" loading="lazy"
          onError={e => { e.currentTarget.style.display = 'none'; }} />
      )}
    </span>
  );
}

/* ── Surfaces ──────────────────────────────────────────────────────────── */

export function Card({ title, action, children, className = '', bodyClassName = 'px-5 pb-5', as: Tag = 'section' }: {
  title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; as?: 'section' | 'div';
}) {
  return (
    <Tag className={`min-w-0 rounded-[10px] border border-line bg-surface-1 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          {title && <h2 className="text-title-3">{title}</h2>}
          {action}
        </div>
      )}
      <div className={title || action ? bodyClassName : `${bodyClassName} pt-5`}>{children}</div>
    </Tag>
  );
}

/** Anything Maestro wrote. The one surface amber fills, so people learn amber = AI. */
export function MaestroNote({ children, at, why, className = '', compact }: {
  children: ReactNode; at?: string | null; why?: ReactNode; className?: string; compact?: boolean;
}) {
  return (
    <section className={`flex flex-col gap-3 rounded-[10px] border border-maestro-line bg-maestro-wash ${compact ? 'p-4' : 'p-5'} ${className}`}>
      <div className="flex items-center gap-2 text-caption">
        <Bulb height={18} />
        <span className="font-semibold text-maestro-ink">Maestro</span>
        {at && <span className="font-normal text-fg-muted">· {timeAgo(at)}</span>}
        {why && <span className="ml-auto">{why}</span>}
      </div>
      <div className={compact ? 'text-body' : 'text-brief'}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, badge }: {
  title: string; subtitle?: ReactNode; actions?: ReactNode; badge?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-title-2">{title}</h1>
          {badge}
        </div>
        {subtitle && <p className="text-fg-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2" data-no-print>{actions}</div>}
    </header>
  );
}

export function Page({ children, width = 'max-w-[1120px]' }: { children: ReactNode; width?: string }) {
  return <div className={`mx-auto flex w-full ${width} flex-col gap-6 px-5 pt-6 pb-24 md:px-8 md:pt-8 md:pb-16`}>{children}</div>;
}

/* ── Contribution bars ─────────────────────────────────────────────────── */

/** One member's work mix. `length` is 0–1 of the shared scale, so uneven loads stay visible. */
export function ContributionBar({ shares, length, label, height = 10 }: {
  shares: Partial<Record<WorkType, number>>; length: number; label: string; height?: number;
}) {
  const segs = categoryShares(shares).filter(s => s.share > 0);
  return (
    <span className="flex w-full min-w-0 overflow-hidden rounded-full bg-surface-2" style={{ height }} role="img" aria-label={label}>
      <span className="flex gap-px" style={{ width: `${Math.max(length * 100, segs.length ? 2 : 0)}%` }}>
        {segs.map(s => <span key={s.key} className="min-w-0.5" style={{ flexGrow: s.share, background: s.color }} />)}
      </span>
    </span>
  );
}

export function WorkLegend({ className = '' }: { className?: string }) {
  return (
    <ul className={`flex list-none flex-wrap gap-x-4 gap-y-1.5 text-caption font-normal text-fg-muted ${className}`} aria-label="Kinds of work">
      {WORK_CATEGORIES.map(c => (
        <li key={c.key} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px]" style={{ background: c.color }} aria-hidden="true" />{c.label}</li>
      ))}
    </ul>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

export function EmptyState({ bulb = 'default', heading, line, children }: {
  bulb?: BulbState | 'none'; heading: string; line?: ReactNode; children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-4 py-14 text-center">
      {bulb !== 'none' && <Bulb state={bulb} height={88} />}
      <h2 className="text-title-3">{heading}</h2>
      {line && <p className="text-fg-muted">{line}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ w, h = 12, className = '' }: { w: number | string; h?: number; className?: string }) {
  return <span className={`block animate-pulse rounded-[6px] bg-surface-2 motion-reduce:animate-none ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}

export function Banner({ tone = 'high', children, action }: { tone?: 'high' | 'med' | 'maestro'; children: ReactNode; action?: ReactNode }) {
  const t = tone === 'high' ? 'border-risk-high/30 bg-risk-high-wash' : tone === 'med' ? 'border-risk-med/30 bg-risk-med-wash' : 'border-maestro-line bg-maestro-wash';
  const Icon = tone === 'high' ? OctagonAlert : TriangleAlert;
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-md border px-4 py-3 ${t}`} role="alert">
      {tone !== 'maestro' && <Icon size={16} className={tone === 'high' ? 'text-risk-high' : 'text-risk-med'} aria-hidden="true" />}
      <p className="min-w-0 flex-1">{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <Banner action={onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}>{message}</Banner>;
}
