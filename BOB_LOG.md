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

## 2026-11-13 — Session 10: Visible rejections + rule-based fallback (written with Claude, not IBM Bob)

With the balance check in place, a real Grok run produced good risk descriptions but no
suggestions, with no way to tell why.

| File | Change |
|---|---|
| `server/src/ai/reasoner.ts` | Suggestion validation moved into `insertSuggestions()`. Every rejected swap is logged with its reason (e.g. `rejected AI swap #15 sam-builds → rio-dev: unbalancing: rio-dev would hold 2 vs sam-builds 1`). If an overload risk exists and none of the AI's swaps pass, the rule-based swap is used instead — through the same checks. |
| `server/src/tests/reasoner-fixes.test.ts` | Test: an AI that only proposes an unbalancing swap gets it rejected (and logged), and the rule-based swap to the member with no open tasks is stored. |

`npm test`: 68 passed (68).

## 2026-11-13 — Session 11: First names in suggestion text (written with Claude, not IBM Bob)

| File | Change |
|---|---|
| `server/src/ai/reasoner.ts` | Prompt asks for first names (not logins) in rationale and check-in messages. Safety net: `loginsToNames()` replaces any login that still appears (including `@login`) with the member's first name before saving; longer logins are replaced first, and words that merely contain a login are left alone. |
| `server/src/tests/reasoner-fixes.test.ts` | 3 tests for `loginsToNames()`. |

`npm test`: 71 passed (71).

## 2026-11-13 — Session 12: Milestone 3b — React foundations, Overview, Member evidence (written with Claude, not IBM Bob)

| Area | Change |
|---|---|
| `client/src/api/` | Typed API client (`client.ts`) and response types (`types.ts`). |
| `client/src/hooks/useApi.ts` | Small data-loading hook with loading / error / reload. |
| `client/src/components/` | `Layout` (dark sidebar from the UI draft; compact row on phones; Overview stays highlighted on member pages), shared UI pieces (`ui.tsx`: page header, cards, stat cards, pills, risk-level badges, loading / error / empty states, buttons), `ContributionMap` (one stacked bar per member on a shared substance-weighted scale, alphabetical, with a text equivalent for screen readers). |
| `client/src/pages/Overview/` | Stat cards, contribution map, top two risks, first pending swap suggestion. |
| `client/src/pages/MemberEvidence/` | Work mix, every contribution with its AI label, substance, matched task, size and GitHub link; "Wrong label?" opens a dispute form (optional note) and the row then shows "Label disputed". |
| `client/src/pages/ComingSoon/`, `Connect/` | Placeholders for Risk radar, Rebalance, Log work and team setup (Milestone 3c). |
| `client/src/workTypes.ts`, `styles/_variables.scss` | Work-type categories and colours (distinct in lightness, not hue alone); design tokens from the UI draft. |
| `server/src/routes/summary.ts` | Adds `team`, and per member `totalWeight`, `contributionCount`, `openTasks`. |
| `server/src/routes/risks.ts`, `suggestions.ts`, `contributions.ts` | Risks include the task and parsed evidence; suggestions include names, task details, parsed rationale and open-task counts; contributions include the matched task and dispute note. |

**Checked in a real browser** (headless Chrome, desktop 1280px and phone 390px) against the seeded demo: no console errors; flagging a label saves `disputed = 1` with the note in the database and updates the row.

`npm test`: 71 passed (71). `npm run build`: client and server build cleanly.

## 2026-11-13 — Session 13: Milestone 3c — Risk radar, Rebalance, Log work, Connect (written with Claude, not IBM Bob)

| Area | Change |
|---|---|
| `client/src/pages/RiskRadar/` | Risk cards (level, task, due label, plain-language description, what the risk is based on), Dismiss, "See suggested swaps" only where a swap can help; task progress table (owner, last activity, matched changes, due, status). |
| `client/src/pages/Rebalance/` | Each pending swap: task and due date, From → To with open-task counts before → after, "Why this swap", Accept / Discuss / Dismiss with a confirmation, and an editable check-in message with Copy. |
| `client/src/pages/LogWork/` | Form (who, type, title, details, related task, link) with validation; recently logged list. |
| `client/src/pages/Connect/` | Team setup: accepts `owner/repo` or a GitHub URL, creates the team and runs the first sync with progress; on failure shows the reason with Retry sync (no duplicate team). Fairness promise; list of existing teams. |
| `client/src/` (shared) | API client additions, `dates.ts` (due / ago labels), form-field styles moved to `ui.scss`, phone fixes (compact nav keeps its natural height; stacked swap boxes with a down arrow), Vite uses the modern Sass compiler (no deprecation warnings). |
| `server/src/routes/teams.ts` | `GET /api/teams`; sync explains a missing token and GitHub 404 / 401 / 403 errors in plain words (`explainSyncError`). |
| `server/src/routes/tasks.ts` | Tasks include owner name, matched-work count and last activity, ordered by due date. |
| `server/src/routes/manual.ts` | Logging work re-runs risk detection in the background. |
| `server/src/tests/routes-3c.test.ts` | **New.** 7 tests for the endpoints above. |

**Checked in a real browser** (headless Chrome, 1280px and 390px) against the seeded demo: dismissing a risk removes it; accepting a swap reassigns #14 to Jordan in the database; Copy puts the check-in message on the clipboard; logging work saves it, and the background risk refresh cleared #12's stalled risk because the entry was linked to it; Connect rejects a malformed repo and shows the missing-token message with Retry sync. No console errors besides the intentional failed sync.

`npm test`: 78 passed (78). `npm run build`: client and server build cleanly.

## 2026-11-13 — Session 14: First real GitHub sync (written with Claude, not IBM Bob)

Synced the real `ri12oe/Maestro` repository end to end through the API (16 commits,
2 authors, ~6 s, no errors). Two problems found and fixed:

| File | Change |
|---|---|
| `server/src/ingestion/sync.ts` | `files_changed`, `additions`, `deletions` used `|| null`, so a commit that only deletes lines stored "unknown" instead of 0. Now `?? null`. |
| `server/src/ai/classifier.ts` | Offline mock labeled every real commit "test" because it keyword-searched the diff text. Now the title decides first (keywords at word starts, so "latest" ≠ "test"), then the changed file paths (all test files → test, all docs → docs), else feature. Mock eval work_type: 73.3% → 83.3% on the main set. |

