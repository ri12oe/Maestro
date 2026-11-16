import type { Risk, Suggestion } from '../api/types.ts';

/** One card in "Needs the team": a risk, the swap that would fix it, or both. */
export interface Decision {
  key: string;
  risk: Risk | null;
  suggestion: Suggestion | null;
}

const ORDER = { high: 0, medium: 1, low: 2 } as const;

export function buildDecisions(risks: Risk[] | null, suggestions: Suggestion[] | null): Decision[] {
  const pending = (suggestions ?? []).filter(s => s.status === 'pending');
  const used = new Set<number>();
  const out: Decision[] = (risks ?? []).map(r => {
    const s = r.task_id != null ? pending.find(x => x.task_id === r.task_id && !used.has(x.id)) ?? null : null;
    if (s) used.add(s.id);
    return { key: `r${r.id}`, risk: r, suggestion: s };
  });
  for (const s of pending) if (!used.has(s.id)) out.push({ key: `s${s.id}`, risk: null, suggestion: s });
  return out.sort((a, b) => {
    const la = a.risk ? ORDER[a.risk.level] : 1;
    const lb = b.risk ? ORDER[b.risk.level] : 1;
    if (la !== lb) return la - lb;
    const da = a.risk?.task_due_date ?? a.suggestion?.task_due_date ?? '9999';
    const db = b.risk?.task_due_date ?? b.suggestion?.task_due_date ?? '9999';
    return da.localeCompare(db);
  });
}
