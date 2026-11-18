# Maestro

Maestro is the shared view of a student team project. It used to be called Group Project Referee.

A team connects its GitHub repository. Maestro reads commits and Issues, labels each contribution (work type, substance, and a one-line summary), and shows every member the same picture: who did what, which tasks have gone quiet, and a suggested task swap. Off-repo work can be logged. An AI label can be disputed from the member page.

The StudyBuddy demo is on the public site at https://maestro-production-70bb78b5.up.railway.app. The server seeds it once at startup when `SEED_DEMO=1`, alongside any real teams. The same demo can be run locally. The steps are under [Demo](#demo).

The site is behind a site password (HTTP basic auth via `SITE_USER` and `SITE_PASSWORD`). Judges get the credentials separately.

## Screens

- **Start** (`/`). Your teams, or connect a repository on one screen: paste `owner/repo` or a GitHub URL, Maestro syncs it and fills in the team from commit authors and the deadline from milestones, then you confirm and open it.
- **Today** (`/t/:teamId`). Maestro's short brief on where the project stands, then "Needs the team": each risk and the swap that would fix it on one card, with Accept swap, Copy check-in and Not a problem. Side cards show the team's work mix, this week's activity and what's due soon.
- **Plan** (`/t/:teamId/plan` and `/t/:teamId/plan/:issue`). Every task with a deadline strip, grouped by at risk, in progress, not started and done. A task opens in a panel with Maestro's note, any suggested swap and the work matched to it.
- **People** (`/t/:teamId/people` and `/t/:teamId/people/:memberId`). The team's work on one scale, alphabetical, and a panel per person with their work mix, contributions, tasks and logged work. "Wrong label?" disputes a label in place.
- **Report** (`/t/:teamId/report`). The record for peer evaluations: team activity by week and each person's completed tasks, notable work and off-repo work. Off until anyone on the team turns it on in Settings. Export PDF prints it.
- **Maestro** (`/t/:teamId/maestro`). What the AI labeled, disputes, changes still waiting for a label, and how Maestro decides.
- **Settings** (`/t/:teamId/settings` and `/t/:teamId/settings/:section`). Members, team deadline, the report switch, theme, and deleting the team.
- **Log work** is available from anywhere: the sidebar button, the mobile **+**, or the `L` key.

`/teams/:teamId/*` redirects into `/t/:teamId` (`members/:id` goes to `/people/:id`, `settings` goes to `/settings`, and `log` goes to `?log=1`). Any other path redirects to `/`.

### Maestro AI

- **Ask Maestro.** Ask in plain words from the sidebar, the Today page or ⌘K ("What's blocking #12?", "What has Priya worked on?"). Answers use only the team's commits, Issues and logged work, and every answer links to its sources.
- **Deadline check.** On Today. The verdict (on track, tight, behind) is arithmetic: open tasks against days left and the recent pace of closing tasks. Maestro then writes up to three next steps about specific tasks.
- **Week in review.** On Today. What moved, what shipped, what's stuck and what's next, with a button to copy it for the group chat.

The same guardrails apply to all three. Maestro never ranks, grades or compares people, and it never guesses why someone was quiet. Questions like "who's the laziest?" are refused before any model call. Sources the model cites are checked against real data, and commit messages are passed to the model as data, not instructions. The deadline check and week in review are cached until the team's data changes. With `AI_PROVIDER=mock` they return template text built from the same facts.

### Keyboard

