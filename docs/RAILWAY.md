# Railway

Set this up in the Railway dashboard. The steps below are the whole deploy: one service from this repo, one volume, and the variables the server reads.

The server listens on `PORT`, opens the SQLite file at `DB_PATH`, and runs migrations before it accepts requests. With `NODE_ENV=production` it serves the built client from `client/dist`.

## 1. Create the service

Create a project and add a service from the GitHub repo `ri12oe/Maestro`.

`.railway/railway.ts` is the only Railway config in this repo. `railway.json` is deleted. Config as Code (`railway.json` / `railway.toml`) is deprecated. Infrastructure as Code is the replacement, and one service cannot be managed by both. Railway does not read `.railway/` during a deploy. `railway config plan` and `railway config apply` are what send this file. This change does not run either command, and it does not deploy.

The file started as `railway config migrate --show --variables=unmanaged` on the linked production project. The service is `Maestro`. The project is `lucid-courtesy`. The file exports `partial = "Maestro"`. Migrate also wrote the GitHub source, `buildEnvironment: "V3"`, one replica in `sfo`, and the private network endpoint `maestro`. `variables.managed` is `false`, so the file does not write service variables. It does not declare the volume. `deploy.restartPolicyType` and `healthcheck` were added after that migrate output, because migrate does not copy the restart policy. The healthcheck was added the same way, from `railway.json`.

