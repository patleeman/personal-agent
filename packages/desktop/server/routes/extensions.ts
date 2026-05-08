import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { Express, Request, Response } from 'express';

import { invokeExtensionAction, reloadExtensionBackend } from '../extensions/extensionBackend.js';
import {
  createRuntimeExtension,
  exportRuntimeExtension,
  importRuntimeExtensionBundle,
  snapshotRuntimeExtension,
} from '../extensions/extensionLifecycle.js';
import {
  findExtensionEntry,
  listExtensionCommandRegistrations,
  listExtensionInstallSummaries,
  listExtensionSlashCommandRegistrations,
  readExtensionRegistrySnapshot,
  readExtensionSchema,
  setExtensionEnabled,
} from '../extensions/extensionRegistry.js';
import { createExtensionRunsCapability } from '../extensions/extensionRuns.js';
import { deleteExtensionState, listExtensionState, readExtensionState, writeExtensionState } from '../extensions/extensionStorage.js';
import { logError } from '../middleware/index.js';
import type { ServerRouteContext } from './context.js';

function sendRouteError(res: Response, label: string, err: unknown): void {
  logError(label, { message: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: String(err) });
}

function resolveExtensionFilePath(extensionId: string, relativePath: string): string {
  const entry = findExtensionEntry(extensionId);
  if (!entry?.packageRoot) {
    throw new Error('Extension files are unavailable for this extension.');
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

export function registerExtensionRoutes(
  router: Pick<Express, 'delete' | 'get' | 'patch' | 'post' | 'put'>,
  context?: Pick<ServerRouteContext, 'getCurrentProfile'>,
): void {
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

  router.post('/api/extensions', (req, res) => {
    try {
      res.status(201).json(createRuntimeExtension(req.body as { id?: unknown; name?: unknown; description?: unknown }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /required|must|already exists/i.test(message) ? 400 : 500;
      logError('extension create error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/extensions/import', (req, res) => {
    try {
      res.status(201).json(importRuntimeExtensionBundle(req.body as { zipPath?: unknown }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /required|not found|unsafe|must|already exists|empty/i.test(message) ? 400 : 500;
      logError('extension import error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.get('/api/extensions/routes', (_req, res) => {
    try {
      res.json(readExtensionRegistrySnapshot().routes);
    } catch (err) {
      sendRouteError(res, 'extensions routes error', err);
    }
  });

  router.get('/api/extensions/:id/manifest', (req, res) => {
    try {
      const entry = findExtensionEntry(req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Extension not found.' });
        return;
      }
      res.json(entry.manifest);
    } catch (err) {
      sendRouteError(res, 'extension manifest error', err);
    }
  });

  router.get('/api/extensions/:id/surfaces', (req, res) => {
    try {
      const entry = findExtensionEntry(req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Extension not found.' });
        return;
      }
      res.json([...(entry.manifest.surfaces ?? []), ...(entry.manifest.contributes?.views ?? [])]);
    } catch (err) {
      sendRouteError(res, 'extension surfaces error', err);
    }
  });

  router.get('/api/extensions/surfaces', (_req, res) => {
    try {
      const snapshot = readExtensionRegistrySnapshot();
      res.json([...snapshot.surfaces, ...snapshot.views]);
    } catch (err) {
      sendRouteError(res, 'extensions surfaces error', err);
    }
  });

  router.get('/api/extensions/commands', (_req, res) => {
    try {
      res.json(listExtensionCommandRegistrations());
    } catch (err) {
      sendRouteError(res, 'extensions commands error', err);
    }
  });

  router.get('/api/extensions/slash-commands', (_req, res) => {
    try {
      res.json(listExtensionSlashCommandRegistrations());
    } catch (err) {
      sendRouteError(res, 'extensions slash commands error', err);
    }
  });

  router.get('/api/extensions/:id/state', (req, res) => {
    try {
      res.json(listExtensionState(req.params.id, typeof req.query.prefix === 'string' ? req.query.prefix : ''));
    } catch (err) {
      sendRouteError(res, 'extension state list error', err);
    }
  });

  router.get('/api/extensions/:id/state/*', (req, res) => {
    try {
      const document = readExtensionState(req.params.id, req.params[0]);
      if (!document) {
        res.status(404).json({ error: 'Extension state document not found.' });
        return;
      }
      res.json(document);
    } catch (err) {
      sendRouteError(res, 'extension state read error', err);
    }
  });

  router.put('/api/extensions/:id/state/*', (req, res) => {
    try {
      const body = req.body as { value?: unknown; expectedVersion?: unknown };
      const expectedVersion =
        typeof body.expectedVersion === 'number' && Number.isSafeInteger(body.expectedVersion) ? body.expectedVersion : undefined;
      res.json(writeExtensionState(req.params.id, req.params[0], body.value, { expectedVersion }));
    } catch (err) {
      const conflict = err instanceof Error && err.message === 'Extension state version conflict.';
      if (conflict) {
        res.status(409).json({ error: err.message, current: (err as Error & { current?: unknown }).current ?? null });
        return;
      }
      sendRouteError(res, 'extension state write error', err);
    }
  });

  router.delete('/api/extensions/:id/state/*', (req, res) => {
    try {
      res.json(deleteExtensionState(req.params.id, req.params[0]));
    } catch (err) {
      sendRouteError(res, 'extension state delete error', err);
    }
  });

  router.post('/api/extensions/:id/runs', async (req, res) => {
    try {
      res.status(201).json(await createExtensionRunsCapability(req.params.id).start(req.body));
    } catch (err) {
      sendRouteError(res, 'extension run start error', err);
    }
  });

  router.get('/api/extensions/:id/files/*', readExtensionFile);

  router.post('/api/extensions/:id/actions/:actionId', async (req, res) => {
    try {
      res.json(await invokeExtensionAction(req.params.id, req.params.actionId, req.body, context));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : 500;
      logError('extension action error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/extensions/:id/snapshot', (req, res) => {
    try {
      res.status(201).json(snapshotRuntimeExtension(req.params.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : /runtime/i.test(message) ? 400 : 500;
      logError('extension snapshot error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/extensions/:id/export', (req, res) => {
    try {
      res.status(201).json(exportRuntimeExtension(req.params.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : /runtime/i.test(message) ? 400 : 500;
      logError('extension export error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

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

  router.post('/api/extensions/:id/reload', async (req, res) => {
    try {
      const entry = findExtensionEntry(req.params.id);
      if (!entry?.manifest.backend?.entry) {
        res.json({ ok: true, id: req.params.id, reloaded: false, message: 'Runtime manifests are read on demand.' });
        return;
      }
      await reloadExtensionBackend(req.params.id);
      res.json({ ok: true, id: req.params.id, reloaded: true, message: 'Extension backend rebuilt.' });
    } catch (err) {
      sendRouteError(res, 'extension reload error', err);
    }
  });
}
