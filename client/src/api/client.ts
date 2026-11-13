import type { Contribution, Risk, Suggestion, TeamSummary } from './types.ts';

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

  dispute: (teamId: number, contributionId: number, note: string) =>
    request<{ ok: true }>(`/teams/${teamId}/contributions/${contributionId}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ note: note.trim() || null }),
    }),
};