Not yet tested against real data: GitHub Issues and milestone due dates (the Maestro repo has none).

## 2026-11-13 — Session 15: Re-linking, Sync now, bots (written with Claude, not IBM Bob)

| File | Change |
|---|---|
| `server/src/ai/classifier.ts` | `rematchNewTasks()`: commits that are still unlinked are checked against Issues created after they were classified (only the new Issues are sent; up to 200 commits per sync; a failed AI call is retried next sync). Each commit records the highest task id it was checked against (`match_checked_task_id`). |
| `server/src/ingestion/sync.ts` | Runs re-linking after classification, records `teams.last_synced_at`, returns `relinked`. Skips commits from automation accounts (`…[bot]` logins such as dependabot). |
| `server/src/ingestion/github.ts` | `isBotAuthor()`. |
| `server/src/db/migrate.ts`, `schema.sql`, `seed.ts` | migration_004: `contributions.match_checked_task_id`, `teams.last_synced_at`, `teams.is_demo` (set for the seeded StudyBuddy team). |
| `server/src/routes/summary.ts` | `team.lastSyncedAt`, `team.isDemo`. |
| `client/src/pages/Overview/` | "Sync now" button with "Synced 3 min ago" and a result note (new contributions, tasks, older commits linked to new Issues); the demo team shows "Demo data — not connected to GitHub" instead. |
| `server/src/tests/rematch.test.ts`, `github.test.ts` | 4 re-linking tests, 7 bot-detection tests. |

**Checked against the real `ri12oe/Maestro` repo** in a browser: Sync now pulled 17 commits and the 4 real Issues with milestone due dates; 9 commit→Issue links, all sensible; "#4 Write deployment guide for Railway" flagged HIGH (no matched work, due in 5 days).

`npm test`: 89 passed (89).

## 2026-11-13 — Session 16: Client redesign (written with Grok bots, not IBM Bob)

Commits `5df1853` and `41a3258`. The Connect page is gone; setup and the dashboard shell follow the dark Figma tokens. No server changes. This work is from Nov 13, before the sessions below. Session 29 replaces these dark tokens with the brief's light palette, and sessions 19 and 20 store an editable team deadline.

| Area | Change |
|---|---|
| `client/src/pages/Connect/` | Removed `Connect.tsx` and `Connect.scss` (repo form, first sync, existing-team list, and the "Our fairness promise" sidebar). |
| `client/src/pages/Setup/` | New `/` flow in four steps: connect `owner/repo` or a GitHub URL (`POST /api/teams`, then sync, with retry), choose where the plan lives, invite teammates, then open the team. Existing teams still come from `GET /api/teams`. The plan-source choice stays in component state and is not sent to the API. |
| `client/src/pages/TeamSettings/` | New `/teams/:teamId/settings`: repository and last sync, add/remove members, deadline taken from task due dates. |
| `client/src/App.tsx`, `client/index.html` | `/` renders Setup; `settings` route added. Document title is Maestro. |
| `client/src/api/client.ts` | `addMember` and `removeMember` for the setup and settings forms. |
| `client/src/components/Bulb.tsx` | SVG mascot with states `default`, `thinking`, `happy`, and `done`, plus `LogoMark` in the setup dialog and the sidebar. |
| `client/src/components/Layout.tsx` | Shared page frame: top bar keeps "Sync now", sidebar wordmark uses `LogoMark`, Risk radar shows the active risk count, and Team settings is the last nav item. |
| `client/src/styles/_variables.scss`, `global.scss` | Dark tokens (background `#09090B`, accent `#E8A93A`) and the Geist font. Replaces Space Grotesk and the brief blue `#1F5FBF` that the contribution categories used before. |
| Dashboard pages, `workTypes.ts` | Overview, Member evidence, Risk radar, Rebalance, and Log work updated onto that shell. Work-type colours come from the CSS variables. On a contribution row, substance `low` reads "Minor" and `medium` / `high` read "Substantial". |
| `.claude/launch.json` | Dev launch config for the server on port 3001 and the client on port 5173. |

## 2026-11-14 — Session 17: Undo an accepted rebalance suggestion (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

`POST /api/teams/:teamId/suggestions/:suggestionId/respond` with `{ status: "pending" }` sets an accepted suggestion back to pending. Accept is the only response that changes anything else: it sets the task's `assignee_login` to the receiving member. Undo puts that login back to the member who held the task (`from_login`). If the task is no longer assigned to the receiver, undo returns 409 and leaves both rows alone. A suggestion that is not accepted returns 400; an unknown id returns 404. The Rebalance screen is unchanged.

| File | Change |
|---|---|
| `server/src/routes/suggestions.ts` | Undo path on the existing respond route. |
| `server/src/tests/suggestions-undo.test.ts` | Accept then undo, plus the 400 / 404 / 409 cases. |
| `docs/PLAN.md` | Suggestions respond row notes the pending status. |

`npm test`: 102 passed (102). `npx tsc --noEmit` exited 0.

## 2026-11-14 — Session 18: Undo link on an accepted swap (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

The Rebalance confirmation for an accepted swap now has an underlined Undo link. It calls the existing respond route with `{ status: "pending" }`. On success the suggestion card is pending again and open-task counts reload, so the owner shown on Risk radar and the member page is the original assignee. If the server refuses (including the 409 when the task was reassigned), that error string is shown in the card and the confirmation stays. The accepted confirmation is kept while you move around the app, so you can check the new owner and still undo.

| File | Change |
|---|---|
| `client/src/api/client.ts` | `respond` accepts every suggestion status, including `pending`. |
| `client/src/pages/Rebalance/Rebalance.tsx` | Undo link, inline error, reload after success. |
| `client/src/pages/Rebalance/Rebalance.scss` | Link sits in the confirmation line; error wraps under it. |

The client has no test runner. Checked in the browser against the seeded StudyBuddy team: accept #14, Undo returns the pending card (Sam 2 open, Jordan 0), and Risk radar plus Sam's assigned tasks show Sam again. A reassigned task shows the server's 409 message in the card and leaves the rows unchanged.

`npm run build --workspace=client` succeeded. `npm test --workspace=server`: 102 passed (102). No server changes.

## 2026-11-14 — Session 19: Stored team deadline (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

