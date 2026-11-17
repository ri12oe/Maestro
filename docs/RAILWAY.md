# Railway

Set this up in the Railway dashboard. The steps below are the whole deploy: one service from this repo, one volume, and the variables the server reads.

The server listens on `PORT`, opens the SQLite file at `DB_PATH`, and runs migrations before it accepts requests. With `NODE_ENV=production` it serves the built client from `client/dist`.

## 1. Create the service

Create a project and add a service from the GitHub repo `ri12oe/Maestro`.

`.railway/railway.ts` is the Infrastructure as Code record of the build. `railway.json` keeps the same four settings until cutover:

| Setting | Value | Field in `.railway/railway.ts` |
|---|---|---|
| Builder | Railpack (`RAILPACK`) | `build.builder` |
| Build command | `npm run build` | `build.buildCommand` |
| Start command | `npm start` | `start` |
| Restart policy | On failure (`ON_FAILURE`) | `deploy.restartPolicyType` |

The service in that file is `maestro`, taken from the live host `maestro-production-70bb78b5.up.railway.app`. `npx @railway/cli@latest config migrate` stopped with `No linked project found. Run railway link to connect to a project`, so it did not read the dashboard service name. The file also exports `partial = "maestro"`. Railway's migration guide writes that export when one Config as Code file maps to one service, so a later apply owns that service and leaves the volume alone. The file does not declare the volume, variables, or a healthcheck.

`railway.json` stays in the repo. The migration guide, checked 2026-11-17, says to delete it only after cutover, which clears the service's Config File path. Cutover was not run. A deploy with that path still set fails if the file is missing from the commit. With no path stored, the builder still reads a root `railway.json` until the file is gone from the deployed commit, or until 2026-12-01. Railway does not read `.railway/` on deploy. `railway config plan` and `railway config apply` are what send the new file. Apply it only after `service("maestro")` matches the dashboard service and the plan leaves the volume in place.

`npm run build` builds the client, then the server. `npm start` runs `node dist/index.js` in the server workspace. The root `package.json` asks for Node `22.x`, which Railpack reads from `engines.node`. The `railway` package is installed so the CLI can evaluate `.railway/railway.ts`.

Copy those four settings into the service settings. Railway's docs, checked 2026-11-17, say config-as-code is deprecated: a new service does not read `railway.json`, and services that already use the file stop reading it on 2026-12-01. A file icon on the deployment details page means that deploy did read the file. The settings you type in stay after that date.

Set the start command even if the build command looks optional. The client is a Vite app. Railpack serves a Vite project as a static site unless a start command is set. `npm start` is the Express server, which is what serves the API and the built pages.

Leave the pre-deploy command empty. The volume is not mounted during pre-deploy. Migrations run in the start command, which is when the volume is mounted.

Generate a public domain from the service's Networking settings. The hostname looks like `your-service.up.railway.app`. The checks below call that host `BASE`.

## 2. Add a volume

The database is one SQLite file. Railway replaces the container disk on every deploy, so a file written on that disk is gone after the next deploy. A volume is the disk that stays.

Add a volume and attach it to this service. The dashboard is where volumes are created: the command palette, or right-click the project canvas. `.railway/railway.ts` does not declare the volume, and `railway.json` cannot create one. `deploy.requiredMountPath` only checks that a mount is already there.

Mount the volume at `/data`.

Set `DB_PATH` to a file inside that mount:

```
DB_PATH=/data/maestro.db
```

On boot the server creates the parent directory if it is missing, then runs migrations and creates the file. With the volume mounted at `/data`, `maestro.db` is on the volume. Saving variables stages a new deploy. Deploy after the volume and `DB_PATH` are both set, before you seed.

If the deploy log says `Created missing database folder`, the path in `DB_PATH` was not on a mounted volume. Data written there will not survive the next deploy.

## 3. Environment variables

Service → Variables. These are the names `server/src` reads with `process.env`, outside tests. Test files only assign the same names for fixtures. `server/src/db/seed.ts` also contains the text `process.env.DATABASE_URL` and `process.env.REDIS_URL` inside sample commit diffs. The server does not read those.

`.env.example` lists the same nine names for a local copy. That file is set up for local mock mode: `NODE_ENV=development`, `PORT=3001`, `DB_PATH=./dev.db`, `AI_PROVIDER=mock`, an empty `SITE_PASSWORD`, `SITE_USER=maestro`, and placeholders for `GITHUB_TOKEN` and `XAI_API_KEY`. Do not copy those local values into this dashboard. Use the table below. There is no `.env` file on Railway.

Railway injects `PORT`. Leave it unset. The server listens on that value, and falls back to 3001 only when `PORT` is missing.

Railpack also sets `NODE_ENV=production` on the running container, and it still installs dev dependencies for the build (`NPM_CONFIG_PRODUCTION=false`). Set `NODE_ENV` in the dashboard as well, so the value is visible. The server serves the built pages only when it is `production`.

