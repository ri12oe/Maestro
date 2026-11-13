import type { WorkType } from './api/types.ts';

/**
 * Work types are grouped into five categories for the contribution bars.
 * Colors differ in lightness as well as hue, so they stay distinguishable
 * for color-blind viewers; every bar also has a text equivalent.
 */
export interface WorkCategory {
  key: string;
  label: string;
  color: string;
  types: WorkType[];
}

export const WORK_CATEGORIES: WorkCategory[] = [
  { key: 'features', label: 'Features', color: '#1F5FBF', types: ['feature'] },
  { key: 'fixes', label: 'Fixes and refactors', color: '#8FB4EE', types: ['fix', 'refactor'] },
  { key: 'tests', label: 'Tests', color: '#E8873A', types: ['test'] },
  { key: 'docs', label: 'Docs and design', color: '#7E8794', types: ['docs', 'design'] },
  { key: 'other', label: 'Other', color: '#C2C7CE', types: ['formatting', 'generated', 'other'] },
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

/** Share of a member's weighted work per category (0–1), in WORK_CATEGORIES order. */
export function categoryShares(shares: Partial<Record<WorkType, number>>): Array<WorkCategory & { share: number }> {
  return WORK_CATEGORIES.map(c => ({
    ...c,
    share: c.types.reduce((sum, t) => sum + (shares[t] ?? 0), 0),
  }));
}