A team can store its own deadline. `PATCH /api/teams/:teamId` with `{ deadline: "YYYY-MM-DD" }` sets it and `{ deadline: null }` clears it. Anything else returns 400; an unknown team returns 404. `GET /api/teams/:teamId` reads it back (`deadline` is null until set). Stalled-task risk uses that date whenever it is set, and otherwise each task's GitHub milestone `due_date`, as before. Milestone dates stay on the tasks. The client is unchanged.

| File | Change |
|---|---|
| `server/src/db/schema.sql` | Nullable `teams.deadline` (`YYYY-MM-DD`). |
| `server/src/db/migrate.ts` | migration_005 adds the column on existing databases. Rows stay; the new value is null. |
| `server/src/routes/teams.ts` | `PATCH /api/teams/:teamId` validates and stores the date. |
| `server/src/ai/reasoner.ts` | Stalled-task level uses the stored deadline when one is set. |
| `server/src/tests/team-deadline.test.ts` | Set, read, clear, 400, 404, milestone override, migration on a database that lacks the column. |
| `docs/BRIEF.md`, `docs/PLAN.md` | Deadline precedence, the new column, and the route. |

`npm test` (in `server/`): 115 passed (115). `npx tsc --noEmit` exited 0.

## 2026-11-14 — Session 20: Editable team deadline (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Team settings can set or clear the deadline stored in session 19. The date field shows the date in effect: the team's stored deadline when one is set, otherwise the latest GitHub milestone due date. Save sends `PATCH /api/teams/:teamId`. Clear sends `{ deadline: null }`. If the server rejects the change, its error is shown under the field. Overview uses the same rule and a short note of where the date came from.

A save also calls the existing `POST /api/teams/:teamId/classify` route, which reruns the reasoner, and then the pages re-read. Risk cards pick up the new deadline. That route also refreshes pending suggestions, as it already did.

| File | Change |
|---|---|
| `client/src/deadline.ts` | Shared rule: stored deadline, otherwise the latest milestone date. |
| `client/src/api/client.ts`, `client/src/api/types.ts` | `team`, `setDeadline`, and `classify`. |
| `client/src/pages/TeamSettings/` | Date input, Save, Clear, and the server's error. |
| `client/src/pages/Overview/Overview.tsx` | Days to deadline uses the shared rule. |
| `client/src/components/Layout.tsx` | `reload` re-reads every page after the reasoner runs. |

The client has no test runner. Checked in the browser against the seeded StudyBuddy team: the field starts on Dec 9, from milestones. Saving Nov 20 shows that date on Overview ("set by the team"); stalled risks then say due in 6 days, and #14 moves from medium to high. Clear puts Overview back on Dec 9 and restores those risk levels. A rejected PATCH shows `deadline must be YYYY-MM-DD or null` under the field.

`npm run build --workspace=client` succeeded. `npm test --workspace=server`: 115 passed (115). No server changes.

## 2026-11-14 — Session 21: Demo seed scenario (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Milestone 4, todo 1. `npm run seed` with `AI_PROVIDER=mock` on a fresh database still builds the StudyBuddy demo, and a second run skips it. The seed data did not need a change. `seedStudyBuddy(today)` takes the clock the reasoner already accepts, so the new test does not depend on the calendar day. The test also accepts a suggestion and undoes it, and stores a near deadline then clears it; the scenario still holds and `teams.deadline` stays null after seeding.

Fresh database, `AI_PROVIDER=mock`, clock = the day it was run (2026-11-14):

