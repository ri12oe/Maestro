# BOB_LOG.md — Group Project Referee

Dated entries of what IBM Bob built in each session.
Required by the hackathon brief (docs/BRIEF.md §Constraints).

---

## 2026-11-12 — Session 1: Planning

**What was built:**
- Read and analysed `docs/BRIEF.md`.
- Created `docs/PLAN.md` with:
  - Full monorepo folder structure (`client/` + `server/`)
  - SQLite data model (7 tables: teams, members, tasks, contributions, classifications, task_matches, risks, suggestions)
  - Complete REST API endpoint list (9 route groups, ~22 endpoints)
  - 5-milestone breakdown with acceptance criteria for each

**Plan changes applied at end of session (user review):**
- Removed `teams.github_token`; token comes from `.env` only.
- `POST /api/teams/:teamId/sync` is the consistent sync endpoint everywhere.
- Milestone 1 ingests commits (paginated, file list, 200-line patch) AND Issues (milestone due_on).
- Contributions are commits + manual only; merge commits skipped; PRs are references not rows.
- Added `members.email` + `members.display_name`; auto-create on first sync; never crash on no login.
- `tasks.status` is `open`/`closed` only; `contributions.embedding` BLOB added.
- Matcher requires minimum similarity threshold of 0.5.
- `provider.ts` exposes `completeJSON(prompt, zodSchema)` + `embed(text)`; `AI_PROVIDER` env var selects implementation; Zod validation with one retry.
- `reasoner.ts` computes risk signals deterministically; LLM writes explanations + swaps only.
- `seed.ts` moved to Milestone 2; inserts directly into DB then runs AI pipeline.
- Deployment: single Railway service, Express serves built client, volume for SQLite.
- Milestone 1 adds Vitest, `/api` Vite proxy, and BOB_LOG.md entries.

---

## 2026-11-12 — Session 2: Milestone 1 Implementation

**What was built:**

### Root
- `package.json` — npm workspaces for `client/` and `server/`
- `.env.example` — all required env vars with placeholder values
- `.gitignore` — excludes `.env`, `*.db`, `node_modules`, `dist/`

### server/
- `package.json` — Express, better-sqlite3, tsx, Vitest
- `tsconfig.json` — NodeNext ESM, strict mode
- `src/db/schema.sql` — all 8 tables with CHECK constraints and FK cascades
- `src/db/migrate.ts` — reads schema.sql, executes against DB file; idempotent via CREATE TABLE IF NOT EXISTS
- `src/db/client.ts` — better-sqlite3 singleton; auto-runs migration on first import
- `src/ingestion/github.ts` — paginated commit fetch (with per-file list and 200-line patch truncation), Issue fetch with milestone.due_on, authorKey() helper; graceful null handling for commits without GitHub accounts
- `src/ingestion/sync.ts` — orchestrates full sync: fetches commits + Issues, upserts members (auto-create on first appearance), persists contributions (idempotent on github_sha), upserts tasks
- `src/routes/teams.ts` — POST /api/teams, GET /api/teams/:id, POST /api/teams/:id/sync
- `src/routes/members.ts` — GET/POST/DELETE members
- `src/routes/contributions.ts` — GET list (filtered), GET single, POST dispute
- `src/routes/tasks.ts` — GET list, GET single with matched contributions
- `src/routes/risks.ts` — GET list, POST dismiss
- `src/routes/suggestions.ts` — GET list, POST respond
- `src/routes/manual.ts` — POST + GET manual log entries
- `src/index.ts` — Express app wiring all routes; serves built client in production
- `src/tests/migration.test.ts` — Vitest: all tables created, idempotent, CHECK constraints enforced
- `src/tests/github.test.ts` — Vitest: authorKey(), fetchCommits() (merge skip, null login, pagination, patch truncation), fetchIssues() (PR skip, milestone mapping)

