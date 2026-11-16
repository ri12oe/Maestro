import { useEffect, type ReactNode } from 'react';
import type { RiskLevel } from '../api/types.ts';
import Bulb, { type BulbState } from './Bulb.tsx';
import { WORK_CATEGORIES } from '../workTypes.ts';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary';
const ease = 'ease-[cubic-bezier(0.25,0.1,0.25,1)]';
const btnClass = `inline-flex min-h-[52px] items-center justify-center gap-2 whitespace-nowrap rounded-control border px-6 text-label transition-[background-color,border-color] duration-[120ms] ${ease} ${focusRing} disabled:cursor-not-allowed disabled:opacity-[0.55]`;

export const primaryBtnClass = `${btnClass} border-transparent bg-primary text-primary-content [&:hover:not(:disabled)]:bg-[rgb(234,178,78)]`;
export const secondaryBtnClass = `${btnClass} border-neutral bg-base-300 text-base-content [&:hover:not(:disabled)]:bg-[rgb(38,38,42)]`;
export const textBtnClass = `inline-flex items-center gap-1.5 rounded-[8px] p-2 text-label text-muted ${focusRing} [&:hover]:text-base-content`;
export const linkClass = 'inline-flex items-center gap-1.5 text-label text-base-content no-underline [&:hover]:underline [&:hover]:underline-offset-[3px]';
export const fieldClass = 'flex flex-col gap-2 [&>label]:text-label [&>label]:text-base-content';
export const fieldLabelClass = 'text-label text-base-content';
export const fieldHelpClass = 'text-muted';
export const fieldRowClass = 'flex gap-2 [&>:first-child]:min-w-0 [&>:first-child]:flex-1';
export const srOnlyClass = 'absolute h-px w-px overflow-hidden whitespace-nowrap [clip:rect(0_0_0_0)]';

const controlText = 'w-full rounded-control border border-neutral bg-base-200 text-[18px] leading-7 tracking-[-0.005em] text-base-content placeholder:text-placeholder focus:border-primary focus:outline-none disabled:text-muted';
export const inputClass = `${controlText} min-h-[52px] px-4 read-only:text-muted`;
export const textareaClass = `${controlText} min-h-[120px] resize-y px-4 py-3 read-only:text-muted`;
export const selectClass = `${controlText} min-h-[52px] appearance-none bg-no-repeat px-4 pr-11! [background-position:right_18px_center] [background-image:var(--maestro-chevron)]`;
export const chipsClass = 'flex flex-wrap gap-2';
export const toastClass = 'fixed bottom-8 left-1/2 z-50 max-w-[calc(100vw-40px)] -translate-x-1/2 rounded-control border border-neutral bg-base-300 px-4 py-3 text-base-content md:ml-[120px] motion-safe:animate-toast-in';

/* ── Icons (20px stroke set from the Figma file) ───────────────────────── */

type IconProps = { size?: number; className?: string };
const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const ArrowRight = ({ size = 18, className }: IconProps) => (
  <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" {...stroke} /></svg>
);
export const ArrowLeft = ({ size = 18, className }: IconProps) => (
  <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M16 10H4M9 5l-5 5 5 5" {...stroke} /></svg>
);
export const Close = ({ size = 18, className }: IconProps) => (
  <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" {...stroke} /></svg>
);
export const Check = ({ size = 18, className }: IconProps) => (
  <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10.5l4.5 4.5L16.5 5" {...stroke} strokeWidth={2} /></svg>
);
export const IssueIcon = ({ size = 20, className }: IconProps) => (
  <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <circle cx="10" cy="10" r="7.25" {...stroke} /><circle cx="10" cy="10" r="2" fill="currentColor" />
  </svg>
);
export const ListIcon = ({ size = 20, className }: IconProps) => (
  <svg className={className} width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
    <path d="M8 5.5h9M8 10h9M8 14.5h9" {...stroke} />
    <circle cx="4.25" cy="5.5" r="1.25" fill="currentColor" /><circle cx="4.25" cy="10" r="1.25" fill="currentColor" /><circle cx="4.25" cy="14.5" r="1.25" fill="currentColor" />
  </svg>
);

/* ── Layout pieces ─────────────────────────────────────────────────────── */

export const cardClass = 'flex min-w-0 flex-col gap-4 rounded-card border border-neutral bg-base-200 p-5 md:p-6';
export const statCardClass = 'flex flex-col gap-1 rounded-card border border-neutral bg-base-200 p-5';

