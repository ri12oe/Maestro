import type { ReactNode } from 'react';
import type { RiskLevel } from '../api/types.ts';
import './ui.scss';

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
      </div>
      {children && <div className="page-header__aside">{children}</div>}
    </header>
  );
}

export function Card({ title, subtitle, children, className = '' }: {
  title?: string; subtitle?: string; children: ReactNode; className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || subtitle) && (
        <div className="card__head">
          {title && <h2 className="card__title">{title}</h2>}
          {subtitle && <p className="card__subtitle">{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, tone = 'default' }: {
  label: string; value: ReactNode; tone?: 'default' | 'risk' | 'accent';
}) {
  return (
    <div className="stat-card">
      <span className="stat-card__label">{label}</span>
      <span className={`stat-card__value stat-card__value--${tone}`}>{value}</span>
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'risk' | 'accent' }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

const LEVEL_TONE: Record<RiskLevel, 'risk' | 'neutral' | 'accent'> = { high: 'risk', medium: 'neutral', low: 'accent' };

export function LevelBadge({ level }: { level: RiskLevel }) {
  return <span className={`level level--${LEVEL_TONE[level]}`}>{level.toUpperCase()}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="state" role="status">{label}</p>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p>Something went wrong: {message}</p>
      {onRetry && <button type="button" className="btn btn--secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="state">{children}</p>;
}
