import type { Express } from 'express';

import { readExtensionRegistrySnapshot, readExtensionSchema } from '../extensions/extensionRegistry.js';
import { logError } from '../middleware/index.js';

export function registerExtensionRoutes(router: Pick<Express, 'get' | 'post'>): void {
  router.get('/api/extensions/schema', (_req, res) => {
    try {
      res.json(readExtensionSchema());
    } catch (err) {
      logError('extensions schema error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/extensions', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().extensions);
    } catch (err) {
      logError('extensions list error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/extensions/routes', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().routes);
    } catch (err) {
      logError('extensions routes error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/extensions/surfaces', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().surfaces);
    } catch (err) {
      logError('extensions surfaces error', { message: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/extensions/reload', (_req, res) => {
    res.json({ ok: true, reloaded: false, message: 'Static system extension registry is current.' });
  });

  router.post('/api/extensions/:id/reload', (req, res) => {
    res.json({ ok: true, id: req.params.id, reloaded: false, message: 'Static system extension registry is current.' });
  });
}
