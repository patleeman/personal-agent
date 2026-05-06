/**
 * Runs routes (app)
 *
 * Handles durable run listing, status, logs, cancel, import, and SSE events.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';

import { getVaultRoot } from '@personal-agent/core';
import { pingDaemon, startBackgroundRun } from '@personal-agent/daemon';
import type { Express } from 'express';

import { PA_CLIENT_JS } from '../apps/pa-client.js';
import {
  cancelDurableRun,
  getDurableRun,
  getDurableRunLog,
  getDurableRunLogCursor,
  listDurableRuns,
  readDurableRunLogDelta,
} from '../automation/durableRuns.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';
import type { ServerRouteContext } from './context.js';

// Lazy-load PA component CSS
let paComponentsCss: string | null = null;
const __dirname = new URL('.', import.meta.url).pathname;
const APPS_DIR = join(__dirname, '..', 'apps');

function getPaComponentsCss(): string {
  if (paComponentsCss === null) {
    try {
      paComponentsCss = readFileSync(join(APPS_DIR, 'pa-components.css'), 'utf-8');
    } catch {
      paComponentsCss = '/* PA components not available */';
    }
  }

  return paComponentsCss;
}

function parseYamlScalar(raw: string | undefined, fallback = ''): string {
  const trimmed = raw?.trim() ?? fallback;
  const quoted = trimmed.match(/^(?:"(.*)"|'(.*)')$/);

  return quoted ? (quoted[1] ?? quoted[2] ?? '') : trimmed;
}

function resolveAppAssetPath(appDir: string, assetPath: string): string | null {
  const trimmed = assetPath.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('\0')) return null;

  const resolved = resolve(appDir, trimmed);
  const appRoot = resolve(appDir);
  return resolved === appRoot || resolved.startsWith(`${appRoot}${sep}`) ? resolved : null;
}

function getImageContentType(filePath: string): string | null {
  switch (extname(filePath).toLowerCase()) {
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return null;
  }
}

const ACTIVE_RUN_POLL_INTERVAL_MS = 1_000;
const IDLE_RUN_POLL_INTERVAL_MS = 5_000;
const ACTIVE_RUN_LOG_POLL_INTERVAL_MS = 250;
const IDLE_RUN_LOG_POLL_INTERVAL_MS = 2_000;

function parseRunLogTail(raw: unknown): number {
  const normalized = typeof raw === 'string' ? raw.trim() : '';
  const parsed = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : undefined;
  return Number.isSafeInteger(parsed) && (parsed as number) > 0 ? Math.min(1000, parsed as number) : 120;
}

function isRunStreamActive(snapshot: { detail: { run: { status?: { status?: string } | string } } }): boolean {
  const runStatus = typeof snapshot.detail.run.status === 'string' ? snapshot.detail.run.status : snapshot.detail.run.status?.status;

  return runStatus === 'queued' || runStatus === 'waiting' || runStatus === 'running' || runStatus === 'recovering';
}

function getRunStreamPollInterval(snapshot: { detail: { run: { status?: { status?: string } | string } } }): number {
  return isRunStreamActive(snapshot) ? ACTIVE_RUN_POLL_INTERVAL_MS : IDLE_RUN_POLL_INTERVAL_MS;
}

function getRunLogPollInterval(active: boolean): number {
  return active ? ACTIVE_RUN_LOG_POLL_INTERVAL_MS : IDLE_RUN_LOG_POLL_INTERVAL_MS;
}

let getDurableRunSnapshotFn: (runId: string, tail: number) => Promise<unknown | null> = async () => {
  throw new Error('not initialized');
};

function initializeRunsAppRoutesContext(context: Pick<ServerRouteContext, 'getDurableRunSnapshot'>): void {
  getDurableRunSnapshotFn = context.getDurableRunSnapshot;
}

