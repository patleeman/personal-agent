/**
 * Daemon routes
 * 
 * Handles daemon service lifecycle management (install, start, stop, restart, uninstall).
 */

import type { Express } from 'express';
import { readDaemonState, updateDaemonPowerAndReadState } from '../automation/daemon.js';
import { logError } from '../middleware/index.js';

/**
 * Register daemon routes on the given router.
 */
function readBooleanBodyField(body: unknown, key: string): boolean {
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>)[key] !== 'boolean') {
    throw new Error(`${key} must be a boolean.`);
  }

  return (body as Record<string, boolean>)[key];
}

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

  router.patch('/api/daemon/power', async (req, res) => {
    try {
      res.json(await updateDaemonPowerAndReadState({
        keepAwake: readBooleanBodyField((req as { body?: unknown }).body, 'keepAwake'),
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}

