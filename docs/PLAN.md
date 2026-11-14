# Group Project Referee — PLAN.md

> MVP scope only. GitHub as the sole contribution source. No code written yet.
> Deadline: Dec 10, 5:00 PM ET.

---

## Top-Level Overview

Build a monorepo web app that ingests a team's GitHub repo (commits and Issues), classifies each contribution with an LLM, matches work to tasks, surfaces risk, and proposes rebalance suggestions — all surfaced in a React dashboard. The backend is a Node/Express REST API backed by SQLite; the AI layer is behind a single provider interface using xAI's Grok API.

**Non-goals (MVP):** user auth beyond team setup, webhooks, Google Docs/Slack, weekly digest, instructor report, multi-team classrooms.

---

## Folder Structure

```
Maestro/
├── client/                          # React + TypeScript + Vite + Sass
│   ├── public/
│   ├── src/
│   │   ├── assets/
│   │   ├── components/              # Shared UI components
│   │   ├── pages/                   # One folder per screen
│   │   │   ├── Connect/
│   │   │   ├── Overview/
│   │   │   ├── MemberEvidence/
│   │   │   ├── RiskRadar/
│   │   │   ├── Rebalance/
│   │   │   └── LogWork/
│   │   ├── styles/                  # Sass variables, reset, global
│   │   ├── api/                     # Typed fetch wrappers
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts               # Includes /api proxy to localhost:3001
│   ├── tsconfig.json
│   └── package.json
│
├── server/                          # Node + TypeScript + Express
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.sql           # Canonical DDL
│   │   │   ├── migrate.ts           # Run-once migration runner
│   │   │   └── client.ts            # better-sqlite3 singleton
│   │   ├── ingestion/
│   │   │   ├── github.ts            # GitHub REST API calls (commits + Issues)
│   │   │   └── sync.ts              # Orchestrates a full sync
│   │   ├── ai/
│   │   │   ├── provider.ts          # completeJSON; implementation chosen by AI_PROVIDER env var (mock | grok)
│   │   │   ├── classifier.ts        # Commit → structured label; runs after sync
│   │   │   ├── eval/
│   │   │   │   ├── commits.csv      # 30 hand-labeled commits for accuracy measurement
│   │   │   │   └── run.ts           # npm run eval — prints accuracy and misses
│   │   │   └── reasoner.ts          # Deterministic risk signals; LLM writes explanations + swaps
│   │   ├── routes/
│   │   │   ├── teams.ts
│   │   │   ├── members.ts
│   │   │   ├── contributions.ts
│   │   │   ├── tasks.ts
│   │   │   ├── risks.ts
│   │   │   ├── suggestions.ts
│   │   │   └── manual.ts
│   │   └── index.ts                 # Express app entry point; serves built client in production
│   ├── tsconfig.json
│   └── package.json
│
├── docs/
│   ├── BRIEF.md
│   └── PLAN.md
├── BOB_LOG.md
├── .env.example
└── package.json                     # Root workspace package.json (npm workspaces)
```

---

## SQLite Data Model

### Table: `teams`
Represents one project team connecting a single GitHub repo. The GitHub token comes from `.env` only — it is never stored in the database.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `name` | TEXT NOT NULL | Team display name |
| `repo_owner` | TEXT NOT NULL | GitHub org or user |
| `repo_name` | TEXT NOT NULL | GitHub repo name |
| `created_at` | TEXT | ISO-8601 |
| `deadline` | TEXT | `YYYY-MM-DD` or null. A date the team sets. When set, risk signals use it instead of each task's milestone `due_date`. Null keeps the milestone date. |

### Table: `members`
One row per team member. Unknown contributors are auto-created during sync. A row may have no `github_login` if the commit had no associated GitHub account.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `team_id` | INTEGER FK → teams | |
| `github_login` | TEXT | Used to attribute commits; nullable for unknown contributors |
| `email` | TEXT | Git commit email; used as fallback for attribution |
| `display_name` | TEXT | Derived from commit author name |
| `added_at` | TEXT | ISO-8601 |

### Table: `tasks`
GitHub Issues pulled from the connected repo.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `team_id` | INTEGER FK → teams | |
| `github_issue_number` | INTEGER | Null if manually added |
| `title` | TEXT NOT NULL | |
| `body` | TEXT | Issue description |
| `assignee_login` | TEXT | GitHub login |
| `status` | TEXT | `open` / `closed` |
| `due_date` | TEXT | ISO-8601; from `milestone.due_on` |
| `embedding` | BLOB | Float32 vector for similarity matching |
| `synced_at` | TEXT | ISO-8601 |

