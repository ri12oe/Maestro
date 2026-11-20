-- Group Project Referee — SQLite Schema
-- Run via: npm run migrate

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- teams: one row per connected GitHub repo
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  repo_owner  TEXT    NOT NULL,
  repo_name   TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  last_synced_at TEXT,                 -- end of the last successful GitHub sync
  is_demo     INTEGER NOT NULL DEFAULT 0, -- 1 for the seeded demo team (no real repo)
  deadline    TEXT,                    -- YYYY-MM-DD team deadline; overrides milestone dates when set
  report_enabled INTEGER NOT NULL DEFAULT 0 -- 1 when the team has turned on the project report
);

-- demo_seed: done marker for the opt-in StudyBuddy seed (slug 'studybuddy').
-- Written in the same transaction as a finished seed. Not a foreign key, so
-- deleting the team leaves the marker and startup does not recreate the demo.
-- migration_007 inserts the row when the previous seed's team is already present.
CREATE TABLE IF NOT EXISTS demo_seed (
  slug       TEXT PRIMARY KEY,
  team_id    INTEGER,                 -- team that was seeded; stale after that team is deleted
  seeded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- members: one row per contributor; auto-created on first sync appearance
CREATE TABLE IF NOT EXISTS members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  github_login  TEXT,               -- nullable: commit may have no GitHub account
  email         TEXT,               -- git commit author email; fallback for attribution
  display_name  TEXT,               -- from git commit author name
  added_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (team_id, github_login),   -- one login per team (NULL not considered duplicate)
  UNIQUE (team_id, email)           -- one email per team (NULL not considered duplicate)
);

-- tasks: GitHub Issues for the connected repo
CREATE TABLE IF NOT EXISTS tasks (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id              INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  github_issue_number  INTEGER,
  title                TEXT    NOT NULL,
  body                 TEXT,
  assignee_login       TEXT,
  status               TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  due_date             TEXT,               -- ISO-8601 from milestone.due_on
  embedding            BLOB,               -- Float32 vector for similarity matching
  synced_at            TEXT,
  UNIQUE (team_id, github_issue_number)
);

-- contributions: commits and manual log entries
CREATE TABLE IF NOT EXISTS contributions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id           INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  member_id         INTEGER NOT NULL REFERENCES members(id),
  source            TEXT    NOT NULL CHECK (source IN ('commit', 'manual')),
  github_sha        TEXT    UNIQUE,        -- null for manual entries
  github_pr_number  INTEGER,               -- PR reference (informational only)
  title             TEXT    NOT NULL,      -- first line of commit message or manual title
  body              TEXT,                  -- manual entry description; null for commits
  kind              TEXT,                  -- manual: design | research | meeting | coordination | other
  link              TEXT,                  -- manual: optional external URL
  diff_summary      TEXT,                  -- patch truncated to 200 lines
  files_changed     INTEGER,               -- number of files touched (from GitHub API)
  additions         INTEGER,               -- total lines added
  deletions         INTEGER,               -- total lines deleted
  paths             TEXT,                  -- JSON array of file paths changed by a commit; null for manual entries
  url               TEXT,                  -- link to GitHub commit
  embedding         BLOB,                  -- Float32 vector for task-matching
  authored_at       TEXT    NOT NULL,
  synced_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  match_checked_task_id INTEGER            -- highest task id this commit has been checked against
);

-- classifications: AI label for each contribution (cached by contribution_id)
CREATE TABLE IF NOT EXISTS classifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id  INTEGER NOT NULL UNIQUE REFERENCES contributions(id) ON DELETE CASCADE,
  work_type        TEXT    NOT NULL CHECK (work_type IN ('feature','fix','test','refactor','docs','formatting','generated','design','other')),
  substance        TEXT    NOT NULL CHECK (substance IN ('low','medium','high')),
  summary          TEXT    NOT NULL,
  disputed         INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1)),
  dispute_note     TEXT,
  -- While corrected_at is set, work_type and substance are the team's label
  -- and these two columns keep the AI label so the correction can be undone.
  -- Both are NULL when the row still shows the AI label.
  original_work_type TEXT CHECK (
    original_work_type IS NULL OR original_work_type IN ('feature','fix','test','refactor','docs','formatting','generated','design','other')
  ),
  original_substance TEXT CHECK (
    original_substance IS NULL OR original_substance IN ('low','medium','high')
  ),
  corrected_at     TEXT,               -- ISO-8601 while a human correction is active; NULL otherwise
  classified_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  model_version    TEXT
);

-- task_matches: best-matching task for each contribution (cosine >= 0.5 only)
CREATE TABLE IF NOT EXISTS task_matches (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id   INTEGER NOT NULL UNIQUE REFERENCES contributions(id) ON DELETE CASCADE,
  task_id           INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  similarity_score  REAL    NOT NULL,
  matched_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- risks: deterministic signals + LLM-written descriptions
CREATE TABLE IF NOT EXISTS risks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  task_id       INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  level         TEXT    NOT NULL CHECK (level IN ('high','medium','low')),
  description   TEXT    NOT NULL,
  evidence      TEXT    NOT NULL DEFAULT '[]',  -- JSON array of contribution/task IDs
  generated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  dismissed     INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1))
);

-- suggestions: AI-proposed task reassignments
CREATE TABLE IF NOT EXISTS suggestions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id          INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  from_member_id   INTEGER NOT NULL REFERENCES members(id),
  to_member_id     INTEGER NOT NULL REFERENCES members(id),
  task_id          INTEGER NOT NULL REFERENCES tasks(id),
  rationale        TEXT,
  checkin_message  TEXT,
  status           TEXT    NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','dismissed','discuss')),
  generated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- @view
-- Effective label for every read (map, People, Report, digest, reasoner).
-- work_type and substance are that label: the team's correction while
-- corrected_at is set, otherwise the AI label. original_work_type and
-- original_substance are the AI label during a correction. Queries use this
-- view instead of repeating a COALESCE.
DROP VIEW IF EXISTS effective_classifications;
CREATE VIEW effective_classifications AS
SELECT
  id,
  contribution_id,
  work_type,
  substance,
  summary,
  disputed,
  dispute_note,
  classified_at,
  model_version,
  original_work_type,
  original_substance,
  corrected_at
FROM classifications;