### client/
- `package.json` — React + TypeScript + Vite + Sass + react-router-dom
- `tsconfig.json` + `tsconfig.node.json`
- `index.html`
- `vite.config.ts` — Vite dev server on 5173 with `/api` proxy to 3001
- `src/main.tsx` — React entry point
- `src/App.tsx` — BrowserRouter with Connect route
- `src/styles/_variables.scss` — brand palette and typography tokens
- `src/styles/global.scss` — CSS reset + Google Fonts import
- `src/pages/Connect/Connect.tsx` — placeholder page

**Milestone 1 acceptance criteria status:**
- [x] npm install at root installs all workspaces
- [x] server dev starts on port 3001
- [x] client dev starts on port 5173 with /api proxy
- [x] POST /api/teams + GET /api/teams/:id implemented
- [x] Migration creates all tables in the data model
- [x] POST sync fetches paginated commits (file list, 200-line patch), skips merges, auto-creates members, persists contributions; fetches Issues with milestone due_on
- [x] sync never crashes on commit with no GitHub login
- [x] GITHUB_TOKEN from .env only, never in DB
- [x] .env.example complete
- [x] TypeScript compiles in both workspaces
- [x] Vitest tests for migration and GitHub mapping logic
- [x] BOB_LOG.md entries for both sessions

---

## 2026-11-12 — Session 3: Milestone 1 Bug Fixes

**Issues fixed:**

1. **`github.test.ts` regex** — changed both `/page=(\d+)/` occurrences to `/[?&]page=(\d+)/` so `per_page=100` is not falsely matched.
2. **`server/package.json`** — added `"type": "module"` for proper ESM resolution.
3. **TS2339 `req.params.teamId`** — added explicit `Request<TeamParams>` typing to every handler in all five `mergeParams: true` routers (`members`, `contributions`, `tasks`, `risks`, `suggestions`, `manual`).
4. **Test imports** — changed `.ts` extension imports to `.js` in `github.test.ts` and `migration.test.ts`.
5. **Postbuild script** — added `postbuild` to `server/package.json` that copies `src/db/schema.sql` → `dist/db/schema.sql` using ESM-safe `node --input-type=module`.
6. **Client dist path** — changed `path.join(__dirname, '..', '..', '..', 'client', 'dist')` to `path.join(__dirname, '..', '..', 'client', 'dist')` so it resolves correctly from both `src/` (tsx dev) and `dist/` (compiled).
7. **Skip known SHAs** — `fetchCommits` now accepts a `knownShas: ReadonlySet<string>` parameter; `syncTeam` loads all stored SHAs first and passes them in, skipping the per-commit detail fetch for already-stored commits.
8. **Single "Unknown Contributor"** — `syncTeam` now reuses one shared `Unknown Contributor` member per team (via `getUnknownMember` lookup before inserting) instead of inserting a new row each time.
9. **`prNumber` comment** — removed the misleading `// PR association is resolved separately in sync` comment in `github.ts`; `prNumber` is simply `null`.
10. **Manual route validation** — `kind` is now validated against `design|research|meeting|coordination|other`; `task_id` (when provided) is checked to belong to the team before the contribution is inserted.
11. **Sync test** — added `src/tests/sync.test.ts`: two commits from the same email (one with a GitHub login, one without) produce exactly one member row.

**`npm run build` output (server workspace):**

```
> server@1.0.0 build
> tsc

> server@1.0.0 postbuild
> node --input-type=module -e "import{cpSync,mkdirSync}from'fs';mkdirSync('dist/db',{recursive:true});cpSync('src/db/schema.sql','dist/db/schema.sql');"
```

**`npm run build` output (client workspace):**

```
> client@1.0.0 build
> tsc && vite build

vite v5.4.21 building for production...
✓ 35 modules transformed.
dist/index.html                  0.41 kB │ gzip:  0.28 kB
dist/assets/index-BIh1ZDKW.css   0.54 kB │ gzip:  0.34 kB
dist/assets/index-DZACdz-M.js  158.76 kB │ gzip: 51.72 kB
✓ built in 887ms
```

