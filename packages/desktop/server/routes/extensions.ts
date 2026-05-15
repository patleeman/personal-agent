import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';

import type { Express, Request, Response } from 'express';

import { pingDaemon, startBackgroundRun } from '../daemon/index.js';
import {
  invokeExtensionAction,
  invokeExtensionRoute,
  listExtensionActionTelemetry,
  reloadExtensionBackend,
  runExtensionSelfTest,
} from '../extensions/extensionBackend.js';
import { validateExtensionPackage } from '../extensions/extensionDoctor.js';
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
  findExtensionCommandRegistration,
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
import { publishAppEvent } from '../shared/appEvents.js';
import type { ServerRouteContext } from './context.js';

async function readExtensionInstallSummariesWithRuntimeState() {
  const summaries = listExtensionInstallSummaries();
  const { listRunningExtensionServices } = await import('../extensions/extensionServices.js');
  const running = new Map(listRunningExtensionServices().map((service) => [`${service.extensionId}:${service.serviceId}`, service]));
  return summaries.map((summary) => ({
    ...summary,
    serviceStatuses: (summary.services ?? []).map((service) => {
      const status = running.get(`${summary.id}:${service.id}`);
      return { id: service.id, running: Boolean(status), startedAt: status?.startedAt ?? null };
    }),
  }));
}

function isHostCommandAction(action: string): boolean {
  return (
    action === 'app.navigate' ||
    action === 'palette.open' ||
    action === 'rail.open' ||
    action === 'layout.set' ||
    action === 'conversation.new' ||
    action === 'conversation.open' ||
    action === 'composer.focus' ||
    action.startsWith('navigate:') ||
    action.startsWith('commandPalette:') ||
    action.startsWith('rightRail:') ||
    action.startsWith('layout:')
  );
}

function sendRouteError(res: Response, label: string, err: unknown): void {
  logError(label, { message: err instanceof Error ? err.message : String(err) });
  res.status(500).json({ error: String(err) });
}

function normalizeDependencyId(dependency: string | { id: string; optional?: boolean }): { id: string; optional: boolean } {
  return typeof dependency === 'string'
    ? { id: dependency, optional: false }
    : { id: dependency.id, optional: Boolean(dependency.optional) };
}

function normalizeRouteQuery(query: Request['query']): Record<string, string | string[]> {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === 'string') normalized[key] = value;
    else if (Array.isArray(value)) normalized[key] = value.filter((item): item is string => typeof item === 'string');
  }
  return normalized;
}

async function dispatchExtensionBackendRoute(
  req: Request,
  res: Response,
  context?: Pick<ServerRouteContext, 'getCurrentProfile'>,
): Promise<void> {
  try {
    const extensionId = req.params.id;
    const routePath = `/${req.params[0] ?? ''}`;
    const result = await invokeExtensionRoute(
      extensionId,
      req.method,
      routePath,
      {
        method: req.method,
        path: routePath,
        query: normalizeRouteQuery(req.query),
        params: {},
        body: req.body,
      },
      context,
    );
    for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value);
    res.status(result.status ?? 200).json(result.body ?? null);
  } catch (err) {
    sendRouteError(res, 'extension backend route error', err);
  }
}

function findMissingRequiredDependencies(extensionId: string): string[] {
  const installed = new Set(listExtensionInstallSummaries().map((extension) => extension.id));
  const entry = findExtensionEntry(extensionId);
  return (entry?.manifest.dependsOn ?? [])
    .map(normalizeDependencyId)
    .filter((dependency) => !dependency.optional && !installed.has(dependency.id))
    .map((dependency) => dependency.id);
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
  router.get('/api/extensions/:id/routes/*', (req, res) => dispatchExtensionBackendRoute(req, res, context));
  router.post('/api/extensions/:id/routes/*', (req, res) => dispatchExtensionBackendRoute(req, res, context));
  router.put('/api/extensions/:id/routes/*', (req, res) => dispatchExtensionBackendRoute(req, res, context));
  router.patch('/api/extensions/:id/routes/*', (req, res) => dispatchExtensionBackendRoute(req, res, context));
  router.delete('/api/extensions/:id/routes/*', (req, res) => dispatchExtensionBackendRoute(req, res, context));

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

  router.get('/api/extensions/installed', async (_req, res) => {
    try {
      res.json(await readExtensionInstallSummariesWithRuntimeState());
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
        '- You ONLY have access to web_fetch, exa_search, and duckduckgo_search. DO NOT use any other tools.',
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
        agent: { prompt, noSession: true, allowedTools: ['web_fetch', 'exa_search', 'duckduckgo_search'] },
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

  router.post('/api/extensions/commands/:commandId/execute', async (req, res) => {
    try {
      const command = findExtensionCommandRegistration(req.params.commandId);
      if (!command) {
        publishAppEvent({ type: 'extension_command', command: req.params.commandId, args: req.body ?? {} });
        res.json({ ok: true, result: true });
        return;
      }
      if (isHostCommandAction(command.action)) {
        publishAppEvent({ type: 'extension_command', command: command.action, args: req.body ?? command.args ?? {} });
        res.json({ ok: true, result: true });
        return;
      }
      const result = await invokeExtensionAction(command.extensionId, command.action, req.body ?? command.args ?? {}, context);
      res.json({ ok: true, result });
    } catch (err) {
      sendRouteError(res, 'extension command execute error', err);
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
      if (enabled) {
        const missingDependencies = findMissingRequiredDependencies(entry.manifest.id);
        if (missingDependencies.length > 0) {
          res.status(400).json({ error: `Missing required extension dependencies: ${missingDependencies.join(', ')}` });
          return;
        }
      }
      setExtensionEnabled(entry.manifest.id, enabled);
      if (!enabled) {
        const { stopExtensionServices } = await import('../extensions/extensionServices.js');
        await stopExtensionServices(entry.manifest.id);
      }
      const onEnableAction = enabled ? entry.manifest.backend?.onEnableAction : entry.manifest.backend?.onDisableAction;
      const actionResult = onEnableAction ? await invokeExtensionAction(entry.manifest.id, onEnableAction, {}, context) : undefined;
      if (enabled) {
        const { startExtensionServices } = await import('../extensions/extensionServices.js');
        await startExtensionServices(context);
      }
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

  router.post('/api/extensions/:id/validate', async (req, res) => {
    try {
      const report = await validateExtensionPackage({ extensionId: req.params.id });
      res.status(report.ok ? 200 : 400).json(report);
    } catch (err) {
      sendRouteError(res, 'extension validate error', err);
    }
  });

  router.post('/api/extensions/validate', async (req, res) => {
    try {
      const body = req.body as { id?: unknown; extensionId?: unknown; packageRoot?: unknown };
      const extensionId = typeof body.extensionId === 'string' ? body.extensionId : typeof body.id === 'string' ? body.id : undefined;
      const packageRoot = typeof body.packageRoot === 'string' ? body.packageRoot : undefined;
      const report = await validateExtensionPackage({ extensionId, packageRoot });
      res.status(report.ok ? 200 : 400).json(report);
    } catch (err) {
      sendRouteError(res, 'extension validate error', err);
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