### Table: `contributions`
One row per commit or manual log entry. Merge commits are skipped during ingestion. `github_pr_number` is stored as a reference only — PRs are not separate contributions.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `team_id` | INTEGER FK → teams | |
| `member_id` | INTEGER FK → members | |
| `source` | TEXT | `commit` / `manual` |
| `github_sha` | TEXT UNIQUE | Null for manual entries |
| `github_pr_number` | INTEGER | PR this commit was part of, if detectable; null otherwise |
| `title` | TEXT | Commit message first line or manual entry title |
| `body` | TEXT | Manual entry description; null for commits |
| `kind` | TEXT | Manual entry type (design, research, meeting, etc.); null for commits |
| `link` | TEXT | Optional external URL for manual entries |
| `diff_summary` | TEXT | Patch truncated to 200 lines for classifier context |
| `url` | TEXT | Link back to GitHub commit |
| `embedding` | BLOB | Float32 vector for task-matching |
| `authored_at` | TEXT | ISO-8601 |
| `synced_at` | TEXT | ISO-8601 |

### Table: `classifications`
AI-generated label for each contribution. Cached by `contribution_id`.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `contribution_id` | INTEGER FK → contributions UNIQUE | One label per contribution |
| `work_type` | TEXT | `feature` / `fix` / `test` / `refactor` / `docs` / `formatting` / `generated` |
| `substance` | TEXT | `low` / `medium` / `high` |
| `summary` | TEXT | One-line AI summary |
| `disputed` | INTEGER | 0 or 1 (boolean) |
| `dispute_note` | TEXT | Member's dispute comment |
| `classified_at` | TEXT | ISO-8601 |
| `model_version` | TEXT | Which model/prompt version produced this |

### Table: `task_matches`
Embedding-based link from a contribution to the Issue it best matches. Only created when cosine similarity ≥ 0.5.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `contribution_id` | INTEGER FK → contributions | |
| `task_id` | INTEGER FK → tasks | |
| `similarity_score` | REAL | Cosine similarity 0–1 |
| `matched_at` | TEXT | ISO-8601 |

### Table: `risks`
Output of the risk reasoning step. Risk signals are computed deterministically; the LLM writes the human-readable description.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `team_id` | INTEGER FK → teams | |
| `task_id` | INTEGER FK → tasks nullable | Which task is at risk |
| `level` | TEXT | `high` / `medium` / `low` |
| `description` | TEXT | Plain-language risk statement from LLM |
| `evidence` | TEXT | JSON array of contribution IDs or task IDs |
| `generated_at` | TEXT | ISO-8601 |
| `dismissed` | INTEGER | 0 or 1 |

### Table: `suggestions`
Rebalance task-swap proposals. Swap logic is AI-generated based on skill signals; framing is always project-centred.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | autoincrement |
| `team_id` | INTEGER FK → teams | |
| `from_member_id` | INTEGER FK → members | Member currently overloaded |
| `to_member_id` | INTEGER FK → members | Member proposed to receive work |
| `task_id` | INTEGER FK → tasks | Task to reassign |
| `rationale` | TEXT | AI explanation |
| `checkin_message` | TEXT | Neutral draft message for the team |
| `status` | TEXT | `pending` / `accepted` / `dismissed` / `discuss` |
| `generated_at` | TEXT | ISO-8601 |

---

## API Endpoints

All endpoints prefixed `/api`. All responses are JSON. Errors return `{ error: string }`.

### Teams

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/teams` | Create team (name, repo_owner, repo_name) |
| `GET` | `/api/teams/:teamId` | Get team info, including `deadline` |
| `PATCH` | `/api/teams/:teamId` | Set or clear the team deadline. Body: `{ "deadline": "YYYY-MM-DD" }` or `{ "deadline": null }`. `400` if `deadline` is missing or not that shape. `404` if the team does not exist. |
| `POST` | `/api/teams/:teamId/sync` | Trigger a full GitHub sync (commits + Issues) |

### Members

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams/:teamId/members` | List all members |
| `POST` | `/api/teams/:teamId/members` | Add a member by GitHub login |
| `DELETE` | `/api/teams/:teamId/members/:memberId` | Remove member |