**`npm test` output (server workspace — 20 tests, 3 files):**

```
 RUN  v2.1.9 C:/Users/maesp/FA26/Maestro/server

 ✓ src/tests/github.test.ts (15 tests) 6ms
 ✓ src/tests/sync.test.ts (1 test) 64ms
 ✓ src/tests/migration.test.ts (4 tests) 86ms

 Test Files  3 passed (3)
       Tests  20 passed (20)
    Start at  11:35:27
    Duration  448ms (transform 108ms, setup 0ms, collect 163ms, tests 156ms, environment 0ms, prepare 195ms)
```

---

## 2026-11-13 — Session 4: Milestone 2 — AI Core (xAI Grok)

**Provider change:** switched from watsonx.ai / IBM Granite to xAI's Grok API.

### Files changed / created

| File | Action |
|---|---|
| `docs/PLAN.md` | Updated AI provider description, folder structure, Milestone 2 todos, and Open Decisions to reflect xAI Grok |
| `.env.example` | Replaced `WATSONX_*` vars with `XAI_API_KEY` + `GROK_MODEL`; `AI_PROVIDER` is now `mock \| grok` |
| `server/src/ai/provider.ts` | **New.** Exports `completeJSON(prompt, zodSchema, schemaName)` and `zodToJsonSchema()`. Grok: `POST https://api.x.ai/v1/chat/completions` with `response_format.json_schema` (strict mode). Mock: deterministic, offline, schema-driven. Retry once on SyntaxError / 5xx / 429 (waits 2 s). Never logs API key. |
| `server/src/ai/classifier.ts` | **New.** One AI call per contribution; input: title + diff_summary + team open tasks (`#N: title`); output: `work_type` (7 values), `substance`, `summary`, `task_number`, `match_confidence`. Writes `classifications` row; writes `task_matches` row only if task_number is a real open task and confidence ≠ low (high→0.9, medium→0.7). Skips already-classified contributions. Never overwrites a hand-set task match. `model_version = grok:<model>:prompt-v1`. Mock uses keyword rules + 4-letter word overlap for matching. |
| `server/src/ingestion/sync.ts` | Added github_login backfill (when member found by email has no login and commit has one). Runs `classifyTeam` at the end of sync. Exports `classified` count in `SyncResult`. |
| `server/src/routes/teams.ts` | Added `POST /api/teams/:teamId/classify` route. |
| `server/src/db/seed.ts` | **New.** Inserts "StudyBuddy" team, Rio/Sam/Priya/Jordan, 6 Issues with due dates, 28 commits + 3 Priya manual entries (31 total). Sam: 11 backend commits (overloaded). Jordan: 3 test commits only. Issue #12 "Auth flow": due in 7 days, last commit 7 days ago. Priya: 3 manual entries (meeting, research, design). Runs classifier. Script is idempotent (skips if team exists). |
| `server/src/ai/eval/commits.csv` | **New.** 30 hand-labeled commits with `expected_work_type` and `expected_substance`. |
| `server/src/ai/eval/run.ts` | **New.** `npm run eval` — reads CSV, runs mock classifier, prints work_type and substance accuracy + misses list. |
| `server/src/tests/ai.test.ts` | **New.** 13 Vitest tests: mock provider validity + determinism, `zodToJsonSchema` enum/nullable, retry on invalid JSON (fake fetch), retry on 5xx, classifier skips classified rows, task_number not in list → no match, valid task_number + high confidence → match, seed produces ≥25 contributions, Jordan < Sam commits, Priya has 3 manual entries. |
| `server/package.json` | Added `"seed"` and `"eval"` scripts. Added `zod` dependency. |

### `npm test` output (4 files, 33 tests)

