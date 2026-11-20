import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import healthRouter from './routes/health.js';
import teamsRouter from './routes/teams.js';
import membersRouter from './routes/members.js';
import contributionsRouter from './routes/contributions.js';
import tasksRouter from './routes/tasks.js';
import risksRouter from './routes/risks.js';
import suggestionsRouter from './routes/suggestions.js';
import manualRouter from './routes/manual.js';
import summaryRouter from './routes/summary.js';
import assistantRouter from './routes/assistant.js';
import evalRouter from './routes/eval.js';
import { sitePassword } from './middleware/sitePassword.js';
import { serveProductionClient } from './serveClient.js';
import db from './db/client.js';
import { seedDemoOnStartup } from './db/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ?? 3001;

const app = express();

// Optional password gate (only active when SITE_PASSWORD is set)
app.use(sitePassword());

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/health', healthRouter);
app.use('/api/teams', teamsRouter);
app.use('/api/teams/:teamId/members', membersRouter);
app.use('/api/teams/:teamId/contributions', contributionsRouter);
app.use('/api/teams/:teamId/tasks', tasksRouter);
app.use('/api/teams/:teamId/risks', risksRouter);
app.use('/api/teams/:teamId/suggestions', suggestionsRouter);
app.use('/api/teams/:teamId/manual', manualRouter);
app.use('/api/teams/:teamId/summary', summaryRouter);
app.use('/api/teams/:teamId', assistantRouter);
app.use('/api/eval', evalRouter);

// Serve built client in production
// Works from both src/ (dev/tsx) and dist/ (compiled):
// src/ → server/src/../../client/dist = <repo>/client/dist
// dist/ → server/dist/../../client/dist = <repo>/client/dist
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  serveProductionClient(app, clientDist);
}

// Migrations already ran when the database module loaded. SEED_DEMO=1 inserts
// StudyBuddy into that same file, or skips when the demo's done marker is set.
// A seed error is rolled back and logged. The server still listens.
await seedDemoOnStartup(db);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export { app };
