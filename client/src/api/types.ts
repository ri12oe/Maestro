// Shapes returned by the server API (see server/src/routes).

export type WorkType =
  | 'feature' | 'fix' | 'test' | 'refactor' | 'docs'
  | 'formatting' | 'generated' | 'design' | 'other';

export type Substance = 'low' | 'medium' | 'high';
export type RiskLevel = 'high' | 'medium' | 'low';

export interface MemberSummary {
  memberId: number;
  login: string;
  displayName: string;
  workCounts: Partial<Record<WorkType, number>>;
  substanceShares: Partial<Record<WorkType, number>>;
  totalWeight: number;
  contributionCount: number;
  openTasks: number;
  focusSummary: string;
}

export interface TeamSummary {
  team: { id: number; name: string; repo: string };
  statCards: {
    tasksDone: number;
    tasksTotal: number;
    tasksAtRisk: number;
    pendingSuggestions: number;
  };
  members: MemberSummary[];
}

export interface Risk {
  id: number;
  level: RiskLevel;
  description: string;
  evidence: Array<{ type: 'task' | 'contribution'; id: number }>;
  task_id: number | null;
  task_number: number | null;
  task_title: string | null;
  task_due_date: string | null;
  task_assignee: string | null;
  generated_at: string;
}

export interface Suggestion {
  id: number;
  status: 'pending' | 'accepted' | 'dismissed' | 'discuss';
  rationale: string[];
  checkin_message: string | null;
  task_id: number;
  task_number: number | null;
  task_title: string;
  task_due_date: string | null;
  from_member_id: number;
  from_login: string;
  from_name: string | null;
  to_member_id: number;
  to_login: string;
  to_name: string | null;
  from_open_tasks: number;
  to_open_tasks: number;
}

export interface Contribution {
  id: number;
  member_id: number;
  source: 'commit' | 'manual';
  github_sha: string | null;
  title: string;
  body: string | null;
  kind: string | null;
  link: string | null;
  url: string | null;
  files_changed: number | null;
  additions: number | null;
  deletions: number | null;
  authored_at: string;
  work_type: WorkType | null;
  substance: Substance | null;
  summary: string | null;
  disputed: 0 | 1 | null;
  dispute_note: string | null;
  task_id: number | null;
  task_number: number | null;
  task_title: string | null;
}
