import type { Express } from 'express';
import express from 'express';
import path from 'path';

/**
 * Serve the built Vite client.
 *
 * Call this after the API routes. A path under /api that no route handled
 * stays a JSON 404 — the SPA fallback must not answer it with index.html.
 */
export function serveProductionClient(app: Express, clientDist: string): void {
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}