```
 RUN  v2.1.9 C:/Users/maesp/FA26/Maestro/server

 ✓ src/tests/github.test.ts (15 tests) 6ms
 ✓ src/tests/sync.test.ts (1 test) 18ms
 ✓ src/tests/migration.test.ts (4 tests) 26ms
 ✓ src/tests/ai.test.ts (13 tests) 79ms

 Test Files  4 passed (4)
       Tests  33 passed (33)
    Start at  11:47:35
    Duration  443ms (transform 147ms, setup 0ms, collect 265ms, tests 130ms, environment 0ms, prepare 209ms)
```

### `npm run build` output (server workspace)

```
> server@1.0.0 build
> tsc

> server@1.0.0 postbuild
> node --input-type=module -e "import{cpSync,mkdirSync}from'fs';mkdirSync('dist/db',{recursive:true});cpSync('src/db/schema.sql','dist/db/schema.sql');"
```

### Mock classifier accuracy (via `npm run eval`)

```
=== Classifier Eval ===
Provider: mock  Model: mock:prompt-v1
Total commits evaluated: 30
work_type  accuracy: 73.3%  (22/30)
substance  accuracy: 40.0%  (12/30)
```

Misses are intentional — the mock is for offline testing, not production accuracy.

---

## 2026-11-13 — Session 5: Milestone 2a Fixes

### Changes

| File | Change |
|---|---|
| `server/src/ai/classifier.ts` | Exported `classifyOne(title, diffSummary, tasks)` pure function (no DB); exported `buildPrompt` and `modelVersion`; `buildPrompt` now wraps commit in `<commit>`/`</commit>` tags with untrusted-data warning; all tasks (open + closed) sent as `#N [open|closed]: title`; `classifyTeam` returns `{ classified, failed }` with per-contribution try/catch; concurrency limiter (max 4 at a time, no new dependency); manual entries classified without AI work_type (kind→design or other, substance=medium, AI summary only); `design` and `other` added to `work_type` enum |
| `server/src/ai/provider.ts` | Throws if `GROK_MODEL` unset when `AI_PROVIDER=grok`; `AbortSignal.timeout(30000)` on every fetch; timeouts treated as retryable |
| `server/src/db/schema.sql` | `work_type` CHECK extended to include `'design'` and `'other'` |
| `server/src/db/migrate.ts` | Incremental migration system (`schema_migrations` table); `migration_001` safely recreates `classifications` with new CHECK constraint for existing databases |
| `server/src/ai/eval/run.ts` | Deleted inline mock copy; imports `classifyOne` and `modelVersion` from `classifier.ts`; prints provider + model at top; `--limit N` flag |
| `server/src/routes/manual.ts` | POST now classifies immediately on insert (no AI work_type, kind→design/other, substance=medium, AI for summary only) |
| `server/src/ingestion/sync.ts` | `SyncResult` now includes `classifyFailed`; destructures `{ classified, failed }` from `classifyTeam` |
| `server/src/routes/teams.ts` | Classify route returns `{ ok, classified, failed }` |
| `server/src/tests/ai.test.ts` | Added prompt injection tests (`buildPrompt` warning present, commit inside tags, injection title not outside tags); updated `work_type` enum in schema; updated all `classifyOne` / `buildPrompt` usages |
| `server/src/tests/migration.test.ts` | Added `schema_migrations` to expected tables; added test that `design` and `other` are accepted by the constraint |
| `BOB_LOG.md` | Corrected Session 4 eval numbers (73.3% / 40.0%); added this Session 5 entry |

### `npm test` output (4 files, 36 tests)

```
 RUN  v2.1.9 C:/Users/maesp/FA26/Maestro/server

 ✓ src/tests/github.test.ts (15 tests) 6ms
 ✓ src/tests/sync.test.ts (1 test) 23ms
 ✓ src/tests/migration.test.ts (5 tests) 34ms
 ✓ src/tests/ai.test.ts (15 tests) 88ms

 Test Files  4 passed (4)
       Tests  36 passed (36)
    Start at  12:02:04
    Duration  509ms (transform 146ms, setup 0ms, collect 334ms, tests 151ms, environment 0ms, prepare 201ms)
```

### `npm run build` output (server workspace)

