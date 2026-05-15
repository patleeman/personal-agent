import type { Express } from 'express';

import { logError } from '../middleware/index.js';
import { createSettingsStore } from '../settings/settingsStore.js';
import type { ServerRouteContext } from './context.js';

function publishHostEvent(source: string, payload: unknown): void {
  void import('../extensions/extensionSubscriptions.js')
    .then(({ publishExtensionHostEvent }) => publishExtensionHostEvent(source, payload))
    .catch((error) => {
      logError('extension host event publish failed', { message: error instanceof Error ? error.message : String(error) });
    });
}

export function registerSettingsRoutes(
  router: Pick<Express, 'get' | 'patch'>,
  _context?: Pick<ServerRouteContext, 'getCurrentProfile'>,
): void {
  // GET /api/settings — returns all current values (merged with defaults)
  router.get('/api/settings', (_req, res) => {
    try {
      const store = createSettingsStore();
      res.json(store.read());
    } catch (err) {
      logError('settings read error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/settings/schema — returns the unified schema from all extensions
  router.get('/api/settings/schema', (_req, res) => {
    try {
      const store = createSettingsStore();
      res.json(store.readSchema());
    } catch (err) {
      logError('settings schema error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // PATCH /api/settings — update one or more settings
  router.patch('/api/settings', (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | undefined;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        res.status(400).json({ error: 'Request body must be an object of key-value pairs.' });
        return;
      }
      const store = createSettingsStore();
      const result = store.update(body);
      publishHostEvent('settings', { keys: Object.keys(body), values: result });
      res.json(result);
    } catch (err) {
      logError('settings update error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
}