`⌘K` / `Ctrl K` search and commands · `L` log work · `S` sync · `G` then `T` `P` `E` `R` `M` `S` to go to Today, Plan, People, Report, Maestro or Settings · `/` search tasks on Plan · `[` `]` previous and next task · `⌘\` collapse the sidebar.

### Design

Dark is the default; light and system themes are in Settings and the team menu. Amber is reserved for Maestro: the bulb and text the AI wrote. Each device can pick "I'm Rio" once, which adds a Mine filter and fills in who did logged work; it never changes what anyone sees.

## Stack

`client/` is React, TypeScript, Vite, Tailwind CSS v4 and lucide-react icons. `server/` is Node, TypeScript, and Express. The database is one SQLite file.

AI calls go through `server/src/ai/provider.ts`. `AI_PROVIDER=mock` is deterministic and offline. `AI_PROVIDER=grok` calls the xAI API.

## Run locally

Node.js 22 (`"node": "22.x"` in the root `package.json`). There is no `.nvmrc`.

```bash
cp .env.example .env
npm install
```

Leave the copied `.env` as it is. It lists every variable the server reads: `PORT`, `NODE_ENV`, `DB_PATH`, `AI_PROVIDER`, `XAI_API_KEY`, `GROK_MODEL`, `GITHUB_TOKEN`, `SITE_USER`, `SITE_PASSWORD`, and `SEED_DEMO`.

`DB_PATH=./dev.db` is the SQLite file at the repo root. A relative path is resolved from the repo root, so the dev server, seed, migrate, and eval open that same file. An absolute path is used as given (`DB_PATH=/data/maestro.db` on Railway). When `DB_PATH` is unset, the file is still `<repo>/dev.db`. Each command prints `Migration complete:` and that path.

`AI_PROVIDER=mock` and `NODE_ENV=development` in the copied file are enough to run locally. `SEED_DEMO` is commented out, so the dev server does not insert StudyBuddy on startup. The dev server does not serve `client/dist`. The seed does not call GitHub, and it does not read `XAI_API_KEY` or `GROK_MODEL`.

`GITHUB_TOKEN` and `XAI_API_KEY` in the copied file are placeholders, not real credentials. Sync against a real repository needs a read-only personal access token in `GITHUB_TOKEN`. Sync responds with 503 when that variable is unset or empty. Grok needs `AI_PROVIDER=grok`, a real `XAI_API_KEY`, and `GROK_MODEL`.

`PORT` in the copied file is `3001`. `SITE_USER` is `maestro` and `SITE_PASSWORD` is empty, so the password gate stays off.

From the repo root, in two terminals:

```bash
npm run dev:server
npm run dev:client
```

The API listens on port 3001. Vite listens on port 5173 and proxies `/api` to `http://localhost:3001`. Open http://localhost:5173.

From the repo root:

```bash
npm run lint
npm test
```

`npm run lint` runs ESLint in `server/` and then in `client/`. `npm test` runs the server test suite, then the client test suite.

## Demo

StudyBuddy is on the public site, seeded once via `SEED_DEMO=1`, and it can also be run locally. On the public site the seed runs at startup against the server's SQLite file, with the mock provider, and it leaves other teams alone. A second start finds StudyBuddy and inserts nothing.

Locally, `SEED_DEMO` stays commented, so the dev server does not seed on startup. The copied `.env` sets `AI_PROVIDER=mock` and `DB_PATH=./dev.db` (resolved from the repo root). From the repo root, in two terminals:

```bash
npm run dev:server
npm run dev:client
```

`npm run dev:server` runs the server workspace `dev` script (`tsx watch src/index.ts`). `npm run dev:client` runs Vite. The API listens on port 3001. Vite listens on port 5173 and proxies `/api` to `http://localhost:3001`.

Seed that local database:

```bash
npm run seed --workspace=server
```

That is the server `seed` script, `tsx src/db/seed.ts`. It inserts the StudyBuddy team, then runs the classifier and the risk reasoner before it exits. With `AI_PROVIDER=mock` that pipeline stays offline. It is not a separate step.

StudyBuddy has 4 members (Rio, Sam, Priya, Jordan) and 31 contributions (28 commits and 3 manual entries). Issue #12 Auth flow is stalled. Sam is overloaded. The log prints a high risk and a pending suggestion.

The team id is not fixed. SQLite assigns it on insert. A new row prints `Created team StudyBuddy (id=N)` and, when the run finishes, `Team id: N`. If StudyBuddy is already in the file, the command prints `StudyBuddy team already exists (id=N). Skipping seed.` and inserts nothing.

Open http://localhost:5173/t/N with that id. Start at http://localhost:5173 lists StudyBuddy and links to the same path.

## Tests and eval

```bash
npm test
npm run eval --workspace=server
```

`npm test` runs the server test suite, then the client test suite. `npm run eval` is a script in `server/` (the root `package.json` has no `eval` script). It scores the classifier on the hand-labeled commits and prints accuracy and the misses. Mock mode stays offline.

## Production

Deploy is one Railway service: Express serves the built client, and SQLite lives on a volume. The dashboard steps are in [docs/RAILWAY.md](docs/RAILWAY.md).

## More

- [docs/BRIEF.md](docs/BRIEF.md) — concept brief
- [docs/PLAN.md](docs/PLAN.md) — data model, API, and milestones
- [BOB_LOG.md](BOB_LOG.md) — session log