```
> server@1.0.0 build
> tsc

> server@1.0.0 postbuild
> node --input-type=module -e "import{cpSync,mkdirSync}from'fs';mkdirSync('dist/db',{recursive:true});cpSync('src/db/schema.sql','dist/db/schema.sql');"
```

### `npm run eval -- --limit 5` output (`AI_PROVIDER=mock`)

```
> server@1.0.0 eval
> tsx src/ai/eval/run.ts --limit 5

Migration complete: C:\Users\maesp\FA26\Maestro\dev.db
=== Classifier Eval ===
Provider: mock  Model: mock:prompt-v1
Total commits evaluated: 5
work_type  accuracy: 100.0%  (5/5)
substance  accuracy: 40.0%  (2/5)

Misses (3):
  [substance] "Add user registration endpoint"
    expected: high  got: low
  [substance] "Add unit tests for password validation"
    expected: medium  got: low
  [substance] "Refactor user service to use dependency injection"
    expected: medium  got: low
```

---

## 2026-11-13 — Session 6: Milestone 2b — Substance improvements, diff stats, eval sets

### Changes

| File | Change |
|---|---|
| `server/src/db/schema.sql` | Added `files_changed`, `additions`, `deletions` columns to `contributions` |
| `server/src/db/migrate.ts` | `migration_002`: safe `ALTER TABLE ADD COLUMN` for all three new columns |
| `server/src/ingestion/github.ts` | `fetchCommitDetail` now returns and sums `filesChanged`/`additions`/`deletions`; `GitHubCommitSummary` includes the three new fields |
| `server/src/ingestion/sync.ts` | `insertContribution` persists `files_changed`, `additions`, `deletions` |
| `server/src/db/seed.ts` | All `insertCommit` calls include realistic `filesChanged`/`additions`/`deletions` |
| `server/src/ai/classifier.ts` | `buildPrompt` adds `Size: N files changed, +A / -D lines` inside `<commit>`; expanded substance scale definition (typo/formatting→low, contained fix/small feature→medium, new module/algorithm/suite→high, short diff can still be high); full work_type definitions (esp. `generated` = machine-generated, NOT hand-written config); `sanitizeCommitTag` exported, applied to title and diff before interpolation; `buildPrompt` accepts optional `stats`; `classifyOne` accepts and passes stats; `modelVersion` bumped to `prompt-v2` |
| `server/src/ai/eval/commits.csv` | Added `files_changed`, `additions`, `deletions` columns with realistic values; corrected `expected_substance` for several rows (e.g. single-endpoint additions now `medium`, multi-file features `high`) |
| `server/src/ai/eval/holdout.csv` | **New** — 10 hand-labeled commits in different styles (dark mode toggle, Playwright suite, WebSocket push, Anki export, etc.) |
| `server/src/ai/eval/run.ts` | Loads `files_changed`/`additions`/`deletions` from CSV and passes to `classifyOne`; `--set main\|holdout\|all` flag; reports each set separately with label and commit count |
| `server/src/tests/ai.test.ts` | Added `sanitizeCommitTag` unit tests; added `buildPrompt` sanitization tests for title and diff injection; imports `sanitizeCommitTag` |
| `check-watsonx.mjs` | Already staged as `git rm` (deleted) |

### `npm test` output (4 files, 39 tests)

```
 RUN  v2.1.9 C:/Users/maesp/FA26/Maestro/server

 ✓ src/tests/github.test.ts (15 tests) 6ms
 ✓ src/tests/sync.test.ts (1 test) 24ms
 ✓ src/tests/migration.test.ts (5 tests) 33ms
 ✓ src/tests/ai.test.ts (18 tests) 54ms

 Test Files  4 passed (4)
       Tests  39 passed (39)
    Start at  14:10:50
    Duration  500ms (transform 211ms, setup 0ms, collect 365ms, tests 117ms, environment 0ms, prepare 253ms)
```

### `npm run build` output (server workspace)

