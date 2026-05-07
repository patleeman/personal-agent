import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { Express, Request, Response } from 'express';

import {
  findExtensionEntry,
  listExtensionInstallSummaries,
  readExtensionRegistrySnapshot,
  readExtensionSchema,
  setExtensionEnabled,
} from '../extensions/extensionRegistry.js';
import { logError } from '../middleware/index.js';

function sendRouteError(res: Response, label: string, err: unknown): void {
  logError(label, { message: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: String(err) });
}

function resolveExtensionFilePath(extensionId: string, relativePath: string): string {
  const entry = findExtensionEntry(extensionId);
  if (!entry?.packageRoot) {
    throw new Error('Extension files are only available for runtime extensions.');
  }

  const packageRoot = resolve(entry.packageRoot);
  const filePath = resolve(packageRoot, relativePath);
  if (filePath !== packageRoot && !filePath.startsWith(`${packageRoot}${sep}`)) {
    throw new Error('Extension file path escapes package root.');
  }

  return filePath;
}

function readExtensionFile(req: Request, res: Response): void {
  try {
    const extensionId = req.params.id;
    const relativePath = req.params[0];
    if (!extensionId || !relativePath) {
      res.status(400).json({ error: 'Extension id and file path are required.' });
      return;
    }

    const filePath = resolveExtensionFilePath(extensionId, relativePath);
    if (!statSync(filePath).isFile()) {
      res.status(404).json({ error: 'Extension file not found.' });
      return;
    }

    if (filePath.endsWith('.html')) {
      res.type('html').send(readFileSync(filePath, 'utf-8'));
      return;
    }
    if (filePath.endsWith('.css')) {
      res.type('css').send(readFileSync(filePath, 'utf-8'));
      return;
    }
    if (filePath.endsWith('.js')) {
      res.type('js').send(readFileSync(filePath, 'utf-8'));
      return;
    }

    res.sendFile(filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not found|ENOENT/i.test(message)) {
      res.status(404).json({ error: 'Extension file not found.' });
      return;
    }
    res.status(400).json({ error: message });
  }
}

export function registerExtensionRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.get('/api/extensions/schema', (_req, res) => {
    try {
      res.json(readExtensionSchema());
    } catch (err) {
      sendRouteError(res, 'extensions schema error', err);
    }
  });

  router.get('/api/extensions/installed', (_req, res) => {
    try {
      res.json(listExtensionInstallSummaries());
    } catch (err) {
      sendRouteError(res, 'extensions installed error', err);
    }
  });

  router.get('/api/extensions', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().extensions);
    } catch (err) {
      sendRouteError(res, 'extensions list error', err);
    }
  });

  router.get('/api/extensions/routes', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().routes);
    } catch (err) {
      sendRouteError(res, 'extensions routes error', err);
    }
  });

  router.get('/api/extensions/surfaces', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().surfaces);
    } catch (err) {
      sendRouteError(res, 'extensions surfaces error', err);
    }
  });

  router.get('/api/extensions/:id/files/*', readExtensionFile);

  router.patch('/api/extensions/:id', (req, res) => {
    try {
      const entry = findExtensionEntry(req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Extension not found.' });
        return;
      }
      if (entry.source === 'system') {
        res.status(400).json({ error: 'System extensions cannot be disabled.' });
        return;
      }
      const enabled = (req.body as { enabled?: unknown }).enabled;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean.' });
        return;
      }
      setExtensionEnabled(entry.manifest.id, enabled);
      res.json({ ok: true, extension: listExtensionInstallSummaries().find((extension) => extension.id === entry.manifest.id) });
    } catch (err) {
      sendRouteError(res, 'extension update error', err);
    }
  });

  router.post('/api/extensions/reload', (_req, res) => {
    res.json({ ok: true, reloaded: false, message: 'Runtime manifests are read on demand.' });
  });

  router.post('/api/extensions/:id/reload', (req, res) => {
    res.json({ ok: true, id: req.params.id, reloaded: false, message: 'Runtime manifests are read on demand.' });
  });
}
