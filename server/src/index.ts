import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import teamsRouter from './routes/teams.js';
import membersRouter from './routes/members.js';
import contributionsRouter from './routes/contributions.js';
import tasksRouter from './routes/tasks.js';
import risksRouter from './routes/risks.js';
import suggestionsRouter from './routes/suggestions.js';
import manualRouter from './routes/manual.js';
import summaryRouter from './routes/summary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env from the repo root — works from both src/ (tsx dev) and dist/ (compiled)
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
const PORT = process.env.PORT ?? 3001;

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/teams', teamsRouter);
app.use('/api/teams/:teamId/members', membersRouter);
app.use('/api/teams/:teamId/contributions', contributionsRouter);
app.use('/api/teams/:teamId/tasks', tasksRouter);
app.use('/api/teams/:teamId/risks', risksRouter);
app.use('/api/teams/:teamId/suggestions', suggestionsRouter);
app.use('/api/teams/:teamId/manual', manualRouter);
app.use('/api/teams/:teamId/summary', summaryRouter);

// Serve built client in production
// Works from both src/ (dev/tsx) and dist/ (compiled):
// src/ → server/src/../../client/dist = <repo>/client/dist
// dist/ → server/dist/../../client/dist = <repo>/client/dist
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

export { app };