```
> server@1.0.0 build
> tsc

> server@1.0.0 postbuild
> node --input-type=module -e "import{cpSync,mkdirSync}from'fs';mkdirSync('dist/db',{recursive:true});cpSync('src/db/schema.sql','dist/db/schema.sql');"
```

### `npm run eval` output (`AI_PROVIDER=mock`)

```
> server@1.0.0 eval
> tsx src/ai/eval/run.ts

Migration complete: C:\Users\maesp\FA26\Maestro\dev.db
=== Classifier Eval ===
Provider: mock  Model: mock:prompt-v2

--- main set (commits.csv) (30 commits) ---
work_type  accuracy: 73.3%  (22/30)
substance  accuracy: 50.0%  (15/30)
Misses (23):
  [substance] "Add user registration endpoint"
    expected: medium  got: low
  [substance] "Add unit tests for password validation"
    expected: medium  got: low
  [substance] "Refactor user service to use dependency injection"
    expected: medium  got: low
  [substance] "Build flashcard deck CRUD API"
    expected: high  got: low
  [substance] "Add integration tests for deck API"
    expected: high  got: low
  [substance] "Implement JWT token refresh endpoint"
    expected: high  got: low
  [substance] "Implement spaced repetition algorithm"
    expected: high  got: low
  [substance] "Add end-to-end tests for login flow"
    expected: medium  got: low
  [work_type] "Extract email validation into shared utility"
    expected: refactor  got: test
  [work_type] "Run ESLint auto-fix on route files"
    expected: formatting  got: fix
  [work_type] "Build study session timer component"
    expected: feature  got: formatting
  [substance] "Build study session timer component"
    expected: high  got: low
  [substance] "Fix memory leak in WebSocket handler"
    expected: medium  got: low
  [work_type] "Add Vitest configuration to server package"
    expected: generated  got: test
  [substance] "Implement progress tracking for study sessions"
    expected: high  got: low
  [substance] "Refactor authentication to separate concerns"
    expected: high  got: low
  [work_type] "Add CHANGELOG entry for v0.3.0"
    expected: docs  got: fix
  [substance] "Build notification system for due cards"
    expected: high  got: low
  [work_type] "Fix CSS specificity conflict in card component"
    expected: fix  got: test
  [work_type] "Generate TypeScript types from OpenAPI spec"
    expected: generated  got: test
  [substance] "Implement bulk card import from CSV"
    expected: high  got: low
  [work_type] "Add rate limit error handling in client fetch wrapper"
    expected: fix  got: feature
  [substance] "Add rate limit error handling in client fetch wrapper"
    expected: medium  got: low

--- holdout set (holdout.csv) (10 commits) ---
work_type  accuracy: 50.0%  (5/10)
substance  accuracy: 50.0%  (5/10)
Misses (10):
  [work_type] "Add dark mode toggle to settings page"
    expected: feature  got: docs
  [substance] "Add dark mode toggle to settings page"
    expected: medium  got: low
  [work_type] "Bump dependency versions in package.json"
    expected: fix  got: feature
  [substance] "Add Playwright end-to-end test suite for dashboard"
    expected: high  got: low
  [work_type] "Inline helper function that was only called once"
    expected: refactor  got: formatting
  [substance] "Implement WebSocket push for real-time card updates"
    expected: high  got: low
  [work_type] "Add contributing guide and code of conduct"
    expected: docs  got: test
  [substance] "Add contributing guide and code of conduct"
    expected: medium  got: low
  [work_type] "Normalise button padding across all pages"
    expected: formatting  got: feature
  [substance] "Implement export-to-Anki feature for decks"
    expected: high  got: low
```

---

## 2026-11-13 — Session 7: Review fixes to Milestone 3a (written with Claude, not IBM Bob)

IBM Bob's trial Bobcoins ran out after Session 6, so these review fixes to Bob's
Milestone 3a code were written by Claude (Anthropic) and applied as a patch.

