/**
 * Daemon routes
 *
 * Handles daemon service lifecycle management (install, start, stop, restart, uninstall).
 */

import type { Express } from 'express';

import { readDaemonState } from '../automation/daemon.js';
import { logError } from '../middleware/index.js';

export function registerDaemonRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.get('/api/daemon', async (_req, res) => {
    try {
      res.json(await readDaemonState());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
