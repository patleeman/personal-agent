import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { Express, Request, Response } from 'express';

import { pingDaemon, startBackgroundRun } from '../daemon/index.js';
import {
  invokeExtensionAction,
  listExtensionActionTelemetry,
  reloadExtensionBackend,
  runExtensionSelfTest,
} from '../extensions/extensionBackend.js';
import { listExtensionEventSubscriptions } from '../extensions/extensionEventBus.js';
import {
  buildRuntimeExtension,
  createRuntimeExtension,
  exportRuntimeExtension,
  importRuntimeExtensionBundle,
  snapshotRuntimeExtension,
} from '../extensions/extensionLifecycle.js';
import { getAggregatedBadgeCount } from '../extensions/extensionNotifications.js';
import {
  clearBuildError,
  findExtensionEntry,
  listExtensionCommandRegistrations,
  listExtensionInstallSummaries,
  listExtensionKeybindingRegistrations,
  listExtensionMentionRegistrations,
  listExtensionQuickOpenRegistrations,
  listExtensionSlashCommandRegistrations,
  readExtensionRegistrySnapshot,
  readExtensionSchema,
  setBuildError,
  setExtensionEnabled,
  setExtensionKeybinding,
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
      res.type('text/javascript; charset=utf-8').send(readFileSync(filePath, 'utf-8'));
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

  router.get('/api/extensions/telemetry', (req, res) => {
    try {
      const extensionId = typeof req.query.extensionId === 'string' ? req.query.extensionId : undefined;
      res.json(listExtensionActionTelemetry(extensionId));
    } catch (err) {
      sendRouteError(res, 'extensions telemetry error', err);
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

  router.post('/api/extensions/clean-room-import', async (req, res) => {
    try {
      const body = req.body as { zipPath?: unknown };
      const zipPath = typeof body.zipPath === 'string' && body.zipPath.trim().length > 0 ? body.zipPath.trim() : undefined;
      if (!zipPath) {
        res.status(400).json({ error: 'zipPath is required.' });
        return;
      }

      if (!(await pingDaemon())) {
        res.status(503).json({ error: 'Daemon is not responding. Ensure the desktop app is running.' });
        return;
      }

      const cwd =
        typeof req.body !== 'undefined' && typeof (req.body as Record<string, unknown>).cwd === 'string'
          ? ((req.body as Record<string, unknown>).cwd as string)
          : process.cwd();
      const zipName = zipPath.split(/[\\/]/).pop() ?? zipPath;
      const prompt = [
        'You are a clean-room analysis agent. Your only job is to safely analyze a third-party plugin bundle.',
        '',
        'RULES:',
        '- You ONLY have access to web_fetch and web_search. DO NOT use any other tools.',
        '- Do NOT read, write, or execute any local files.',
        '- Do NOT run any shell commands.',
        '- If you cannot complete the analysis with web tools alone, report what you found and what is missing.',
        '',
        'TASK: Analyze the extension bundle at `' +
          zipPath +
          '` (or the repository it came from) and produce a detailed specification document.',
        '',
        '1. First, try to find the source repository by searching for the bundle name or any identifying metadata.',
        '2. Fetch the repository README, source files, and extension manifest to understand:',
        '   - What the extension does',
        '   - What surfaces/hooks/tools it registers',
        '   - What permissions it requires',
        '   - What external services it calls',
        '3. Scan for security concerns:',
        '   - Suspicious permissions (filesystem, shell, network access)',
        '   - Hardcoded secrets or API keys',
        '   - Network exfiltration patterns',
        '   - Prompt injection vectors',
        '   - Backdoor functionality',
        '4. Generate a clean-room specification that a full agent can use to re-implement the extension from scratch.',
        '',
        'OUTPUT FORMAT:',
        '---SPEC---',
        '[Extension name]',
        '',
        '## Description',
        '[What it does]',
        '',
        '## Surfaces',
        '[Pages, panels, tools, etc.]',
        '',
        '## Permissions required',
        '[List of permissions]',
        '',
        '## Security concerns found',
        "[List of concerns, or 'None identified']",
        '',
        '## Clean-room implementation notes',
        '[What a full agent needs to re-implement this]',
        '',
        '---END SPEC---',
      ].join('\n');

      const result = await startBackgroundRun({
        taskSlug:
          'clean-room-analysis-' +
          zipName
            .replace(/[^a-zA-Z0-9._-]/g, '-')
            .toLowerCase()
            .slice(0, 48),
        cwd,
        agent: { prompt, noSession: true, allowedTools: ['web_fetch', 'web_search'] },
        source: { type: 'app', id: 'extension-manager', filePath: '' },
      });

      if (!result.accepted) {
        res.status(500).json({ error: result.reason ?? 'Could not start clean-room analysis run.' });
        return;
      }

      res.status(201).json({
        ok: true,
        runId: result.runId,
        logPath: result.logPath,
        prompt,
      });
    } catch (err) {
      sendRouteError(res, 'clean-room import error', err);
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

  router.get('/api/extensions/keybindings', (_req, res) => {
    try {
      res.json(listExtensionKeybindingRegistrations());
    } catch (err) {
      sendRouteError(res, 'extensions keybindings error', err);
    }
  });

  router.patch('/api/extensions/keybindings/:extensionId/:keybindingId', (req, res) => {
    try {
      setExtensionKeybinding({
        extensionId: req.params.extensionId,
        keybindingId: req.params.keybindingId,
        ...(Array.isArray(req.body?.keys) ? { keys: req.body.keys } : {}),
        ...(typeof req.body?.enabled === 'boolean' ? { enabled: req.body.enabled } : {}),
        ...(typeof req.body?.reset === 'boolean' ? { reset: req.body.reset } : {}),
      });
      res.json({ ok: true });
    } catch (err) {
      sendRouteError(res, 'extension keybinding update error', err);
    }
  });

  router.get('/api/extensions/slash-commands', (_req, res) => {
    try {
      res.json(listExtensionSlashCommandRegistrations());
    } catch (err) {
      sendRouteError(res, 'extensions slash commands error', err);
    }
  });

  router.get('/api/extensions/mentions', (_req, res) => {
    try {
      res.json(listExtensionMentionRegistrations());
    } catch (err) {
      sendRouteError(res, 'extensions mentions error', err);
    }
  });

  router.get('/api/extensions/quick-open', (_req, res) => {
    try {
      res.json(listExtensionQuickOpenRegistrations());
    } catch (err) {
      sendRouteError(res, 'extensions quick-open error', err);
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
      const document = readExtensionState(req.params.id, (req.params as Record<string, string>)['0']);
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
      res.json(writeExtensionState(req.params.id, (req.params as Record<string, string>)['0'], body.value, { expectedVersion }));
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
      res.json(deleteExtensionState(req.params.id, (req.params as Record<string, string>)['0']));
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
      const status = /not found/i.test(message) ? 404 : /package root/i.test(message) ? 400 : 500;
      logError('extension snapshot error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/extensions/:id/export', (req, res) => {
    try {
      res.status(201).json(exportRuntimeExtension(req.params.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /not found/i.test(message) ? 404 : /package root/i.test(message) ? 400 : 500;
      logError('extension export error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.patch('/api/extensions/:id', async (req, res) => {
    try {
      const entry = findExtensionEntry(req.params.id);
      const summary = listExtensionInstallSummaries().find((extension) => extension.id === req.params.id);
      if (!entry && summary?.status === 'invalid') {
        res.status(400).json({ error: summary.errors?.[0] ?? 'Extension manifest is invalid.' });
        return;
      }
      if (!entry) {
        res.status(404).json({ error: 'Extension not found.' });
        return;
      }
      const enabled = (req.body as { enabled?: unknown }).enabled;
      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled must be a boolean.' });
        return;
      }
      if (!enabled && entry.manifest.id === 'system-extension-manager') {
        res.status(400).json({ error: 'Cannot disable the Extension Manager: this extension is required by the application.' });
        return;
      }
      setExtensionEnabled(entry.manifest.id, enabled);
      const onEnableAction = enabled ? entry.manifest.backend?.onEnableAction : undefined;
      const actionResult = onEnableAction ? await invokeExtensionAction(entry.manifest.id, onEnableAction, {}, context) : undefined;
      res.json({
        ok: true,
        extension: listExtensionInstallSummaries().find((extension) => extension.id === entry.manifest.id),
        ...(actionResult ? { actionResult } : {}),
      });
    } catch (err) {
      sendRouteError(res, 'extension update error', err);
    }
  });

  router.post('/api/extensions/reload', (_req, res) => {
    res.json({ ok: true, reloaded: false, message: 'Runtime manifests are read on demand.' });
  });

  router.post('/api/extensions/:id/build', async (req, res) => {
    try {
      const result = await buildRuntimeExtension(req.params.id);
      clearBuildError(req.params.id);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBuildError(req.params.id, message);
      const status = /not found/i.test(message)
        ? 404
        : /package root|schemaVersion|manifest|contributes|frontend|backend|surfaces|permissions|compile extensions at runtime|prebuild dist\/frontend\.js and dist\/backend\.mjs/i.test(
              message,
            )
          ? 400
          : 500;
      logError('extension build error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/extensions/:id/self-test', async (req, res) => {
    try {
      res.json(await runExtensionSelfTest(req.params.id));
    } catch (err) {
      sendRouteError(res, 'extension self-test error', err);
    }
  });

  router.post('/api/extensions/:id/reload', async (req, res) => {
    try {
      clearBuildError(req.params.id);
      const summary = listExtensionInstallSummaries().find((extension) => extension.id === req.params.id);
      if (summary?.status === 'invalid') {
        res.status(400).json({ error: summary.errors?.[0] ?? 'Extension manifest is invalid.' });
        return;
      }
      const entry = findExtensionEntry(req.params.id);
      if (!entry?.manifest.backend?.entry) {
        res.json({ ok: true, id: req.params.id, reloaded: false, message: 'Runtime manifests are read on demand.' });
        return;
      }
      const result = await reloadExtensionBackend(req.params.id);
      res.json({
        ok: true,
        id: req.params.id,
        reloaded: true,
        message: result.rebuilt ? 'Extension backend rebuilt.' : 'Extension backend reloaded.',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = /compile extensions at runtime|prebuilt backend bundle/i.test(message) ? 400 : 500;
      logError('extension reload error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(status).json({ error: message });
    }
  });

  // ── Inter-extension event bus ────────────────────────────────────────

  router.get('/api/extensions/events/subscriptions', (_req, res) => {
    try {
      res.json(listExtensionEventSubscriptions());
    } catch (err) {
      sendRouteError(res, 'extension event subscriptions error', err);
    }
  });

  // ── Inter-extension action listing ───────────────────────────────────

  router.get('/api/extensions/actions', (_req, res) => {
    try {
      const summaries = listExtensionInstallSummaries()
        .filter((extension) => extension.status === 'enabled' && (extension.backendActions?.length ?? 0) > 0)
        .map((extension) => ({
          extensionId: extension.id,
          extensionName: extension.name,
          actions: (extension.backendActions ?? []).map((action) => ({
            id: action.id,
            title: action.title,
            description: action.description,
          })),
        }));
      res.json(summaries);
    } catch (err) {
      sendRouteError(res, 'extension actions list error', err);
    }
  });

  // ── Extension status check ──────────────────────────────────────────

  router.get('/api/extensions/:id/status', (req, res) => {
    try {
      const entry = findExtensionEntry(req.params.id);
      const summary = listExtensionInstallSummaries().find((e) => e.id === req.params.id);
      if (!entry && !summary) {
        res.json({ enabled: false, healthy: false, error: 'Extension not found.' });
        return;
      }
      const enabled = summary?.status === 'enabled' || (summary?.enabled === true && summary?.status !== 'disabled');
      res.json({
        enabled,
        healthy: enabled && (!summary?.errors || summary.errors.length === 0),
        ...(summary?.errors?.length ? { errors: summary.errors } : {}),
      });
    } catch (err) {
      sendRouteError(res, 'extension status error', err);
    }
  });

  // ── Notification badge state ─────────────────────────────────────────

  router.get('/api/extensions/badge', (_req, res) => {
    try {
      res.json({ aggregated: getAggregatedBadgeCount() });
    } catch (err) {
      sendRouteError(res, 'extension badge error', err);
    }
  });
}