### Tasks (GitHub Issues)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams/:teamId/tasks` | List all tasks with status |
| `GET` | `/api/teams/:teamId/tasks/:taskId` | Single task detail + matched contributions |

### Contributions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams/:teamId/contributions` | All contributions; query params: `?memberId=`, `?source=`, `?taskId=` |
| `GET` | `/api/teams/:teamId/contributions/:contributionId` | Single contribution with classification |
| `POST` | `/api/teams/:teamId/contributions/:contributionId/dispute` | Flag a label as wrong |

### Manual Work Log

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/teams/:teamId/manual` | Log an off-repo contribution (kind, title, body, link, memberId, related taskId) |
| `GET` | `/api/teams/:teamId/manual` | List manual log entries for team |

### Risks

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams/:teamId/risks` | All active risks (not dismissed) |
| `POST` | `/api/teams/:teamId/risks/:riskId/dismiss` | Dismiss a risk card |

### Suggestions

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams/:teamId/suggestions` | All pending suggestions |
| `POST` | `/api/teams/:teamId/suggestions/:suggestionId/respond` | Accept / discuss / dismiss, or set an accepted suggestion back to `pending` |

### Dashboard Summary (aggregated)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/teams/:teamId/summary` | Stat cards: tasks done, at-risk count, pending suggestions, contribution map data per member |

---

## Milestone Breakdown

---

### Milestone 1 — Foundations (Nov 12–17)

**Intent:** Establish the runnable skeleton every later milestone builds on. Nothing is faked; everything that exists works end-to-end in its minimal form.

**Acceptance Criteria:**
- `npm install` at repo root installs all workspaces.
- `npm run dev` in `server/` starts Express on port 3001 with no errors.
- `npm run dev` in `client/` starts Vite dev server on port 5173 with no errors; `/api` requests proxy to port 3001.
- `POST /api/teams` creates a team row; `GET /api/teams/:id` returns it.
- Running the migration script creates all tables listed in the data model.
- `POST /api/teams/:teamId/sync` fetches all commits (paginated) from the connected repo, skips merge commits, stores per-commit file list and a patch truncated to 200 lines, and persists them as `contributions` rows. Also fetches all open and closed Issues and persists them as `tasks` rows with `due_date` from `milestone.due_on`.
- Unknown commit authors are auto-created as `members` rows (github_login + email + display_name); sync never crashes on a commit with no GitHub login.
- GitHub token is read from `GITHUB_TOKEN` in `.env`, never stored in the database.
- `.env.example` lists every required env var with placeholder values.
- TypeScript compiles with no errors in both workspaces.
- Vitest is configured in `server/`; tests pass for: migration creates all expected tables, and GitHub mapping logic handles commits with and without a GitHub login (mock fetch).
- `BOB_LOG.md` has a dated entry for the Plan session and this implementation session.

**Todo:**
1. Create root `package.json` with npm workspaces for `client/` and `server/`.
2. Scaffold `server/` with TypeScript, Express, `better-sqlite3`, `tsx` for dev, and Vitest.
3. Scaffold `client/` with Vite, React, TypeScript, and Sass; configure `/api` proxy in `vite.config.ts`.
4. Write `server/src/db/schema.sql` with all tables from the data model.
5. Write `server/src/db/migrate.ts` to execute `schema.sql` against the SQLite DB.
6. Write `server/src/db/client.ts` as a `better-sqlite3` singleton.
7. Implement `POST /api/teams` and `GET /api/teams/:id` routes.
8. Implement `server/src/ingestion/github.ts` — paginated commit fetch with file list and truncated patch; Issue fetch with `milestone.due_on`.
9. Implement auto-member creation in sync; never crash on no GitHub login.
10. Implement `POST /api/teams/:teamId/sync` route wiring github.ts → DB.
11. Add `.env.example` and `.gitignore`.
12. Write Vitest tests for migration and GitHub mapping logic.
13. Add `BOB_LOG.md` with entries for the Plan session and this session.

**Relevant context:** `docs/BRIEF.md` §Architecture, §Milestones.

**Status:** [ ] pending

---

### Milestone 2 — AI Core (Nov 18–24)

**Intent:** Make the AI classification and task-matching pipeline real and measurable. All AI calls go through one provider interface so the model can be swapped. Seed data is inserted directly (no GitHub sync required).

