# Railway

Set this up in the Railway dashboard. The steps below are the whole deploy: one service from this repo, one volume, and the variables the server reads.

The server listens on `PORT`, opens the SQLite file at `DB_PATH`, and runs migrations before it accepts requests. With `NODE_ENV=production` it serves the built client from `client/dist`.

## 1. Create the service

Create a project and add a service from the GitHub repo `ri12oe/Maestro`.

`railway.json` in the repo root is the record of the build:

| Setting | Value |
|---|---|
| Builder | Railpack (`RAILPACK`) |
| Build command | `npm run build` |
| Start command | `npm start` |
| Restart policy | On failure (`ON_FAILURE`) |

`npm run build` builds the client, then the server. `npm start` runs `node dist/index.js` in the server workspace. The root `package.json` asks for Node `22.x`, which Railpack reads from `engines.node`.

Copy those four settings into the service settings. Railway's docs, checked 2026-11-14, say config-as-code is deprecated: a new service does not read `railway.json`, and services that already use the file stop reading it on 2026-12-01. A file icon on the deployment details page means that deploy did read the file. The settings you type in stay after that date.

Set the start command even if the build command looks optional. The client is a Vite app. Railpack serves a Vite project as a static site unless a start command is set. `npm start` is the Express server, which is what serves the API and the built pages.

Leave the pre-deploy command empty. The volume is not mounted during pre-deploy. Migrations run in the start command, which is when the volume is mounted.

Generate a public domain from the service's Networking settings. The hostname looks like `your-service.up.railway.app`. The checks below call that host `BASE`.

## 2. Add a volume

The database is one SQLite file. Railway replaces the container disk on every deploy, so a file written on that disk is gone after the next deploy. A volume is the disk that stays.

Add a volume and attach it to this service. The dashboard is where volumes are created: the command palette, or right-click the project canvas. Railway's config schema has no field that creates a volume. `deploy.requiredMountPath` only checks that a mount is already there.

Mount the volume at `/data`.

Set `DB_PATH` to a file inside that mount:

```
DB_PATH=/data/maestro.db
```

On boot the server creates the parent directory if it is missing, then runs migrations and creates the file. With the volume mounted at `/data`, `maestro.db` is on the volume. Saving variables stages a new deploy. Deploy after the volume and `DB_PATH` are both set, before you seed.

If the deploy log says `Created missing database folder`, the path in `DB_PATH` was not on a mounted volume. Data written there will not survive the next deploy.

## 3. Environment variables

Service → Variables. These are the names `server/src` reads with `process.env`, outside tests. Test files only assign the same names for fixtures. `server/src/db/seed.ts` also contains the text `process.env.DATABASE_URL` and `process.env.REDIS_URL` inside sample commit diffs. The server does not read those.

Railway injects `PORT`. Leave it unset. The server listens on that value, and falls back to 3001 only when `PORT` is missing.

Railpack also sets `NODE_ENV=production` on the running container, and it still installs dev dependencies for the build (`NPM_CONFIG_PRODUCTION=false`). Set `NODE_ENV` in the dashboard as well, so the value is visible. The server serves the built pages only when it is `production`.

| Variable | Required | What it does | Example |
|---|---|---|---|
| `PORT` | Set by Railway | Port the process listens on. | Leave unset |
| `NODE_ENV` | Required for the site | `production` serves `client/dist`. Any other value serves the API only. Read in `server/src/index.ts`. | `production` |
| `DB_PATH` | Required | SQLite file. Parent directory is created on boot, then migrations run. Read in `server/src/db/client.ts`, `server/src/db/migrate.ts`, `server/src/db/seed.ts`. | `/data/maestro.db` |
| `AI_PROVIDER` | Optional | `mock` (the default) labels work offline. `grok` calls xAI. Read in `server/src/ai/provider.ts`, `server/src/ai/classifier.ts`, `server/src/ai/reasoner.ts`, `server/src/ai/eval/run.ts`, `server/src/routes/manual.ts`. | `mock` |
| `XAI_API_KEY` | Required when `AI_PROVIDER=grok` | Bearer token for `https://api.x.ai`. The server throws if it is missing when a Grok call runs, and it does not log the key. Read in `server/src/ai/provider.ts`. | secret, set in Railway |
| `GROK_MODEL` | Required when `AI_PROVIDER=grok` | Model name sent to xAI and stored on each classification. Read in `server/src/ai/provider.ts` and `server/src/ai/classifier.ts`. | `grok-4.20-0309-non-reasoning` |
| `GITHUB_TOKEN` | Optional | Read-only GitHub token used by Sync. The demo seed does not call GitHub. Sync responds 503 when the token is missing. Read in `server/src/ingestion/sync.ts` and `server/src/routes/teams.ts`. | secret, set in Railway |
| `SITE_PASSWORD` | Optional | When set, every page and API route asks for HTTP Basic auth. Read in `server/src/middleware/sitePassword.ts`. | secret, set in Railway |
| `SITE_USER` | Optional | Basic-auth username, used only when `SITE_PASSWORD` is set. Default `maestro`. Read in `server/src/middleware/sitePassword.ts`. | `maestro` |

`mock` is the provider the StudyBuddy demo was checked with. Use `grok` only when both `XAI_API_KEY` and `GROK_MODEL` are set.

There is no `.env` file on Railway. The dashboard variables are what the process sees. Do not commit a real token or API key.

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

## What stayed out of railway.json

`railway.json` already has the restart policy `ON_FAILURE`. It has no healthcheck path, and none was added. Railway calls a healthcheck URL and accepts only a 2xx response. With `SITE_PASSWORD` set, `/` and `/api/teams` both return 401, and there is no route that stays 200 in that case. A healthcheck on either path would fail a password-protected deploy. A volume also means the next deploy has a short gap anyway: Railway will not run two deployments on the same volume.
