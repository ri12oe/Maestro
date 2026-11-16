import type {
  ClassifyResult, Contribution, ManualEntry, ManualKind, Member, Risk, Suggestion, SyncResult, Task, Team, TeamListItem, TeamSummary,
} from './types.ts';

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (body && typeof body.error === 'string') ? body.error : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return body as T;
}

export const api = {
  summary: (teamId: number) =>
    request<TeamSummary>(`/teams/${teamId}/summary`),

  risks: (teamId: number) =>
    request<Risk[]>(`/teams/${teamId}/risks`),

  suggestions: (teamId: number) =>
    request<Suggestion[]>(`/teams/${teamId}/suggestions`),

  contributions: (teamId: number, filter: { memberId?: number; taskId?: number } = {}) => {
    const q = new URLSearchParams();
    if (filter.memberId) q.set('memberId', String(filter.memberId));
    if (filter.taskId) q.set('taskId', String(filter.taskId));
    const qs = q.toString();
    return request<Contribution[]>(`/teams/${teamId}/contributions${qs ? `?${qs}` : ''}`);
  },

  tasks: (teamId: number) =>
    request<Task[]>(`/teams/${teamId}/tasks`),

  members: (teamId: number) =>
    request<Member[]>(`/teams/${teamId}/members`),

  addMember: (teamId: number, githubLogin: string) =>
    request<Member>(`/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify({ github_login: githubLogin }) }),

  removeMember: (teamId: number, memberId: number) =>
    request<{ ok: true }>(`/teams/${teamId}/members/${memberId}`, { method: 'DELETE' }),

  teams: () =>
    request<TeamListItem[]>('/teams'),

  team: (teamId: number) =>
    request<Team>(`/teams/${teamId}`),

  /** Set or clear the stored deadline. `null` falls back to milestone dates. */
  setDeadline: (teamId: number, deadline: string | null) =>
    request<Team>(`/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ deadline }) }),

  /** Turn the project report on or off for the whole team. */
  setReportEnabled: (teamId: number, enabled: boolean) =>
    request<Team>(`/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify({ report_enabled: enabled }) }),

  /** Classify anything still unlabeled, then recompute risks. */
  classify: (teamId: number) =>
    request<ClassifyResult>(`/teams/${teamId}/classify`, { method: 'POST' }),

  createTeam: (input: { name: string; repo_owner: string; repo_name: string }) =>
    request<{ id: number }>('/teams', { method: 'POST', body: JSON.stringify(input) }),

  deleteTeam: (teamId: number) =>
    request<{ ok: true }>(`/teams/${teamId}`, { method: 'DELETE' }),

  sync: (teamId: number) =>
    request<SyncResult>(`/teams/${teamId}/sync`, { method: 'POST' }),

  dismissRisk: (teamId: number, riskId: number) =>
    request<{ ok: true }>(`/teams/${teamId}/risks/${riskId}/dismiss`, { method: 'POST' }),

  respond: (teamId: number, suggestionId: number, status: Suggestion['status']) =>
    request<{ ok: true }>(`/teams/${teamId}/suggestions/${suggestionId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  manualEntries: (teamId: number) =>
    request<ManualEntry[]>(`/teams/${teamId}/manual`),

  logWork: (teamId: number, input: {
    member_id: number; title: string; body?: string; kind: ManualKind; link?: string; task_id?: number;
    /** Calendar day the work happened, `YYYY-MM-DD`. Omit to stamp the current time. */
    date?: string;
  }) =>
    request<ManualEntry>(`/teams/${teamId}/manual`, { method: 'POST', body: JSON.stringify(input) }),

  dispute: (teamId: number, contributionId: number, note: string) =>
    request<{ ok: true }>(`/teams/${teamId}/contributions/${contributionId}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ note: note.trim() || null }),
    }),
};
