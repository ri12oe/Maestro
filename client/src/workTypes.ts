import type { Substance, WorkType } from './api/types.ts';

/**
 * Work types are grouped into five categories for the contribution bars.
 * Colours come from the design tokens (CSS variables set in global.scss);
 * every bar also has a text equivalent.
 */
export interface WorkCategory {
  key: string;
  label: string;
  color: string;
  types: WorkType[];
}

export const WORK_CATEGORIES: WorkCategory[] = [
  { key: 'features', label: 'Features', color: 'var(--work-feature)', types: ['feature'] },
  { key: 'fixes', label: 'Fixes and refactors', color: 'var(--work-fix)', types: ['fix', 'refactor'] },
  { key: 'tests', label: 'Tests', color: 'var(--work-test)', types: ['test'] },
  { key: 'docs', label: 'Docs and design', color: 'var(--work-docs)', types: ['docs', 'design'] },
  { key: 'other', label: 'Other', color: 'var(--work-other)', types: ['formatting', 'generated', 'other'] },
];

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  feature: 'Feature',
  fix: 'Fix',
  test: 'Test',
  refactor: 'Refactor',
  docs: 'Docs',
  formatting: 'Formatting',
  generated: 'Generated',
  design: 'Design',
  other: 'Other',
};

/** Colour for a single work type (the colour of its category). */
export function workTypeColor(type: WorkType | null): string {
  if (!type) return 'var(--work-other)';
  return WORK_CATEGORIES.find(c => c.types.includes(type))?.color ?? 'var(--work-other)';
}

/** "Substantial" or "Minor", the two substance tags shown on contribution rows. */
export function substanceLabel(s: Substance | null): string | null {
  if (!s) return null;
  return s === 'low' ? 'Minor' : 'Substantial';
}

/** Share of a member's weighted work per category (0–1), in WORK_CATEGORIES order. */
export function categoryShares(shares: Partial<Record<WorkType, number>>): Array<WorkCategory & { share: number }> {
  return WORK_CATEGORIES.map(c => ({
    ...c,
    share: c.types.reduce((sum, t) => sum + (shares[t] ?? 0), 0),
  }));
}