| Check | Required | Actual |
|---|---|---|
| Demo teams (`StudyBuddy`, `is_demo = 1`) | 1 | 1 |
| Members | 4 | 4 (Rio, Sam, Priya, Jordan) |
| Contributions | ≥ 20 | 31 (28 commits + 3 manual) |
| Stalled open tasks (no matched work in 5 days) | ≥ 1 | 5 |
| Overloaded members (≥2 open tasks, one at risk, someone else has none) | ≥ 1 | 1 (Sam; Jordan has no open tasks) |
| High risks | ≥ 1 | 1 (#12 Auth flow, due in 7 days) |
| Pending rebalance suggestions | ≥ 1 | 1 (#14 Sam → Jordan) |
| Stored deadline | null after seed | null |

`npx tsc --noEmit` (in `server/`) exited 0.

`npm test` (in `server/`):

```
 Test Files  12 passed (12)
      Tests  119 passed (119)
   Start at  21:28:30
   Duration  1.25s
```

## 2026-11-14 — Session 22: Production client serving (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Milestone 4, todo 2. `railway.json` builds with `npm run build` and starts with `npm start`. After `npm ci`, that build succeeds. With `NODE_ENV=production`, `PORT=3999`, `AI_PROVIDER=mock`, and `DB_PATH` pointing at a folder that does not exist yet, the server listens on 3999, creates the folder, and runs the migration (all tables, through migration_005).

`/` and `/teams/1` return the built `index.html`. `/assets/index-CWCFJZmA.js` is `application/javascript` and matches the file on disk. `/api/teams` is JSON (`[]` on an empty database).

Unmatched `/api` paths were the break. `GET /api/does-not-exist` returned `index.html` with 200, and `POST` returned Express's HTML 404. Those now return `{"error":"Not found"}`. There was no `db-folder-fix.patch` on this checkout; `migrate.ts` already creates a missing database directory, and boot confirmed that.

| File | Change |
|---|---|
| `server/src/serveClient.ts` | Static files, SPA fallback, and a JSON 404 for unmatched `/api`. |
| `server/src/index.ts` | Production still serves `client/dist` through that helper. |
| `server/src/tests/production-client.test.ts` | Vitest/supertest against a fixture dist folder. |

`npx tsc --noEmit` (in `server/`) exited 0. `npm run build --workspace=client` succeeded.

`npm test` (in `server/`):

```
 Test Files  13 passed (13)
      Tests  124 passed (124)
   Start at  21:33:48
   Duration  2.34s
```

## 2026-11-14 — Session 23: Railway setup guide (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Milestone 4, todo 3, done-pending-deploy. `docs/RAILWAY.md` is the dashboard setup: create the service, mount a volume at `/data`, set `DB_PATH=/data/maestro.db`, set every variable `server/src` reads, then curl `/`, `/teams/1`, `/api/teams`, and an unknown `/api` path. The demo seed runs inside the container with `node server/dist/db/seed.js`.

`railway.json` is unchanged. It already sets the Railpack builder, `npm run build`, `npm start`, and restart policy `ON_FAILURE`. Railway's config schema does not create a volume. A healthcheck path was left unset: with `SITE_PASSWORD` set, every route returns 401, and Railway only treats a 2xx as healthy. A new Railway service does not read `railway.json` (config-as-code cutoff 2026-12-01), so the guide tells you to copy those settings into the service.

No deploy, and no secrets.

## 2026-11-14 — Session 24: README (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Milestone 4, todo 6. Added `README.md`: what Maestro is (it used to be called Group Project Referee), the seven screens that exist (Setup, Overview, Member evidence, Risk radar, Rebalance, Log work, Team settings), the client/server/SQLite stack and the mock-or-grok provider, local setup, the StudyBuddy seed, `npm test` and `npm run eval --workspace=server`, a placeholder demo URL, and a pointer to `docs/RAILWAY.md`. `docs/PLAN.md` marks todo 6 done. No secrets.

The copied `.env.example` sets `DB_PATH=./dev.db`. On a clean clone that left the line set, `npm run seed --workspace=server` wrote `server/dev.db` (31 contributions, 0 classifications, no risks) while `npm run dev:server` served `<repo>/dev.db`. The API opens SQLite before it reads `.env`, and the seed's working directory is `server/`. The README says to comment that line out. With it commented out, both use `<repo>/dev.db`.

Commands on a clean clone of this branch, mock mode, after commenting out `DB_PATH`:

| Command | Result |
|---|---|
| `node -v` | `v22.23.4`. No `.nvmrc`. |
| `cp .env.example .env`, then comment out `DB_PATH` | `AI_PROVIDER=mock`. Placeholders only. |
| `npm install` | 246 packages added, exit 0. |
| `npm run dev:server` | `Migration complete: <repo>/dev.db`. Listening on port 3001. |
| `npm run dev:client` | Vite ready at `http://localhost:5173/`. `/api` proxied to 3001. |
| `npm run seed --workspace=server` | StudyBuddy id 1. 4 members, 31 contributions, 31 classifications. High risk: #12 Auth flow. Pending suggestion: #14 Sam Rivera → Jordan Lee. |
| same command again | `StudyBuddy team already exists (id=1). Skipping seed.` |
| Open `http://localhost:5173/teams/1` | Overview rendered: Demo data, 0 of 6 tasks done, 2 at risk, 1 suggestion, the high risk, and the swap. Setup lists StudyBuddy. |
| `npm test` | 13 files, 124 passed. |
| `npm run eval --workspace=server` | mock, `prompt-v2`, main set 30 commits. work_type 83.3% (25/30), substance 50.0% (15/30). |
| `npm run eval` (repo root) | Missing script. Eval is only in `server/`. |

One database file after the seed: `<repo>/dev.db`. The demo rows were still there after the tests.

## 2026-11-14 — Session 25: One SQLite file for the copied .env (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Copying `.env.example` to `.env` left `DB_PATH=./dev.db`. The API imported the SQLite client before `dotenv` ran, so it never saw that variable and opened `<repo>/dev.db`. The seed read `.env` afterwards and opened `./dev.db` from its working directory, `server/`. The classifier uses the API client, so that file had 31 contributions and 0 classifications.

`.env` is now loaded before the client opens. A relative `DB_PATH` is resolved from the repo root. An absolute path is unchanged (`DB_PATH=/data/maestro.db` on Railway). When `DB_PATH` is unset, the file is still `<repo>/dev.db`. The README no longer says to comment the line out.

| File | Change |
|---|---|
| `server/src/loadEnv.ts` | Loads `<repo>/.env` once, before the database opens. |
| `server/src/db/paths.ts` | `resolveDbPath()`. |
| `server/src/db/client.ts`, `seed.ts`, `migrate.ts`, `index.ts`, `server/src/ai/eval/run.ts` | Load env first and open the resolved path. |
| `server/src/tests/db-path.test.ts` | Relative path, absolute path, and unset. |
| `.env.example`, `README.md`, `docs/RAILWAY.md` | The copied example works with no edits. |

With `cp .env.example .env` and no edits, `npm run dev:server` and `npm run seed --workspace=server` both logged `Migration complete: <repo>/dev.db`. The seed classified 31 contributions and printed the high risk on #12 Auth flow. Overview at `/teams/1` showed that risk and the classified contribution map.

`npx tsc --noEmit` (in `server/`) exited 0. `npm run build --workspace=client` succeeded.

`npm test` (in `server/`, with that `.env` present):

```
 Test Files  14 passed (14)
      Tests  127 passed (127)
   Start at  22:12:40
   Duration  1.29s
```

## 2026-11-14 — Session 26: Secret history audit and a complete .env.example (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Milestone 4 acceptance criterion: no secrets in the repo, and `.env.example` lists every variable the server reads. No history rewrite.

**Scan.** gitleaks 8.30.0, from the repo root:

```
gitleaks detect --source . --log-opts="--all --full-history" --redact
```

It reported 43 commits scanned and no leaks. `git rev-list --all` is 45 commits (32 on main, 13 only on other remote branches). gitleaks skips commits with no additions, which accounts for the gap. A second pass grepped `git log --all -p` across all 45 commits for `ghp_`, `github_pat_`, `xai-`, `sk-`, AWS access-key IDs, private-key blocks, `password=` / `api_key=` / `token=` assignments, Slack tokens, and npm tokens.

No real credential. The hits were placeholders in `.env.example` (`GITHUB_TOKEN`, `XAI_API_KEY`, a commented `SITE_PASSWORD`, and an older `WATSONX_API_KEY` placeholder), test fixtures (`test-key`, `fake-key`, `fake-key-for-test`), and `process.env` reads. Seed and eval sample diffs mention `DATABASE_URL`, `REDIS_URL`, `REFRESH_SECRET`, and `const token =` inside fake commit text. The `sk-` hits are the substring inside the word "task-matching". The only env file ever committed is `.env.example`. No `.env`, `*.db`, `*.db-*`, `dist/`, or `*.patch` path appears in history.

`.gitignore` now also ignores `.env.*` (`.env.example` stays tracked), `*.db-*`, any `dist/` directory, and `*.patch`. `node_modules/` and `*.db` were already ignored.

`.env.example` lists `PORT`, `NODE_ENV`, `DB_PATH`, `AI_PROVIDER`, `XAI_API_KEY`, `GROK_MODEL`, `GITHUB_TOKEN`, `SITE_USER`, and `SITE_PASSWORD`. Copied with no edits it stays in mock mode: `NODE_ENV=development`, `AI_PROVIDER=mock`, `DB_PATH=./dev.db`, empty `SITE_PASSWORD` (the gate stays off), and placeholders that are not tokens. `README.md` and `docs/RAILWAY.md` name the same nine variables. Railway still uses `NODE_ENV=production`, an injected `PORT`, and `DB_PATH=/data/maestro.db`.

`docs/PLAN.md` marks that acceptance criterion done.

With `cp .env.example .env` and no edits, both the dev server and the seed logged `Migration complete: <repo>/dev.db`. The seed classified 31 contributions and printed the high risk on #12 Auth flow. `GET /api/teams/1/summary` showed StudyBuddy, 0 of 6 tasks done, 2 at risk, 1 pending suggestion, and a work-type mix for all four members. Headless Chrome loaded `http://localhost:5173/teams/1`. Overview showed Demo data, that same scoreline, the contribution map (not "no classified work yet"), the high risk on #12 Auth flow, and the swap from Sam Rivera to Jordan Lee. No sign-in prompt.

`npm test` (in `server/`, with that `.env` present):

```
 Test Files  14 passed (14)
      Tests  127 passed (127)
   Start at  22:35:39
   Duration  1.41s
```

`.env` and `dev.db` stayed untracked.

## 2026-11-14 — Session 27: Optional date on a manual log (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Manual log work accepts an optional `date` (`YYYY-MM-DD`). It is stored on the existing `contributions.authored_at` column, at noon UTC, so the calendar day stays put. Omit `date`, or send null, and the row is stamped with the current time, as before. An invalid date or a future date returns 400 and writes nothing. Today is allowed.

The Log work form has a date input that starts on today and sends `date` through `api.logWork`. The server's error is shown under the form. Overview, member evidence, risk radar, and the reasoner were not changed. They already read `authored_at`.

| File | Change |
|---|---|
| `server/src/routes/manual.ts` | Optional `date`, stored on `authored_at`. |
| `server/src/tests/manual-date.test.ts` | No date uses now; a past date is stored; invalid and future dates are 400. |
| `client/src/pages/LogWork/` | Date field on the dark form. |
| `client/src/api/client.ts` | `logWork` accepts `date`. |
| `docs/PLAN.md` | Manual POST row documents `date`. |

Checked in the browser against the seeded StudyBuddy team. Logged "Sketched the deck browser empty state" for Priya Nair on 2026-11-12. The row is `2026-11-12T12:00:00Z`. Member evidence shows Nov 12 on that row, and Last active is "2 days ago". A future date shows `date cannot be in the future` under the form and is not listed.

`npx tsc --noEmit` (in `server/`) exited 0. `npx tsc --noEmit` and `npm run build` (in `client/`) succeeded.

`npm test` (in `server/`):

```
 Test Files  15 passed (15)
      Tests  139 passed (139)
   Start at  22:58:20
   Duration  2.23s
```

`.env` and `dev.db` stayed untracked.

## 2026-11-16 — Session 28: Railway production check and deploy (written with Grok bots, not IBM Bob)

**AI source:** Grok bots (maestro-senior)

The production service was still running a Nov 13 commit, so `main` `d15947c` (PR #18) was deployed. The dashboard build command is `npm run build` and the start command is `npm start`.

Smoke tests passed. `/` and `/teams/1` return 200 HTML. `/api/teams` returns 200 JSON. `/api/does-not-exist` returns 404 JSON. An unauthenticated request returns 401. Data on the `/data` volume was still there after the deploy.

Auto-deploy is not connected. Railway's GitHub app has no access to `ri12oe/Maestro`, so a push to `main` does not deploy. `docs/RAILWAY.md` section 5 is the manual redeploy, and section 4 is the smoke test.

## 2026-11-16 — Session 29: Light palette from the brief (written with Grok bots, not IBM Bob)

**AI source:** Grok bots, maestro-senior

The client tokens followed the dark Figma palette (`#09090B`, gold `#E8A93A`, Geist). They now follow `docs/BRIEF.md`: page `#F6F6F3`, sidebar `#16181D`, accent `#1F5FBF`, risk orange `#A34A06` on `#FDF0E4`, Space Grotesk for headings, Inter for body. Borders, muted text, and the other status colors are light-theme equivalents with WCAG AA contrast on `#F6F6F3`. Sidebar text stays light so it remains readable on `#16181D`.

`docs/PLAN.md` had no "palette mismatch" line. Milestone 3 todo 13 (brand palette and typography) is marked done.

`npm run build` succeeded in both workspaces (`tsc` in each, then the client Vite build). `npm test`: 15 files, 139 passed.

## 2026-11-16 — Session 30: Delete a team (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

`DELETE /api/teams/:teamId` sits next to `PATCH /api/teams/:teamId`. Success is `200 { ok: true }`. An unknown id, and a non-numeric id, return `404 { error: "Team not found" }`, the same body as `GET /api/teams/:teamId`.

One `DELETE FROM teams` removes the row, including `teams.deadline`. Child rows follow the foreign keys already in `schema.sql`: members, tasks, contributions, risks, and suggestions. A manual log's calendar day lives on `contributions.authored_at` (`YYYY-MM-DDT12:00:00Z`), so that row goes with the contribution cascade, and so do its classification and task match. Another team's deadline, suggestion, and dated manual log stay. `schema.sql` and `migrate.ts` are unchanged.

| File | Change |
|---|---|
| `server/src/routes/teams.ts` | `DELETE /api/teams/:teamId` after the deadline PATCH. |
| `server/src/tests/delete-team.test.ts` | Cascade covers a stored deadline, a suggestion, and a dated manual contribution. The other team keeps all three. |

`npm test` (in `server/`): 16 files, 142 passed (142).

## 2026-11-16 — Session 31: Danger zone on Team settings (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Team settings can disconnect the open team. The Danger zone card sits below the Deadline card and calls `DELETE /api/teams/:teamId` from session 30. Disconnect team opens a confirm step: type the team name, then Disconnect. Cancel returns to the first button. Success replaces the history entry and opens Setup at `/`. A failed call shows the server error and stays on the card.

The card uses the light palette tokens. Background is `$surface`, border is `$border`, the button uses `$risk-high-bg` and `$risk-high`, and the hover label is `$surface`. No hard-coded dark colors.

| File | Change |
|---|---|
| `client/src/api/client.ts` | `api.deleteTeam` calls `DELETE /api/teams/:teamId`. |
| `client/src/pages/TeamSettings/TeamSettings.tsx` | Danger zone under Deadline, with the confirm step. |
| `client/src/pages/TeamSettings/TeamSettings.scss` | Light risk tokens on the card and the danger button. |

This branch includes the delete route. Checked in the browser against the seeded StudyBuddy team with `AI_PROVIDER=mock`. Typing StudyBuddy and disconnecting left `GET /api/teams` as `[]`, `GET /api/teams/1` as 404 `{ error: "Team not found" }`, and the browser on Setup at `/` with StudyBuddy absent from the list.

`npm run build` succeeded in both workspaces. `npm test` (in `server/`): 16 files, 142 passed (142).

## 2026-11-16 — Session 32: Milestone status, refreshed (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

The status lines in `docs/PLAN.md` follow the code on main, including the delete route (session 30) and the Danger zone (session 31). Those two sessions do not change a milestone status. A Nov 14 draft of this note is not used. That draft left milestone 3 in progress because the brief colours were not the Sass tokens, and it said milestone 4 had no README, public URL, or volume config. Only the status lines changed. Newer notes in the milestone bodies stay, including milestone 3 todo 13 marked done.

| Milestone | Status |
|---|---|
| 1 Foundations | `[x] done` |
| 2 AI Core | `[x] done` |
| 3 Product / Dashboard | `[x] done`. The brief colours and fonts are the Sass tokens (session 29). |
| 4 Demo-ready | `[ ] in progress`. The seed check, `railway.json`, the volume steps, production static serving, the README, the secrets audit, and a manual deploy of `d15947c` are in place. The README demo link is still a placeholder, and that deploy is from before the light palette. |
| 5 Submit | `[ ] pending` |

## 2026-11-16 — Session 33: Client redesign around Today, Plan, People and Report (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

PR #21, merge `9b4cf4a`. The five dashboard pages are replaced by the Score shell. Routes are `/t/:teamId/...`. Old `/teams/:id/...` links redirect.

Today is Maestro's brief plus one "Needs the team" queue: each risk and its suggested swap share a card (Accept swap, Copy check-in, Not a problem, Undo). Plan is the task list with a deadline strip, filters including Mine, and a task panel. People is the shared-scale work bars and a person panel with in-place disputes. Report is weekly team activity and a per-person record, printable to PDF, and it stays off until the team turns it on. Maestro lists labels, disputes, and changes still waiting for a label. Start is one screen: paste `owner/repo` or a GitHub URL, sync, and the team is filled in from commit authors and the deadline from milestones. Settings keeps members, the deadline, the report switch, theme, and deleting the team.

The shell adds a sidebar, an icon rail, and a mobile tab bar, a command palette (`⌘K` / `Ctrl K`), a Log work sheet (`L`), keyboard navigation (`G` then a letter), and toasts. Each device can pick "I'm <name>" once. Tokens are a warm graphite dark default, plus light and system themes. Amber is reserved for Maestro. daisyUI is gone; styles are CSS variables and Tailwind CSS v4, with lucide-react icons.

`teams.report_enabled` is the team-wide opt-in for that report. migration_006 (`migration_006_teams_report_enabled`) adds the column. Existing rows and new teams start at 0. `PATCH /api/teams/:teamId` accepts `{ report_enabled: true | false }` alongside `{ deadline }`. Either key, or both, may be sent. A report-only patch leaves the deadline alone. A non-boolean `report_enabled`, or a body with neither key, returns 400.

| File | Change |
|---|---|
| `client/src/pages/Today.tsx`, `Plan.tsx`, `People.tsx`, `Report.tsx`, `MaestroPage.tsx`, `Settings.tsx`, `Start.tsx` | New screens. Overview, Member evidence, Risk radar, Rebalance, Log work, Setup, and Team settings are removed. |
| `client/src/app/CommandPalette.tsx`, `LogWorkSheet.tsx`, `Shell.tsx` | Command palette, global log-work sheet, and the new shell. |
| `client/src/styles/theme.css` | Score tokens. |
| `server/src/db/schema.sql`, `server/src/db/migrate.ts` | `teams.report_enabled`, migration_006, default 0. |
| `server/src/routes/teams.ts` | PATCH accepts `report_enabled` with `deadline`. |
| `server/src/tests/team-report.test.ts` | On, off, both keys, 400s, and migration_006 on a database that lacks the column. |

The Danger zone, Undo, the stored deadline, and the log-work date stay. The PR records `npm run build` passing and server tests 150/150. No secrets.

## 2026-11-17 — Session 34: Ask Maestro, the deadline check, and the week in review (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

PR #22, merge `e23e484`. Three AI features on the redesign. The server computes the facts and the verdict. The model only writes sentences about them. No schema change.

| Route | What it is |
|---|---|
| `POST /api/teams/:teamId/ask` | Ask Maestro. Body `{ question }`. Answered from the team's commits, Issues, and logged work, with linked sources. An empty question, or one over 300 characters, returns 400. An unknown team returns 404. More than 20 asks in a minute returns 429. |
| `GET /api/teams/:teamId/digest` | Week in review. Default `days=7` (clamped to 1–30): moved, shipped, stuck, and next. |
| `GET /api/teams/:teamId/plan-check` | Deadline check. Open tasks against days left and the recent pace of closing tasks. Verdict is on track, tight, behind, too early, done, or no deadline. The model adds up to three task-specific next steps. |

When `AI_PROVIDER` is not `grok`, all three return deterministic template text from those facts (`mockAnswer`, `mockPlan`, `mockDigest`). The plan check and the digest also fall back to that template if the provider call fails, and they are cached until the team's data changes. Ranking and comparison questions are refused before any model call. Cited ids are checked against real tasks and contributions. Commit text goes to the model inside `<data>` as untrusted input.

| File | Change |
|---|---|
| `server/src/ai/assistant.ts` | Ask, plan check, and digest, including the mock fallback. |
| `server/src/routes/assistant.ts` | The three routes, mounted at `/api/teams/:teamId`. |
| `server/src/tests/assistant.test.ts` | 24 cases, including a stubbed Grok response. |
| `client/src/app/AskSheet.tsx`, `AiCards.tsx`, `Sources.tsx`, `CommandPalette.tsx`, `client/src/pages/Today.tsx` | Ask sheet, AI cards on Today, the sources list, and an Ask entry in the command palette. |

The PR records `npm run build` passing and server tests 174/174. No secrets.

## 2026-11-17 — Session 35: StudyBuddy demo on the redesigned pages (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

PR #23, merge `efdd5c9`. Docs only (`docs/PLAN.md`). The seed was run again on the new UI with `AI_PROVIDER=mock` (`npm run seed --workspace=server`), which runs the classifier and the risk reasoner, and the app was walked in a browser. Nothing in the app was broken.

| Check | Result |
|---|---|
| Members | 4 (Rio, Sam, Priya, Jordan) |
| Contributions | 31 |
| Stalled task | #12 Auth flow: no matched activity for 7 days, due in 7 days. High risk on Today. Plan lists it under At risk. |
| Overloaded member | Sam holds 2 open tasks. Jordan has 0. Today suggests moving #14 Backend API endpoints from Sam to Jordan. |
| Accept, then Undo | The suggestion returns to pending and #14 returns to Sam. |
| Settings deadline | Saving a date stores it. Use milestone dates clears it. |
| Danger zone | Stays disabled until the team name is typed. Cancel leaves the team in place. |
| Dated log work | An entry dated yesterday shows under Priya as Yesterday. |
| People | Lists the 4 members. |

`npm run build` and the server tests (174) passed.

Milestone 4 todo 1 is marked done with that check. The Milestone 5 demo path now follows the current pages: open the team on Start, Today (the brief, who is carrying the work, and what is due), People (one member's evidence), the high-priority stalled task on Today and on Plan, then the rebalance suggestion on Today (Accept swap, then Undo).

## 2026-11-17 — Session 36: Production deploys of PRs #21 and #22 (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Only `9b4cf4a` (PR #21) and `e23e484` (PR #22) were deployed to production, with manual `railway up` from the repo root. PR #23 (`efdd5c9`) is docs only and was not deployed. Auto-deploy is still not connected. Railway's GitHub app has no access to `ri12oe/Maestro`, so a push to `main` does not deploy. `docs/RAILWAY.md` section 5 is that manual deploy.

Smoke tests passed.

The live site is https://maestro-production-70bb78b5.up.railway.app. It is behind a site password (HTTP basic auth via `SITE_USER` / `SITE_PASSWORD`). Judges get the credentials separately.

## 2026-11-17 — Session 37: Railway config in .railway/railway.ts (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

PR #25, merge `6fa5705`. `.railway/railway.ts` records the production service as Infrastructure as Code. The file exports `partial = "Maestro"`. The service is `Maestro` in project `lucid-courtesy`. The builder is Railpack (`RAILPACK`), the build command is `npm run build`, the build environment is `V3`, and the start command is `npm start`. The restart policy is `ON_FAILURE`. There is one replica in `sfo`, and the private network endpoint is `maestro`. `variables.managed` is `false`, so the file does not write service variables. It does not declare the volume. `package.json` adds the `railway` package as a dev dependency so the CLI can evaluate the file. The production build does not import it.

Cutover was not run. Cutover is `railway config migrate cutover`. `railway.json` stays in the repo. A deploy still reads `railway.json`. Railway does not read `.railway/` on deploy.

| File | Change |
|---|---|
| `.railway/railway.ts` | IaC for the Maestro service: Railpack, `npm run build`, `npm start`, `ON_FAILURE`. |
| `package.json` | `railway` dev dependency. |
| `docs/RAILWAY.md` | The new file, and that cutover is a separate step. |

## 2026-11-17 — Session 38: Public GET /api/health (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

PR #26, merge `6d8ef1c`. `GET /api/health` is a liveness probe. It runs `SELECT 1`. Success is `200` `{ "ok": true }`. A thrown query is `503` `{ "ok": false, "error": "Database check failed" }`. The body does not include the database path, environment values, or secrets. The site-password middleware lets this exact path through with no credentials. When `SITE_PASSWORD` is set, every other path still asks for auth.

`railway.json` sets `deploy.healthcheckPath` to `/api/health`. `.railway/railway.ts` sets `healthcheck` to `/api/health`. Cutover is still not run, so a deploy reads the path from `railway.json`.

`6d8ef1c` was deployed to Railway on 2026-11-17 (deployment `5143d6dd`). The health check passed. Smoke tests passed. That commit is production. It includes the Railway config from session 37 and this probe. Railway is still reading `railway.json`, not `.railway/railway.ts`.

| File | Change |
|---|---|
| `server/src/routes/health.ts` | `GET /api/health`. |
| `server/src/index.ts` | Mounts the route at `/api/health`. |
| `server/src/middleware/sitePassword.ts` | Lets `/api/health` through with no credentials. |
| `server/src/tests/health.test.ts`, `server/src/tests/site-password.test.ts` | The probe status codes and the password exception. |
| `railway.json`, `.railway/railway.ts` | Healthcheck path `/api/health`. |

## 2026-11-18 — Session 39: Seed StudyBuddy on startup (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

The public site cannot run `npm run seed`, because that script uses `tsx` and `tsx` is a dev dependency. `seedDemo(db)` is the same insert as before: if a team named StudyBuddy already exists, it logs that id and inserts nothing; otherwise it creates the team and logs the id. `npm run seed` still opens `DB_PATH`, migrates, calls `seedDemo`, and exits.

`server/src/index.ts` calls `seedDemoOnStartup` after the database module has run migrations, and before `listen`. The call runs only when `SEED_DEMO` is exactly `1`. It forces `AI_PROVIDER=mock` for that call, so the classifier and reasoner make no network calls, then restores the previous provider. Other teams are not modified. A thrown seed is logged and the process still listens. `tsc` emits `dist/db/seed.js`, and `dist/index.js` imports it, so `node dist/index.js` runs the seed without `tsx`.

| File | Change |
|---|---|
| `server/src/db/seed.ts` | `seedDemo(db)`, `seedStudyBuddy` (the CLI), and `seedDemoOnStartup`. |
| `server/src/index.ts` | Calls `seedDemoOnStartup` on the server database after migrations. |
| `server/src/tests/seed-startup.test.ts` | A temp database already has another team. Startup seeding twice creates one StudyBuddy team (4 members, high risk on #12, pending #14 Sam → Jordan) and leaves the other team unchanged. A thrown seed is logged and does not reject. |
| `.env.example` | `SEED_DEMO=1` commented out. |
| `README.md` | StudyBuddy is on the public site (`SEED_DEMO=1`) and can also be run locally. |
| `docs/RAILWAY.md` | `SEED_DEMO` in the variable table, and the startup seed in place of a container shell. |
| `docs/PLAN.md` | The milestone 4 README line now says the demo is on the public site. |

`npm run build` succeeded. `npm test --workspace=server`: 21 files, 200 passed (200). Main had 198. Not deployed.

## 2026-11-18 — Session 40: schema.sql includes every migration column (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

`schema.sql` was missing two columns that later migrations add: `contributions.paths` (migration_003, JSON array of changed file paths) and `contributions.match_checked_task_id` (migration_004, highest task id that commit has been checked against). The other columns migrations add were already in the base schema: `files_changed`, `additions`, `deletions`, `teams.last_synced_at`, `teams.is_demo`, `teams.deadline`, and `teams.report_enabled`. A fresh database built from `schema.sql` alone now has the same columns as one that has run every migration.

`addColumnIfMissing` reads `PRAGMA table_info` and skips `ALTER TABLE` when the column is already there, including when `schema.sql` just created it. A duplicate-column error is still ignored. An older database that lacks the column still gets `ALTER TABLE … ADD COLUMN`, and its rows stay. Migrations already recorded in `schema_migrations` do not run again, so the production volume at `/data/maestro.db` is unchanged.

| File | Change |
|---|---|
| `server/src/db/schema.sql` | `contributions.paths` and `contributions.match_checked_task_id`. |
| `server/src/db/migrate.ts` | Skip `ALTER TABLE` when the column already exists. |
| `server/src/tests/migration.test.ts` | A fresh migrated database matches the expected columns and `schema.sql` alone. A second migrate changes nothing. An older database gains the columns and keeps its rows. |

`npm run build` succeeded. `npm test --workspace=server`: 21 files, 202 passed (202). Main had 200. Not deployed.

## 2026-11-18 — Session 41: Classification summary must be non-empty (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

`ClassificationSchema.summary` is trimmed, then required to contain at least one character. An empty string or a whitespace-only string fails that parse. `completeJSON` already retries a Zod failure once and then throws, so `classifyTeam` and `rematchNewTasks` count the contribution as failed and leave it for the next run. Nothing writes a replacement summary.

The mock classifier still sets `summary` to `${work_type} work: ${title.slice(0, 80)}`, which is never empty. The mock provider still returns `mock-string` for a string field, including this one. `server/src/db/seed.ts` is unchanged. The StudyBuddy scenario tests still pass.

| File | Change |
|---|---|
| `server/src/ai/classifier.ts` | Trim the classification summary and require one or more characters. |
| `server/src/tests/ai.test.ts` | Empty and whitespace-only summaries are rejected. A normal summary passes. The mock summary is non-empty. |

`npm run build` succeeded. `npm test --workspace=server`: 21 files, 205 passed (205). Main had 202. Not deployed.

## 2026-11-18 — Session 42: Today and yesterday follow the local calendar day (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

`daysAgo` was counting elapsed 24-hour blocks. Just after midnight, 23:59 the previous evening was "today". A noon-UTC manual log for yesterday (`YYYY-MM-DDT12:00:00Z`, unchanged in `server/src/routes/manual.ts`) was still "today" for a viewer in the morning in UTC or a US timezone, because fewer than 24 hours had passed.

"Today" is now the same local calendar day, and "yesterday" is the previous one, in the viewer's timezone. Older days stay "N days ago". `shortDate`, `dueLabel`, and `timeAgo` are unchanged.

The client runs these cases with Vitest (`npm test --workspace=client`). No DOM environment. The noon-UTC cases set `process.env.TZ` to America/Indianapolis, America/Chicago, America/Denver, America/Los_Angeles, and UTC.

| File | Change |
|---|---|
| `client/src/dates.ts` | Compare local calendar days in `daysAgo`. |
| `client/src/dates.test.ts` | Midnight, 25-hour, and noon-UTC manual-date cases. |
| `client/package.json` | `test` script and `vitest` devDependency. |

`npm run build` succeeded. `npm test --workspace=server`: 21 files, 205 passed (205). `npm test --workspace=client`: 1 file, 8 passed (8). Not deployed.

## 2026-11-18 — Session 43: ESLint for the client and the server (written with Grok bots, not IBM Bob)

**AI source:** Grok bots

Root `npm run lint` runs the server lint script, then the client lint script. Both use one flat config at the repo root, `eslint.config.js`. The root `package.json` is `"type": "module"` so Node loads that file as ESM. `typescript-eslint` recommended applies to TypeScript in both workspaces. `eslint-plugin-react-hooks` recommended applies to `client/**/*.{ts,tsx}`.

Five rules from that hooks preset flag existing patterns and are off, each with a one-line comment in the config: `set-state-in-effect`, `purity`, `immutability`, `refs`, and `use-memo`. `rules-of-hooks` and `exhaustive-deps` stay on. No hooks-rule violation needed a code change.

`@typescript-eslint/no-unused-vars` reported five unused bindings. Each edit only drops or voids a binding nothing reads:

- `server/src/ai/provider.ts`: the Zod retry catch no longer binds `_parseErr`.
- `server/src/db/seed.ts`: `task12Id` is voided with the other inserted task ids.
- `server/src/tests/ai.test.ts`: the unused counter `n` is gone.
- `server/src/tests/sync.test.ts`: unused `beforeEach` and `afterEach` imports are gone.

The root `test` script now runs the server tests, then the client tests. The README local-run section names `npm run lint` and `npm test`.

| File | Change |
|---|---|
| `eslint.config.js` | Flat config: typescript-eslint recommended, react-hooks on `client/`. |
| `package.json` | `lint` runs both workspaces. `test` runs server, then client. `type` is `module`. ESLint dev dependencies. |
| `server/package.json`, `client/package.json` | `lint` script: `eslint .` |
| `README.md` | Local-run section includes `npm run lint` and `npm test`. |
| `server/src/ai/provider.ts`, `server/src/db/seed.ts`, `server/src/tests/ai.test.ts`, `server/src/tests/sync.test.ts` | Unused bindings removed or voided. |

`npm run lint` passed with no errors. `npm run build` succeeded. `npm test --workspace=server`: 21 files, 205 passed (205). `npm test --workspace=client`: 1 file, 8 passed (8). Not deployed.