Every field that was in `railway.json` is in `.railway/railway.ts`. Compared on 2026-11-20 against that file, the [Config as Code schema](https://railway.com/railway.schema.json), and the [Infrastructure as Code reference](https://docs.railway.com/infrastructure-as-code/reference). The `railway` package (`ServiceConfigInput`) accepts `start` and `healthcheck` and writes them as `deploy.startCommand` and `deploy.healthcheckPath`.

| `railway.json` | Value there | Field in `.railway/railway.ts` |
|---|---|---|
| `$schema` | `https://railway.com/railway.schema.json` | None. Editor metadata. The `railway` package types check the file. |
| `build.builder` | `RAILPACK` | `build.builder` |
| `build.buildCommand` | `npm run build` | `build.buildCommand` |
| `deploy.startCommand` | `npm start` | `start` |
| `deploy.restartPolicyType` | `ON_FAILURE` | `deploy.restartPolicyType` |
| `deploy.healthcheckPath` | `/api/health` | `healthcheck` |
| `deploy.healthcheckTimeout` | Absent | Absent. The schema leaves it optional. No number was copied. |
| `deploy.restartPolicyMaxRetries` | Absent | Absent |
| `deploy.preDeployCommand` | Absent | Absent |
| `deploy.requiredMountPath` | Absent | Absent |
| `environments` | Absent | Absent |
| Volume mount at `/data` | Absent. Config as Code cannot create a volume. | Absent. The volume stays the dashboard mount. See section 2. |

These fields are in `.railway/railway.ts` and were not in `railway.json`. They stay: GitHub source `ri12oe/Maestro`, `build.buildEnvironment` `V3`, `replicas` `{ sfo: 1 }`, `networking.privateNetworkEndpoint` `maestro`, `partial` `"Maestro"`, project name `lucid-courtesy`, and `variables.managed: false`.

### Cutover before the next deploy

The [migration guide](https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code), checked 2026-11-20, says deleting `railway.json` does not clear the service's stored Config File path, and a service still on that path cannot be planned from `.railway/railway.ts`.

Do this on the linked project before anyone deploys the commit that deletes `railway.json`. This change does not run these commands.

1. If Maestro's service settings still show a Config File path, clear it. The command is `railway config migrate cutover`. The same edit is an empty config-file path in the service settings. Cutover only clears that path, in the linked environment. It does not change the build command, the start command, variables, or volumes. It does not start a deployment. The running deployment stays up. `railway config migrate undo` writes the saved path back from `.railway/.cac-migration.json` and deletes that snapshot. Do not commit the snapshot. A fork that already stored its own path keeps it. A new fork does not copy an empty path, so the builder still auto-detects a root `railway.json` in that fork until the file is gone from the deployed commit.
2. Deploying this commit while that path is still set fails the build. The builder looks for `railway.json` at the stored path and reports that the config file was not found. `railway config plan` also refuses the service until the path is cleared. The error names the service and the path.
3. If the service settings show no config file path, cutover lists nothing, because there is no stored path to clear. The builder was still reading a root `railway.json` and that file overrode the dashboard for the deploy. The file stops being read once it is absent from the deployed commit, or on 2026-12-01, whichever comes first.
4. Railway does not read `.railway/railway.ts` on deploy. After the path is clear, run `railway config plan`, read it, then `railway config apply` so these settings are stored on the service before the next deploy. Applying is what replaces the values Config as Code was overriding. A plan that still names a config file path means the path was not cleared.
5. Apply only a plan whose changes are the settings in the table above. Skip a plan that deletes the volume, the Maestro service, or a variable. This file does not declare the volume. Cutover cannot delete a volume. `railway config apply` can, when the file omits one. `variables.managed` is `false`, so the file does not write service variables. Variable values stay in the dashboard.

`npm run build` builds the client, then the server. `npm start` runs `node dist/index.js` in the server workspace. The root `package.json` asks for Node `22.x`, which Railpack reads from `engines.node`. The `railway` package is a dev dependency so the CLI can evaluate `.railway/railway.ts`. The production build does not import it. The client and server tsconfigs include only their own `src`. Root `npm run lint` ends with `check:railway`, which runs `tsc --noEmit --strict --module nodenext --moduleResolution nodenext .railway/railway.ts` and `eslint .railway/railway.ts`.

On a new service, set the same values in the service settings, including the healthcheck path `/api/health`, or send them with `railway config apply` after the plan is clean. A new service cannot opt into Config as Code. A file icon on the deployment details page means that deploy read `railway.json`. With the file gone from the deployed commit, later deploys have no file to read. The settings stored on the service, from the dashboard or from apply, are what the next deploy uses.

Set the start command even if the build command looks optional. The client is a Vite app. Railpack serves a Vite project as a static site unless a start command is set. `npm start` is the Express server, which is what serves the API and the built pages.

Leave the pre-deploy command empty. The volume is not mounted during pre-deploy. Migrations run in the start command, which is when the volume is mounted.

Generate a public domain from the service's Networking settings. The hostname looks like `your-service.up.railway.app`. The checks below call that host `BASE`.

## 2. Add a volume

The database is one SQLite file. Railway replaces the container disk on every deploy, so a file written on that disk is gone after the next deploy. A volume is the disk that stays.

Add a volume and attach it to this service. The dashboard is where volumes are created: the command palette, or right-click the project canvas. `railway.json` had no volume and no `deploy.requiredMountPath`. `.railway/railway.ts` does not declare a volume either. `requiredMountPath` only checks that a mount is already there, and it was not set. The mount for this service is `/data`, on the volume attachment in the dashboard.

Mount the volume at `/data`.

Set `DB_PATH` to a file inside that mount:

```
DB_PATH=/data/maestro.db
```

On boot the server creates the parent directory if it is missing, then runs migrations and creates the file. With the volume mounted at `/data`, `maestro.db` is on the volume. Saving variables stages a new deploy. Deploy after the volume and `DB_PATH` are both set, before you seed.

If the deploy log says `Created missing database folder`, the path in `DB_PATH` was not on a mounted volume. Data written there will not survive the next deploy.

## 3. Environment variables

Service → Variables. These are the names `server/src` reads with `process.env`, outside tests. Test files only assign the same names for fixtures. `server/src/db/seed.ts` also contains the text `process.env.DATABASE_URL` and `process.env.REDIS_URL` inside sample commit diffs. The server does not read those.

`.env.example` lists the same ten names for a local copy. That file is set up for local mock mode: `NODE_ENV=development`, `PORT=3001`, `DB_PATH=./dev.db`, `AI_PROVIDER=mock`, an empty `SITE_PASSWORD`, `SITE_USER=maestro`, placeholders for `GITHUB_TOKEN` and `XAI_API_KEY`, and `SEED_DEMO` commented out so a local server does not seed. Do not copy those local values into this dashboard. Use the table below. There is no `.env` file on Railway.

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
| `GITHUB_TOKEN` | Optional | Read-only GitHub token used by Sync. Use a fine-grained personal access token whose repository access is public repositories only, with read permission for contents, issues, and pull requests. Do not grant access to private repositories. The demo seed does not call GitHub. Sync responds 503 when the token is missing. A new team is stored only when GitHub says that repository is public. Teams already in the database, including Maestro (`ri12oe/Maestro`) and mira, still sync. Read in `server/src/ingestion/sync.ts`, `server/src/ingestion/github.ts`, and `server/src/routes/teams.ts`. | secret, set in Railway |
| `SITE_PASSWORD` | Optional | When set, pages and API routes ask for HTTP Basic auth. `GET /api/health` stays open so Railway can probe it. Read in `server/src/middleware/sitePassword.ts`. | secret, set in Railway |
| `SITE_USER` | Optional | Basic-auth username, used only when `SITE_PASSWORD` is set. Default `maestro`. Read in `server/src/middleware/sitePassword.ts`. | `maestro` |
| `SEED_DEMO` | Optional | When this is exactly `1`, startup inserts the StudyBuddy demo into `DB_PATH` after migrations, in one transaction with a `demo_seed` done marker. The insert uses the mock provider, so it does not call xAI or GitHub. Startup skips the insert when that marker is already set. A real team named StudyBuddy is left as it is, and the demo is inserted beside it. Other teams are left as they are. If the insert throws, the transaction rolls back, the failure is logged, and the process still listens. The next start tries again. Deleting the demo leaves the marker, so a later start leaves the team absent. Read in `server/src/db/seed.ts`, called from `server/src/index.ts`. | `1` on the public site. Leave unset otherwise. |

`mock` is the provider the StudyBuddy demo was checked with. Use `grok` only when both `XAI_API_KEY` and `GROK_MODEL` are set.

The dashboard variables are what the process sees. Do not commit a real token or API key.

Deploy after the variables are saved.

## 4. Smoke test

`BASE` is the public URL, with no trailing slash, for example `https://your-service.up.railway.app`.

```bash
BASE=https://your-service.up.railway.app

curl -sS -D - "$BASE/api/health"
curl -sS -D - -o /dev/null "$BASE/"
curl -sS -D - -o /dev/null "$BASE/teams/1"
curl -sS -D - "$BASE/api/teams"
curl -sS -D - "$BASE/api/does-not-exist"
```

Expect:

- `GET /api/health` — `200` and `{"ok":true}`. This stays `200` when `SITE_PASSWORD` is set, with no credentials. A database the process cannot query returns `503` and `{"ok":false,"error":"Database check failed"}`.
- `GET /` — `200`, `content-type` contains `text/html`.
- `GET /teams/1` — `200`, `content-type` contains `text/html`. This is the Overview route. The HTML is served even before a team exists.
- `GET /api/teams` — `200` and a JSON array. On an empty database the body is `[]`.
- `GET /api/does-not-exist` — `404` and `{"error":"Not found"}`.

When `SITE_PASSWORD` is set, `/api/health` still returns `200` with no credentials. Add `-u maestro:YOUR_PASSWORD` (or whatever `SITE_USER` is) to the other curls. Those return `401` until the credentials are sent.

### StudyBuddy on the public site

Set `SEED_DEMO=1` and deploy. After migrations, `node dist/index.js` inserts the StudyBuddy team into the same file as `DB_PATH` (`/data/maestro.db` when the volume is mounted at `/data`). The insert is compiled into the server build, so the container does not need `tsx`. It uses the mock provider even when `AI_PROVIDER=grok`, so it does not call xAI or GitHub. The team, its rows, and a `demo_seed` marker (slug `studybuddy`) commit together. The log prints `Created team StudyBuddy (id=N)`.

The public database already has the team the previous seed inserted: id 3, name StudyBuddy, repo `studybuddy-org/studybuddy-app`, `is_demo` 1. `migration_007` writes the marker for that row and logs `Recognized existing StudyBuddy demo (id=3)`. Startup then prints `StudyBuddy demo already seeded (id=3). Skipping seed.` That deploy keeps team 3 as the only StudyBuddy demo.

A later start finds the marker and inserts nothing, including after the demo team is deleted. The marker stays, so the team stays deleted. A real team that is only named StudyBuddy is left as it is, and a missing demo is still inserted beside it. Other teams stay as they are. If the insert throws, the server logs `[seed] SEED_DEMO failed` and `[seed] StudyBuddy demo failed and was rolled back`, and it still listens. The next start tries again, because the marker was not written.

Leaving `SEED_DEMO=1` on later deploys is safe. Unset it when a restart should skip the check.

`/api/teams` then includes StudyBuddy (Rio, Sam, Priya, Jordan, a high risk on issue #12, and a pending suggestion) along with any real teams. Open `$BASE/t/N` for the id the log printed.

`npm run seed --workspace=server` still seeds a local database. It is the same insert, and it still follows `AI_PROVIDER`.

## 5. Deploy a change

This project deploys manually. Railway's GitHub app has no access to `ri12oe/Maestro`, so a push to `main` does not deploy.

`railway redeploy` and the dashboard's Redeploy button rebuild the commit that is already deployed.

After a merge, pull `main` locally and run `railway up` from the repo root with the project linked. That uploads the checked-out code and deploys it. Then run the smoke test in section 4.

The build command is `npm run build` and the start command is `npm start`. `.railway/railway.ts` records those, the Railpack builder, restart policy `ON_FAILURE`, and `healthcheck` `/api/health`. A deploy does not read that file. `railway.json` is deleted. Before this commit is deployed, clear any stored Config File path (`railway config migrate cutover`, or an empty path in the service settings) and apply a plan that keeps the `/data` volume. Section 1 has the full order. This change does not run cutover, plan, or apply.

## What stayed out of the Railway config

`.railway/railway.ts` does not declare the volume. The deleted `railway.json` had no volume and no `deploy.requiredMountPath`. The volume is attached in the dashboard at `/data`. `railway config apply` can delete a volume this file omits. Cutover cannot. Skip a plan that deletes it.

The healthcheck is `/api/health`. Railway calls that URL after start and accepts only a 2xx response. `GET /api/health` runs `SELECT 1` and returns `200` `{"ok":true}`. A thrown query returns `503` `{"ok":false,"error":"Database check failed"}`. That path is the one the site-password middleware allows through with no credentials, so the probe succeeds while `SITE_PASSWORD` is set. `/` and `/api/teams` still return `401` without credentials. `healthcheckTimeout` was not in `railway.json`, so it stays unset.

A volume means the next deploy has a short gap: Railway will not run two deployments on the same volume. Railway marks that deploy healthy only after `GET /api/health` returns 2xx.
