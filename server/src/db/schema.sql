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
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
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
  url               TEXT,                  -- link to GitHub commit
  embedding         BLOB,                  -- Float32 vector for task-matching
  authored_at       TEXT    NOT NULL,
  synced_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- classifications: AI label for each contribution (cached by contribution_id)
CREATE TABLE IF NOT EXISTS classifications (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contribution_id  INTEGER NOT NULL UNIQUE REFERENCES contributions(id) ON DELETE CASCADE,
  work_type        TEXT    NOT NULL CHECK (work_type IN ('feature','fix','test','refactor','docs','formatting','generated')),
  substance        TEXT    NOT NULL CHECK (substance IN ('low','medium','high')),
  summary          TEXT    NOT NULL,
  disputed         INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1)),
  dispute_note     TEXT,
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