| Variable | Required | What it does | Example |
|---|---|---|---|
| `PORT` | Set by Railway | Port the process listens on. | Leave unset |
| `NODE_ENV` | Required for the site | `production` serves `client/dist`. Any other value serves the API only. Read in `server/src/index.ts`. | `production` |
| `DB_PATH` | Required | SQLite file. A relative path is resolved from the repo root. An absolute path is used as given. Parent directory is created on boot, then migrations run. Read in `server/src/db/paths.ts` (client, migrate, and seed). | `/data/maestro.db` |
| `AI_PROVIDER` | Optional | `mock` (the default) labels work offline. `grok` calls xAI. Read in `server/src/ai/provider.ts`, `server/src/ai/classifier.ts`, `server/src/ai/reasoner.ts`, `server/src/ai/eval/run.ts`, `server/src/routes/manual.ts`. | `mock` |
| `XAI_API_KEY` | Required when `AI_PROVIDER=grok` | Bearer token for `https://api.x.ai`. The server throws if it is missing when a Grok call runs, and it does not log the key. Read in `server/src/ai/provider.ts`. | secret, set in Railway |
| `GROK_MODEL` | Required when `AI_PROVIDER=grok` | Model name sent to xAI and stored on each classification. Read in `server/src/ai/provider.ts` and `server/src/ai/classifier.ts`. | `grok-4.20-0309-non-reasoning` |
| `GITHUB_TOKEN` | Optional | Read-only GitHub token used by Sync. The demo seed does not call GitHub. Sync responds 503 when the token is missing. Read in `server/src/ingestion/sync.ts` and `server/src/routes/teams.ts`. | secret, set in Railway |
| `SITE_PASSWORD` | Optional | When set, every page and API route asks for HTTP Basic auth. Read in `server/src/middleware/sitePassword.ts`. | secret, set in Railway |
| `SITE_USER` | Optional | Basic-auth username, used only when `SITE_PASSWORD` is set. Default `maestro`. Read in `server/src/middleware/sitePassword.ts`. | `maestro` |

`mock` is the provider the StudyBuddy demo was checked with. Use `grok` only when both `XAI_API_KEY` and `GROK_MODEL` are set.

The dashboard variables are what the process sees. Do not commit a real token or API key.

Deploy after the variables are saved.

## 4. Smoke test

`BASE` is the public URL, with no trailing slash, for example `https://your-service.up.railway.app`.

```bash
BASE=https://your-service.up.railway.app

curl -sS -D - -o /dev/null "$BASE/"
curl -sS -D - -o /dev/null "$BASE/teams/1"
curl -sS -D - "$BASE/api/teams"
curl -sS -D - "$BASE/api/does-not-exist"
```

Expect:

- `GET /` — `200`, `content-type` contains `text/html`.
- `GET /teams/1` — `200`, `content-type` contains `text/html`. This is the Overview route. The HTML is served even before a team exists.
- `GET /api/teams` — `200` and a JSON array. On an empty database the body is `[]`.
- `GET /api/does-not-exist` — `404` and `{"error":"Not found"}`.

When `SITE_PASSWORD` is set, add `-u maestro:YOUR_PASSWORD` (or whatever `SITE_USER` is) to each curl. Without it, every check returns `401`.

### Seed the demo team

The seed is optional. It inserts the StudyBuddy team (Rio, Sam, Priya, Jordan, 31 contributions, a high risk, and a pending suggestion) and then skips if that team already exists. It reads `DB_PATH` and `AI_PROVIDER` from the environment.

Run it in the deployed container, where `/data` is mounted. Link the project (`railway link`), then:

```bash
railway ssh -- node /app/server/dist/db/seed.js
```

`railway ssh` runs that file on the service. `railway run` runs on your computer, so it would miss the volume. The log prints the team id. On an empty database that id is 1.

Then:

```bash
curl -sS -D - "$BASE/api/teams"
curl -sS -D - "$BASE/api/teams/1"
```

`/api/teams` is a one-element array whose `name` is `StudyBuddy`. `/api/teams/1` is that team. Open `$BASE/teams/1` in a browser for the dashboard. Use the id the seed printed if it is not 1.

With `AI_PROVIDER=mock` the seed stays offline. With `AI_PROVIDER=grok` the same command calls xAI and needs `XAI_API_KEY` and `GROK_MODEL`.

## 5. Deploy a change

This project deploys manually. Railway's GitHub app has no access to `ri12oe/Maestro`, so a push to `main` does not deploy.

`railway redeploy` and the dashboard's Redeploy button rebuild the commit that is already deployed.

After a merge, pull `main` locally and run `railway up` from the repo root with the project linked. That uploads the checked-out code and deploys it. Then run the smoke test in section 4.

The dashboard build command is `npm run build` and the start command is `npm start`. `.railway/railway.ts` records those commands, the Railpack builder, and restart policy `ON_FAILURE`. A deploy does not read that file. `railway.json` is still read until cutover or 2026-12-01, whichever comes first.

## What stayed out of the Railway config

`.railway/railway.ts` and `railway.json` both set restart policy `ON_FAILURE`. Neither has a healthcheck path, and none was added. Railway calls a healthcheck URL and accepts only a 2xx response. With `SITE_PASSWORD` set, `/` and `/api/teams` both return 401, and there is no route that stays 200 in that case. A healthcheck on either path would fail a password-protected deploy. A volume also means the next deploy has a short gap anyway: Railway will not run two deployments on the same volume.
