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
