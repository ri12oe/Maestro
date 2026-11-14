# Maestro

Maestro is the shared view of a student team project. It used to be called Group Project Referee.

A team connects its GitHub repository. Maestro reads commits and Issues, labels each contribution (work type, substance, and a one-line summary), and shows every member the same picture: who did what, which tasks have gone quiet, and a suggested task swap. Off-repo work can be logged. An AI label can be disputed from the member page.

Demo: _coming soon_ (TODO: add Railway URL)

## Screens

- **Setup** (`/`). Connect a repository as `owner/repo` or a GitHub URL, add teammates by GitHub login, and open the project. Teams already in the database are listed on the first step.
- **Overview**. Tasks done, tasks at risk, suggestions waiting, days to the deadline, a contribution map by work type, the top risks, and the first suggested swap.
- **Member evidence**. One member's contribution count, open tasks, work mix, assigned tasks, and each contribution with its AI label, substance, and matched task. Dispute is on the row.
- **Risk radar**. High, medium, and low risk cards with the evidence behind them, and a task progress table.
- **Rebalance**. A pending task swap with the reason and a check-in message. Accept swap, Dismiss, and Undo on an accepted swap.
- **Log work**. Record design, research, meeting, coordination, or other work that is not a commit.
- **Team settings**. The repository, members, and a team deadline. A saved deadline is what risk uses. With no saved deadline, risk uses each task's GitHub milestone due date.

## Stack

`client/` is React, TypeScript, Vite, and Sass. `server/` is Node, TypeScript, and Express. The database is one SQLite file.

AI calls go through `server/src/ai/provider.ts`. `AI_PROVIDER=mock` is deterministic and offline. `AI_PROVIDER=grok` calls the xAI API.

## Run locally

Node.js 22 (`"node": "22.x"` in the root `package.json`). There is no `.nvmrc`.

```bash
cp .env.example .env
npm install
```

Leave the copied `.env` as it is. It lists every variable the server reads: `PORT`, `NODE_ENV`, `DB_PATH`, `AI_PROVIDER`, `XAI_API_KEY`, `GROK_MODEL`, `GITHUB_TOKEN`, `SITE_USER`, and `SITE_PASSWORD`.

`DB_PATH=./dev.db` is the SQLite file at the repo root. A relative path is resolved from the repo root, so the dev server, seed, migrate, and eval open that same file. An absolute path is used as given (`DB_PATH=/data/maestro.db` on Railway). When `DB_PATH` is unset, the file is still `<repo>/dev.db`. Each command prints `Migration complete:` and that path.

`AI_PROVIDER=mock` and `NODE_ENV=development` in the copied file are enough for the demo. The dev server does not serve `client/dist`. The seed does not call GitHub, and it does not read `XAI_API_KEY` or `GROK_MODEL`.

`GITHUB_TOKEN` and `XAI_API_KEY` in the copied file are placeholders, not real credentials. Sync against a real repository needs a read-only personal access token in `GITHUB_TOKEN`. Sync responds with 503 when that variable is unset or empty. Grok needs `AI_PROVIDER=grok`, a real `XAI_API_KEY`, and `GROK_MODEL`.

`PORT` in the copied file is `3001`. `SITE_USER` is `maestro` and `SITE_PASSWORD` is empty, so the password gate stays off.

From the repo root, in two terminals:

```bash
npm run dev:server
npm run dev:client
```

The API listens on port 3001. Vite listens on port 5173 and proxies `/api` to `http://localhost:3001`. Open http://localhost:5173.

## Seed the demo

```bash
npm run seed --workspace=server
```

The command inserts the StudyBuddy team, then runs the classifier and the risk reasoner before it exits. With `AI_PROVIDER=mock` that pipeline stays offline. It is not a separate step.

StudyBuddy has 4 members (Rio, Sam, Priya, Jordan) and 31 contributions (28 commits and 3 manual entries). Issue #12 Auth flow is stalled. Sam is overloaded. The log prints a high risk and a pending suggestion.

Running it again is safe. If StudyBuddy already exists, the command prints that team id and inserts nothing.

Open http://localhost:5173/teams/1, or the id the seed printed. Setup also links to StudyBuddy.

## Tests and eval

```bash
npm test
npm run eval --workspace=server
```

`npm test` runs the server test suite. `npm run eval` is a script in `server/` (the root `package.json` has no `eval` script). It scores the classifier on the hand-labeled commits and prints accuracy and the misses. Mock mode stays offline.

## Production

Deploy is one Railway service: Express serves the built client, and SQLite lives on a volume. The dashboard steps are in [docs/RAILWAY.md](docs/RAILWAY.md).

## More

- [docs/BRIEF.md](docs/BRIEF.md) — concept brief
- [docs/PLAN.md](docs/PLAN.md) — data model, API, and milestones
- [BOB_LOG.md](BOB_LOG.md) — session log