**Acceptance Criteria:**
- Every synced contribution gets a `classifications` row after sync (or on first call).
- Classification result is cached by `contribution_id`; re-running sync does not re-classify the same commit.
- `work_type` is one of the seven defined values; `substance` is low/medium/high; `summary` is a non-empty string.
- Each contribution has at most one `task_matches` row pointing to the highest-similarity Issue with score ≥ 0.5; contributions below the threshold have no match row.
- Accuracy on the hand-labeled test set (≥30 commits) is recorded in `BOB_LOG.md`.
- `provider.ts` exports `completeJSON(prompt, zodSchema, schemaName)`; the implementation is selected by `AI_PROVIDER` env var (`mock` or `grok`); the mock is deterministic and offline. Invalid JSON from the LLM triggers one retry (after 2 s for 5xx/429) before throwing.
- Zod validates all LLM JSON responses; a validation failure triggers one retry.
- `seed.ts` in `server/src/db/` inserts the demo team "StudyBuddy" with Rio, Sam, Priya and Jordan, 6 Issues with due dates, and ≥25 commits directly into the database; Sam is overloaded with backend work; Issue #12 "Auth flow" has had no activity for 6+ days and is due within 8 days of today; Jordan has only a few test commits; Priya has 3 manual log entries. Then runs the classifier.

**Todo:**
1. Write `server/src/ai/provider.ts` with `completeJSON(prompt, zodSchema, schemaName)`; select implementation via `AI_PROVIDER` env var (`mock` or `grok`); implement `mock` provider (deterministic, offline); implement `grok` provider (POST to `https://api.x.ai/v1/chat/completions` with structured output JSON schema). Retry once on invalid JSON or 5xx/429 (wait 2 s). Never log the API key.
2. Write `server/src/ai/classifier.ts` — one call per contribution; input: commit title, diff_summary, team's open tasks as `#number: title`; output schema: `work_type` (7 enum values), `substance` (low/medium/high), `summary` (one sentence), `task_number` (integer from list or null), `match_confidence` (low/medium/high). Write a `classifications` row. Write a `task_matches` row only if `task_number` is a real open task and confidence isn't low; store `high=0.9, medium=0.7`. Skip already-classified contributions; never overwrite a human-set task match. `model_version = grok:<model>:prompt-v1`.
3. Wire classifier into the sync pipeline at the end of `syncTeam`; add `POST /api/teams/:teamId/classify` for on-demand classification.
4. Write `server/src/ai/eval/commits.csv` with 30 hand-labeled commits; `npm run eval` prints accuracy and lists misses.
5. Write `server/src/db/seed.ts` — insert "StudyBuddy" team, Rio/Sam/Priya/Jordan, 6 Issues with due dates, ≥25 commits; Sam overloaded; Issue #12 "Auth flow" stalled and due soon; Priya has 3 manual entries; then run classifier.
6. In `sync.ts`: when a member found by email has no `github_login` and the commit has one, fill it in.
7. Record results in `BOB_LOG.md`.

**Relevant context:** `docs/BRIEF.md` §AI approach; `server/src/ingestion/sync.ts`; `server/src/db/schema.sql`.

**Status:** [ ] pending

---

### Milestone 3 — Product / Dashboard (Nov 25–Dec 1)

**Intent:** Build all six dashboard screens and the remaining backend endpoints (risk reasoner, rebalance, manual log). The app is usable end-to-end on a real repo.

**Acceptance Criteria:**
- All six screens render with real data from the API (no hardcoded fixtures in the UI).
- `GET /api/teams/:teamId/summary` returns contribution map data (work-type breakdown per member) and stat card numbers.
- Risk reasoner computes signals deterministically (days since last activity per task, single-contributor directories, days to due date) and uses the LLM only to write the plain-language description and propose swaps. Days to due date use `teams.deadline` when the team has set one, and the task's milestone `due_date` otherwise.
- Risk reasoner runs during sync and produces at least one `risks` row for a repo with a stalled task.
- Rebalance suggestions are generated and returned by `GET /api/teams/:teamId/suggestions`.
- Manual work log form submits to `POST /api/teams/:teamId/manual` and appears in the member's contribution list.
- Dispute button calls `POST .../dispute` and shows the disputed state in the UI.
- Brand styles (colors, fonts) from the brief are applied via Sass variables.
- No leaderboard or numerical ranking of people appears anywhere in the UI.

