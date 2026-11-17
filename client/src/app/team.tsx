import { createContext, useContext } from 'react';
import type { MemberSummary, Risk, Suggestion, Task, Team, TeamSummary } from '../api/types.ts';
import { effectiveDeadline } from '../deadline.ts';

export interface TeamContextValue {
  teamId: number;
  base: string;
  team: Team | null;
  summary: TeamSummary | null;
  tasks: Task[] | null;
  risks: Risk[] | null;
  suggestions: Suggestion[] | null;
  loading: boolean;
  error: string | null;
  /** Bumped after every change; pages add it to their data dependencies. */
  version: number;
  reload: () => void;
  syncing: boolean;
  syncError: string | null;
  syncNow: () => Promise<void>;
  me: number | null;
  setMe: (id: number | null) => void;
  openLog: (memberId?: number) => void;
  openIdentity: () => void;
  /** Open Ask Maestro, optionally asking a question straight away. */
  openAsk: (question?: string) => void;
}

export const TeamContext = createContext<TeamContextValue | null>(null);

export function useTeam(): TeamContextValue {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam must be used inside the team shell');
  return ctx;
}

/** Members in alphabetical order: never by amount. */
export function sortedMembers(members: MemberSummary[] | undefined): MemberSummary[] {
  return [...(members ?? [])].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function firstName(name: string | null | undefined, login?: string | null): string {
  return name?.trim().split(/\s+/)[0] || login || 'Someone';
}

export function teamDeadline(team: Team | null, tasks: Task[] | null) {
  return effectiveDeadline(team?.deadline, (tasks ?? []).map(t => t.due_date));
}

export function daysUntil(iso: string, now = new Date()): number {
  const due = new Date(iso.length === 10 ? `${iso}T23:59:59` : iso);
  return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 86_400_000) - (iso.length === 10 ? 1 : 0));
}

const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
export function longDate(iso: string): string {
  return dayFmt.format(iso.length === 10 ? new Date(`${iso}T12:00:00`) : new Date(iso));
}
