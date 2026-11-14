import { useEffect, type ReactNode } from 'react';
import type { RiskLevel } from '../api/types.ts';
import Bulb, { type BulbState } from './Bulb.tsx';
import { WORK_CATEGORIES } from '../workTypes.ts';
import './ui.scss';

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

export function Card({ title, subtitle, children, className = '', aside }: {
  title?: string; subtitle?: string; children?: ReactNode; className?: string; aside?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || subtitle) && (
        <div className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
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
    <div className="stat-card">
      <span className="stat-card__label">{label}</span>
      <span className={`stat-card__value stat-card__value--${tone}`}>{value}</span>
      {sublabel && <span className="stat-card__sub">{sublabel}</span>}
    </div>
  );
}

const LEVEL_LABEL: Record<RiskLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' };

/** Risk level pill — always shows the level as text, never colour alone. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`risk-badge risk-badge--${level}`}>{LEVEL_LABEL[level]}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="tag">{children}</span>;
}

export function Legend() {
  return (
    <ul className="legend" aria-label="Work types">
      {WORK_CATEGORIES.map(c => (
        <li key={c.key}><span className="legend__dot" style={{ background: c.color }} aria-hidden="true" />{c.label}</li>
      ))}
    </ul>
  );
}

/** Stacked bar of work-type segments. `length` is 0–1 of the track (relative to the busiest member). */
export function StackedBar({ segments, length, label }: {
  segments: Array<{ key: string; color: string; share: number }>; length: number; label: string;
}) {
  const visible = segments.filter(s => s.share > 0);
  return (
    <span className="stacked">
      <span className="stacked__bar" style={{ width: `${Math.max(length * 100, visible.length ? 2 : 0)}%` }} role="img" aria-label={label}>
        {visible.map(s => <span key={s.key} style={{ flexGrow: s.share, background: s.color }} />)}
      </span>
    </span>
  );
}

export function Initials({ name }: { name: string }) {
  const parts = name.trim().split(/\s+/);
  const text = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2)).toUpperCase();
  return <span className="avatar" aria-hidden="true">{text}</span>;
}

export function PersonRow({ name, username, onRemove, removing }: {
  name: string; username?: string | null; onRemove?: () => void; removing?: boolean;
}) {
  return (
    <li className="person-row">
      <Initials name={name} />
      <span className="person-row__name">{name}</span>
      {username && <span className="person-row__user">@{username}</span>}
      {onRemove && (
        <button type="button" className="person-row__remove" onClick={onRemove} disabled={removing} aria-label={`Remove ${name}`}>
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
  return (
    <button type="button" className={`chip${filter ? ' chip--filter' : ''}${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      {dot && <span className="chip__dot" style={{ background: dot }} aria-hidden="true" />}
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
    <label className={`option-card${checked ? ' is-selected' : ''}`}>
      <input type="radio" name={name} value={value} checked={checked} onChange={() => onChange(value)} className="visually-hidden" />
      {icon && <span className="option-card__icon" aria-hidden="true">{icon}</span>}
      <span className="option-card__text">
        <span className="option-card__title">{title}</span>
        {description && <span className="option-card__desc">{description}</span>}
      </span>
      <span className="option-card__radio" aria-hidden="true" />
    </label>
  );
}

/* ── States ────────────────────────────────────────────────────────────── */

export function EmptyState({ bulb = 'default', heading, line, children }: {
  bulb?: BulbState; heading: string; line?: string; children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Bulb state={bulb} height={72} />
      <h2 className="empty__heading">{heading}</h2>
      {line && <p className="empty__line">{line}</p>}
      {children}
    </div>
  );
}

export function Skeleton({ w, h = 12, className = '' }: { w: number | string; h?: number; className?: string }) {
  return <span className={`skeleton ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}

export function Banner({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="banner" role="alert">
      <p>{children}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner action={onRetry && <button type="button" className="btn btn--secondary" onClick={onRetry}>Try again</button>}>
      {message}
    </Banner>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="visually-hidden">{label}</span>
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
  return <div className="toast" role="status">{message}</div>;
}