| File | Change |
|---|---|
| `server/src/ai/reasoner.ts` | Stalled-task levels now depend on the deadline: high if due within 7 days or overdue, medium within 14, low if there is no due date and it has been idle 14+ days; tasks further out are no longer flagged (before: 5 of 6 demo tasks were flagged). Mock/fallback descriptions are built from each risk's facts and name the task, directory and numbers. A failed AI call now falls back to that wording instead of failing the whole sync. More specific mock check-in message. |
| `server/src/routes/summary.ts` | `tasksAtRisk` counts distinct tasks with an active risk (before: it counted risk cards and showed 8 of 6 tasks). |
| `server/src/tests/reasoner-fixes.test.ts` | **New.** 9 regression tests for the fixes above, including the summary route via supertest. |

### `npm test` output

```
 ✓ src/tests/ai.test.ts (18 tests)
 ✓ src/tests/reasoner.test.ts (14 tests)
 ✓ src/tests/github.test.ts (15 tests)
 ✓ src/tests/sync.test.ts (1 test)
 ✓ src/tests/reasoner-fixes.test.ts (9 tests)
 ✓ src/tests/migration.test.ts (5 tests)
      Tests  62 passed (62)
```

### `npm run seed` risks after the fixes (`AI_PROVIDER=mock`)

```
[HIGH]   #12 Auth flow has had no matched activity for 7 days, and it is due in 7 days.
[MEDIUM] #14 Backend API endpoints has had no matched activity for 12 days, and it is due in 10 days.
[MEDIUM] Only one person has changed server/ recently (100% of the last 11 changes). ...
[MEDIUM] Open work is unevenly spread: one teammate holds 2 open tasks, including at least one that is behind, ...
```

## 2026-11-13 — Session 8: Grok reasoner fixes (written with Claude, not IBM Bob)

Found by running `npm run seed` with `AI_PROVIDER=grok`: the reasoner's AI call failed
with "expected array, received string" and fell back to template text.

| File | Change |
|---|---|
| `server/src/ai/provider.ts` | `zodToJsonSchema` now converts arrays (they were silently sent to Grok as `"string"`, so Grok returned strings). Unsupported types now throw instead of being guessed as strings. The mock also handles arrays. |
| `server/src/ai/reasoner.ts` | Pending suggestions are cleared and regenerated on each run (before, every sync added more and stale ones never went away). Suggestions are rejected unless the task is open and currently held by `from_login`, and `from` ≠ `to`. |
| `server/src/tests/reasoner-fixes.test.ts` | Grok round-trip test with a faked API: checks the schema sent has arrays, that Grok's descriptions are stored, and that invalid swaps are rejected. |

### `npm test` output

```
 ✓ src/tests/ai.test.ts (18 tests)
 ✓ src/tests/reasoner.test.ts (14 tests)
 ✓ src/tests/reasoner-fixes.test.ts (12 tests)
 ✓ src/tests/github.test.ts (15 tests)
 ✓ src/tests/sync.test.ts (1 test)
 ✓ src/tests/migration.test.ts (5 tests)
      Tests  65 passed (65)
```

## 2026-11-13 — Session 9: Rebalance suggestion quality (written with Claude, not IBM Bob)

Reviewing the first real Grok run: one suggested swap moved work to a member who already held as
many open tasks as the giver, and rationales claimed skills the profiles did not show.

| File | Change |
|---|---|
| `server/src/ai/reasoner.ts` | **Balance check in code:** a swap is rejected unless the receiver ends with no more open tasks than the giver keeps (counts tracked across swaps in the same run). Prompt now: states the balance rule with examples, shows each member's open-task count, requires specific descriptions (task number, days idle, days until due — now passed as `daysUntilDue`), allows skill claims only from work types and directories, and marks repository text as data, not instructions. Mock rationale no longer claims unshown experience. |
| `server/src/tests/reasoner-fixes.test.ts` | Tests: an unbalancing swap is rejected while a balancing one is kept; the prompt includes open-task counts, `daysUntilDue` and the data-not-instructions note. |

`npm test`: 67 passed (67).