export function Card({ title, subtitle, children, className = '', aside }: {
  title?: string; subtitle?: string; children?: ReactNode; className?: string; aside?: ReactNode;
}) {
  return (
    <section className={`${cardClass} ${className}`}>
      {(title || subtitle) && (
        <div className="flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-card">{title}</h2>}
            {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, sublabel, tone = 'default' }: {
  label: string; value: ReactNode; sublabel?: string; tone?: 'default' | 'risk';
}) {
  return (
    <div className={statCardClass}>
      <span className="text-muted">{label}</span>
      <span className={`text-stat ${tone === 'risk' ? 'text-error' : ''}`}>{value}</span>
      {sublabel && <span className="text-muted">{sublabel}</span>}
    </div>
  );
}

const LEVEL_LABEL: Record<RiskLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' };
const RISK_BADGE: Record<RiskLevel, string> = {
  high: 'bg-risk-high-bg text-error',
  medium: 'bg-risk-medium-bg text-primary',
  low: 'bg-base-300 text-muted',
};

/** Risk level pill — always shows the level as text, never colour alone. */
export function RiskBadge({ level, className = '' }: { level: RiskLevel; className?: string }) {
  return <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-1 text-badge ${RISK_BADGE[level]} ${className}`}>{LEVEL_LABEL[level]}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="inline-flex whitespace-nowrap rounded-full bg-base-300 px-2 py-1 text-badge text-muted">{children}</span>;
}

export function Legend() {
  return (
    <ul className="flex list-none flex-wrap gap-x-4 gap-y-2 text-muted" aria-label="Work types">
      {WORK_CATEGORIES.map(c => (
        <li key={c.key} className="inline-flex items-center gap-2"><span className="size-2 rounded-full" style={{ background: c.color }} aria-hidden="true" />{c.label}</li>
      ))}
    </ul>
  );
}

/** Stacked bar of work-type segments. `length` is 0–1 of the track (relative to the busiest member). */
export function StackedBar({ segments, length, label, className = '' }: {
  segments: Array<{ key: string; color: string; share: number }>; length: number; label: string; className?: string;
}) {
  const visible = segments.filter(s => s.share > 0);
  return (
    <span className={`block min-w-0 flex-1 ${className}`}>
      <span className="flex h-3 gap-0.5 overflow-hidden rounded-[6px]" style={{ width: `${Math.max(length * 100, visible.length ? 2 : 0)}%` }} role="img" aria-label={label}>
        {visible.map(s => <span key={s.key} className="min-w-0.5" style={{ flexGrow: s.share, background: s.color }} />)}
      </span>
    </span>
  );
}

export function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const text = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
  return <span className="initials grid size-9 shrink-0 place-items-center rounded-full border border-neutral bg-base-300 text-[15px] leading-[22px] font-normal text-muted" aria-hidden="true">{text}</span>;
}

export function PersonRow({ name, username, onRemove, removing }: {
  name: string; username?: string | null; onRemove?: () => void; removing?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 rounded-control border border-neutral bg-base-200 py-2 pr-1 pl-3">
      <Initials name={name} />
      <span className={`text-label ${username ? '' : 'min-w-0 flex-1'}`}>{name}</span>
      {username && <span className="min-w-0 flex-1 overflow-hidden text-ellipsis text-muted">@{username}</span>}
      {onRemove && (
        <button
          type="button"
          className="ml-auto grid size-11 shrink-0 place-items-center rounded-[8px] text-muted focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary [&:hover]:bg-base-300 [&:hover]:text-base-content"
          onClick={onRemove}
          disabled={removing}
          aria-label={`Remove ${name}`}
        >
          <Close />
        </button>
      )}
    </li>
  );
}

/** Toggle chip. `filter` chips stay neutral when selected; choice chips mark the selection in accent. */
export function Chip({ selected, onClick, children, dot, filter }: {
  selected?: boolean; onClick?: () => void; children: ReactNode; dot?: string; filter?: boolean;
}) {
  const tone = selected
    ? `bg-base-300 text-base-content ${filter ? 'border-neutral' : 'border-primary'}`
    : 'border-neutral bg-base-200 text-muted [&:hover]:text-base-content';
  return (
    <button type="button" className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-label ${focusRing} ${tone}`} aria-pressed={selected} onClick={onClick}>
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      {children}
    </button>
  );
}

/** Single-choice card: a styled radio with optional icon tile and description. */
export function OptionCard({ name, value, checked, onChange, title, description, icon }: {
  name: string; value: string; checked: boolean; onChange: (value: string) => void;
  title: string; description?: string; icon?: ReactNode;
}) {
  return (
    <label className={`flex cursor-pointer items-center gap-4 rounded-card border bg-base-200 px-5 py-4 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-solid has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-primary ${checked ? 'border-primary!' : 'border-neutral [&:hover]:border-[rgb(75,75,80)]'}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className={srOnlyClass} />
      {icon && (
        <span className={`grid size-10 shrink-0 place-items-center rounded-control border border-neutral ${checked ? 'bg-accent-subtle text-primary' : 'bg-base-300 text-muted'}`} aria-hidden="true">{icon}</span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-label">{title}</span>
        {description && <span className="text-muted">{description}</span>}
      </span>
      <span className={`grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px] border-solid after:size-2.5 after:rounded-full after:bg-primary after:transition-transform after:duration-[120ms] after:ease-[cubic-bezier(0.25,0.1,0.25,1)] after:content-[''] ${checked ? 'border-primary after:[transform:scale(1)]' : 'border-placeholder after:[transform:scale(0)]'}`} aria-hidden="true" />
    </label>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

export function EmptyState({ bulb = 'default', heading, line, children }: {
  bulb?: BulbState; heading: string; line?: string; children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      <Bulb state={bulb} height={72} />
      <h2 className="text-card">{heading}</h2>
      {line && <p className="max-w-[400px] text-muted">{line}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ w, h = 12, className = '' }: { w: number | string; h?: number; className?: string }) {
  return <span className={`block rounded-[6px] bg-base-300 ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}

export function Banner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 rounded-control border border-[rgba(229,72,77,0.4)] bg-risk-high-bg p-4 text-label text-error max-md:flex-col max-md:items-start" role="alert">
      <p className="flex-1">{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner action={onRetry && <button type="button" className={secondaryBtnClass} onClick={onRetry}>Try again</button>}>
      {message}
    </Banner>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex w-full flex-col gap-3" role="status">
      <span className={srOnlyClass}>{label}</span>
      <Skeleton w="40%" h={16} /><Skeleton w="80%" /><Skeleton w="65%" />
    </div>
  );
}

/** Bottom toast; disappears after `timeout` ms. */
export function Toast({ message, onClose, timeout = 5000 }: { message: string; onClose: () => void; timeout?: number }) {
  useEffect(() => {
    const t = window.setTimeout(onClose, timeout);
    return () => window.clearTimeout(t);
  }, [message, onClose, timeout]);
  return <div className={toastClass} role="status">{message}</div>;
}