**Todo:**
1. Implement `GET /api/teams/:teamId/summary` aggregation query.
2. Write `server/src/ai/reasoner.ts` — compute risk signals deterministically; call LLM for explanation text and swap proposals; write to `risks` and `suggestions` tables.
3. Implement `GET /api/teams/:teamId/risks` and `POST .../dismiss`.
4. Implement `GET /api/teams/:teamId/suggestions` and `POST .../respond`.
5. Implement manual log routes (`POST` and `GET /api/teams/:teamId/manual`).
6. Implement dispute route (`POST .../dispute`).
7. Build Connect screen.
8. Build Team Overview screen (stat cards + stacked contribution bar chart per member).
9. Build Member Evidence screen (AI summary, work-type breakdown, contributions table with dispute button).
10. Build Risk Radar screen (risk cards with evidence chips, task progress table).
11. Build Rebalance Suggestions screen (swap cards with accept/discuss/dismiss).
12. Build Log Work screen (manual log form + recently logged list).
13. Define Sass variables for the brand palette and typography from the brief.
14. Wire client `api/` fetch wrappers to every endpoint used by the screens.

**Relevant context:** `docs/BRIEF.md` §Screens, §Fairness rules; `server/src/routes/`; `client/src/pages/`.

**Status:** [ ] pending

---

### Milestone 4 — Demo-Ready (Dec 2–7)

**Intent:** Produce a polished, deployable demo that judges can run through without hitting broken states.

**Acceptance Criteria:**
- Seed script (from Milestone 2) populates a demo team with 4 simulated members, ≥20 contributions, one stalled task, one overloaded member; after running the AI pipeline the dashboard shows at least one high-priority risk card and at least one rebalance suggestion.
- App is deployed as a single Railway service: Express serves the built Vite client, SQLite lives on a Railway volume.
- Public URL is accessible and the demo scenario loads without errors.
- `README.md` covers: what the app does, how to run it locally (env vars, `npm install`, `npm run dev`), how to seed demo data, and the public demo link.
- No secrets appear in the repo; `.env.example` is complete. — done
- All acceptance criteria from Milestones 1–3 still pass against the deployed instance.

**Todo:**
1. Verify seed script (Milestone 2) produces the required demo scenario end-to-end.
2. Configure Vite build output and Express static serving for production.
3. Write Railway `railway.toml` (or `Procfile`) and configure volume mount for `DB_PATH`. — done-pending-deploy (`railway.json` already has the build, start, and restart settings; `docs/RAILWAY.md` is the dashboard steps for the volume and variables. Deploy is still todo 4.)
4. Deploy to Railway; set all required env vars in the Railway dashboard.
5. Smoke-test the deployed public URL end-to-end.
6. Write `README.md` with setup and demo instructions. — done
7. Add a `BOB_LOG.md` entry for this milestone.

**Relevant context:** `docs/BRIEF.md` §Milestones (Dec 2–7); `.env.example`; `server/src/db/seed.ts`.

**Status:** [ ] pending

---

### Milestone 5 — Submit (Dec 8–10)

**Intent:** Package the project for judges. Produce all required submission artifacts.

**Acceptance Criteria:**
- A 3-minute screen-capture demo video is recorded showing: team connect flow → overview → member evidence → risk radar → rebalance suggestion.
- Slide deck (≤10 slides) covers: problem, solution, AI approach, architecture diagram, demo screenshot, fairness rules.
- Project page (hackathon submission form) is filled with title, description, public repo URL, demo URL, and video link.
- `BOB_LOG.md` has an entry for every Bob session throughout the project.
- Submitted before Dec 10, 5:00 PM ET.

**Todo:**
1. Record 3-minute demo video against the live deployed instance.
2. Create slide deck.
3. Finalize `BOB_LOG.md` with a complete session history.
4. Fill out hackathon submission form before the deadline.

**Relevant context:** `docs/BRIEF.md` §Milestones (Dec 8–10 entry).

**Status:** [ ] pending

---

## Open Decisions

| # | Question | Default if not decided |
|---|---|---|
| 1 | xAI Grok model name? | `grok-3-mini` (set via `GROK_MODEL` env var) |
| 2 | Sync frequency in production — manual trigger only, or periodic? | Manual trigger only for MVP |