export function registerRunAppRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getDurableRunSnapshot'>,
): void {
  initializeRunsAppRoutesContext(context);

  // Serve PA client JS for skill apps (used by artifact sandbox and app pages)
  router.get('/pa/client.js', (_req, res) => {
    try {
      res.setHeader('Content-Type', 'application/javascript');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(PA_CLIENT_JS);
    } catch (err) {
      logError('PA client serve error', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to serve PA client' });
    }
  });

  // Serve PA component CSS for skill apps
  router.get('/pa/components.css', (_req, res) => {
    try {
      res.setHeader('Content-Type', 'text/css');
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(getPaComponentsCss());
    } catch (err) {
      logError('PA components serve error', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to serve PA components' });
    }
  });

  // GET /api/apps — list skill apps from the KB vault
  router.get('/api/apps', async (_req, res) => {
    try {
      // Scan apps/ directories in the vault
      const vaultRoot = resolve(getVaultRoot());
      const appsRoot = join(vaultRoot, 'apps');
      let entries: string[] = [];
      try {
        entries = readdirSync(appsRoot);
      } catch {
        // apps directory may not exist yet
      }

      const apps: Array<{
        id: string;
        name: string;
        description: string;
        prompt: string;
        entry: string;
        icon: string;
        nav: Array<{ label: string; page: string }>;
      }> = [];

      for (const entry of entries) {
        const appDir = join(appsRoot, entry);
        const appMdPath = join(appDir, 'APP.md');
        try {
          if (!statSync(appMdPath).isFile()) continue;
        } catch {
          continue;
        }

        // Parse APP.md (simple YAML frontmatter)
        try {
          const raw = readFileSync(appMdPath, 'utf-8');
          const yamlMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
          if (!yamlMatch) continue;

          const yaml = yamlMatch[1];
          const name = parseYamlScalar(yaml.match(/^name\s*:\s*(.+)$/m)?.[1], entry);
          const description = parseYamlScalar(yaml.match(/^description\s*:\s*(.+)$/m)?.[1]);
          const prompt = parseYamlScalar(yaml.match(/^prompt\s*:\s*(.+)$/m)?.[1]);
          const entryPage = parseYamlScalar(yaml.match(/^entry\s*:\s*(.+)$/m)?.[1], 'index.html');
          const icon = parseYamlScalar(yaml.match(/^icon\s*:\s*(.+)$/m)?.[1]);

          // Parse nav block if present
          const nav: Array<{ label: string; page: string }> = [];
          const navMatch = yaml.match(/^nav\s*:\s*$/m);
          if (navMatch) {
            const navLines: string[] = [];
            const yamlLines = yaml.split('\n');
            const navStartIndex = yamlLines.findIndex((l) => l.trim() === 'nav:');
            if (navStartIndex >= 0) {
              for (let i = navStartIndex + 1; i < yamlLines.length; i++) {
                const line = yamlLines[i];
                if (!line.startsWith('  - ') && !line.startsWith('    ')) break;
                navLines.push(line);
              }
              for (const navLine of navLines) {
                const labelMatch = navLine.match(/label\s*:\s*(.+)$/);
                const pageMatch = navLine.match(/page\s*:\s*(.+)$/);
                if (labelMatch && pageMatch) {
                  nav.push({ label: parseYamlScalar(labelMatch[1]), page: parseYamlScalar(pageMatch[1]) });
                }
              }
            }
          }

          apps.push({ id: entry, name, description, prompt, entry: entryPage, icon, nav });
        } catch {
          // Skip malformed apps
        }
      }

      res.json(apps);
    } catch (err) {
      logError('apps listing error', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/apps/:id/icon — serve the optional app icon declared in APP.md
  router.get('/api/apps/:id/icon', (req, res) => {
    try {
      const appId = typeof req.params.id === 'string' ? req.params.id.trim() : '';
      if (!appId || appId.includes('/') || appId.includes('\\') || appId.includes('\0')) {
        res.status(400).json({ error: 'Invalid app id' });
        return;
      }

      const vaultRoot = resolve(getVaultRoot());
      const appDir = join(vaultRoot, 'apps', appId);
      const appMdPath = join(appDir, 'APP.md');
      if (!existsSync(appMdPath) || !statSync(appMdPath).isFile()) {
        res.status(404).json({ error: 'App not found' });
        return;
      }

      const raw = readFileSync(appMdPath, 'utf-8');
      const yamlMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      const icon = parseYamlScalar(yamlMatch?.[1].match(/^icon\s*:\s*(.+)$/m)?.[1]);
      const iconPath = icon ? resolveAppAssetPath(appDir, icon) : null;
      if (!iconPath || !existsSync(iconPath) || !statSync(iconPath).isFile()) {
        res.status(404).json({ error: 'Icon not found' });
        return;
      }

      const contentType = getImageContentType(iconPath);
      if (!contentType) {
        res.status(415).json({ error: 'Unsupported icon type' });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.send(readFileSync(iconPath));
    } catch (err) {
      logError('app icon serve error', {
        message: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({ error: 'Failed to serve app icon' });
    }
  });

  // POST /api/runs — create a durable agent run from an assembled prompt
  // Used by skill apps (PA client) to execute prompts without a conversation context.
  router.post('/api/runs', async (req, res) => {
    try {
      const { prompt, source } = req.body;

      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'prompt is required' });
        return;
      }

      if (!(await pingDaemon())) {
        res.status(503).json({ error: 'Daemon is not responding. Ensure the desktop app is running.' });
        return;
      }

      const appName = typeof source === 'string' && source.startsWith('app:') ? source.slice(4) : 'custom';
      const result = await startBackgroundRun({
        taskSlug: `app-${appName}`,
        cwd: process.cwd(),
        agent: {
          prompt,
          noSession: true,
        },
        source: {
          type: 'app',
          id: appName,
        },
      });

      if (!result.accepted) {
        res.status(503).json({ error: result.reason ?? 'Could not start run.' });
        return;
      }

      invalidateAppTopics('runs');
      res.status(201).json({ runId: result.runId, logPath: result.logPath });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs', async (_req, res) => {
    try {
      res.json(await listDurableRuns());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id', async (req, res) => {
    try {
      const result = await getDurableRun(req.params.id);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id/events', async (req, res) => {
    const runId = req.params.id;
    const tail = parseRunLogTail(req.query.tail);
    try {
      const initial = await getDurableRunSnapshotFn(runId, tail);
      if (!initial) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      const writeEvent = (event: unknown) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      let closed = false;
      let detailPollTimer: ReturnType<typeof setTimeout> | null = null;
      let logPollTimer: ReturnType<typeof setTimeout> | null = null;
      let logPath = (initial as { log: { path: string } }).log.path;
      let logCursor = getDurableRunLogCursor(logPath);
      let runActive = isRunStreamActive(initial as { detail: { run: { status?: { status?: string } | string } } });
      const heartbeat = setInterval(() => {
        if (!closed) res.write(': heartbeat\n\n');
      }, 15_000);

      const stopStream = () => {
        closed = true;
        clearInterval(heartbeat);
        if (detailPollTimer) {
          clearTimeout(detailPollTimer);
          detailPollTimer = null;
        }
        if (logPollTimer) {
          clearTimeout(logPollTimer);
          logPollTimer = null;
        }
      };

      const scheduleDetailPoll = (delayMs: number) => {
        if (closed) {
          return;
        }

        detailPollTimer = setTimeout(() => {
          void pollDetailOnce();
        }, delayMs);
      };

      const scheduleLogPoll = (delayMs: number) => {
        if (closed) {
          return;
        }

        logPollTimer = setTimeout(() => {
          void pollLogOnce();
        }, delayMs);
      };

      const pollDetailOnce = async () => {
        if (closed) {
          return;
        }

        try {
          const next = await getDurableRunSnapshotFn(runId, tail);
          if (closed) {
            return;
          }

          if (!next) {
            writeEvent({ type: 'deleted', runId });
            stopStream();
            res.end();
            return;
          }

          const typedNext = next as { detail: { run: { status?: { status?: string } | string } }; log: { path: string; log: string } };
          runActive = isRunStreamActive(typedNext);
          if (typedNext.log.path !== logPath) {
            logPath = typedNext.log.path;
            logCursor = getDurableRunLogCursor(logPath);
            writeEvent({ type: 'snapshot', detail: typedNext.detail, log: typedNext.log });
          } else {
            writeEvent({ type: 'detail', detail: typedNext.detail });
          }
          scheduleDetailPoll(getRunStreamPollInterval(typedNext));
        } catch {
          scheduleDetailPoll(ACTIVE_RUN_POLL_INTERVAL_MS);
        }
      };

      const pollLogOnce = async () => {
        if (closed) {
          return;
        }

        try {
          const delta = readDurableRunLogDelta(logPath, logCursor);
          if (closed) {
            return;
          }

          if (delta?.reset) {
            const next = await getDurableRunSnapshotFn(runId, tail);
            if (closed) {
              return;
            }

            if (!next) {
              writeEvent({ type: 'deleted', runId });
              stopStream();
              res.end();
              return;
            }

            const typedNext = next as {
              detail: { run: { status?: { status?: string } | string } };
              log: { path: string; log: string };
            };
            runActive = isRunStreamActive(typedNext);
            logPath = typedNext.log.path;
            logCursor = getDurableRunLogCursor(logPath);
            writeEvent({ type: 'snapshot', detail: typedNext.detail, log: typedNext.log });
          } else if (delta) {
            logCursor = delta.nextCursor;
            if (delta.delta.length > 0) {
              writeEvent({ type: 'log_delta', path: delta.path, delta: delta.delta });
            }
          }
        } finally {
          scheduleLogPoll(getRunLogPollInterval(runActive));
        }
      };

      writeEvent({ type: 'snapshot', detail: (initial as { detail: unknown }).detail, log: (initial as { log: unknown }).log });
      scheduleDetailPoll(getRunStreamPollInterval(initial as { detail: { run: { status?: { status?: string } | string } } }));
      scheduleLogPoll(getRunLogPollInterval(runActive));

      req.on('close', () => {
        stopStream();
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/runs/:id/log', async (req, res) => {
    try {
      const tail = parseRunLogTail(req.query.tail);
      const result = await getDurableRunLog(req.params.id, tail);
      if (!result) {
        res.status(404).json({ error: 'Run not found' });
        return;
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/runs/:id/cancel', async (req, res) => {
    try {
      const result = await cancelDurableRun(req.params.id);
      if (!result.cancelled) {
        res.status(409).json({ error: result.reason ?? 'Could not cancel run.' });
        return;
      }
      invalidateAppTopics('runs');
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
