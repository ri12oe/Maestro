import { Link } from 'react-router';
import { CircleDot, GitCommitHorizontal, NotebookPen } from 'lucide-react';
import { api } from '../api/client.ts';
import type { SourceRef } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { firstName, useTeam } from './team.tsx';

const chip = 'inline-flex h-6 max-w-full items-center gap-1.5 overflow-hidden rounded-full bg-surface-2 px-2 text-[11.5px] whitespace-nowrap text-fg-muted hover:text-fg';

/** Evidence chips for anything Maestro wrote. Every chip opens the task or person it came from. */
export function SourceChips({ sources, onNavigate }: { sources: SourceRef[]; onNavigate?: () => void }) {
  const { teamId, base, tasks, summary, version } = useTeam();
  const needsContribs = sources.some(s => s.type === 'contribution');
  const contribs = useApi(() => (needsContribs ? api.contributions(teamId) : Promise.resolve([])), [teamId, version, needsContribs]);
  if (!sources.length) return null;

  return (
    <ul className="flex list-none flex-wrap gap-1.5" aria-label="Sources">
      {sources.map(s => {
        if (s.type === 'task') {
          const t = tasks?.find(x => x.id === s.id);
          if (!t) return null;
          return (
            <li key={`t${s.id}`} className="max-w-full">
              <Link to={`${base}/plan/${t.github_issue_number ?? ''}`} onClick={onNavigate} className={chip} title={t.title}>
                <CircleDot size={12} className="shrink-0" aria-hidden="true" />
                <span className="truncate"><span className="font-mono">#{t.github_issue_number}</span> {t.title}</span>
              </Link>
            </li>
          );
        }
        const c = contribs.data?.find(x => x.id === s.id);
        if (!c) return null;
        const who = summary?.members.find(m => m.memberId === c.member_id);
        const Icon = c.source === 'manual' ? NotebookPen : GitCommitHorizontal;
        return (
          <li key={`c${s.id}`} className="max-w-full">
            <Link to={`${base}/people/${c.member_id}`} onClick={onNavigate} className={chip} title={c.title}>
              <Icon size={12} className="shrink-0" aria-hidden="true" />
              <span className="truncate">{c.github_sha && <span className="font-mono">{c.github_sha.slice(0, 7)} · </span>}{firstName(who?.displayName)}: {(c.summary ?? c.title).slice(0, 48)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
