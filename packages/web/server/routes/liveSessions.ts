import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { Express, Request, Response } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  prewarmLiveSessionLoader,
  exportSessionHtml,
  executeSessionBash,
  getLiveSessions as getLocalLiveSessions,
  getLiveSessionForkEntries,
  isLive as isLocalLive,
  LiveSessionControlError,
  subscribe as subscribeLocal,
  registry as liveRegistry,
} from '../conversations/liveSessions.js';
import {
  abortLiveSessionCapability,
  branchLiveSessionCapability,
  compactLiveSessionCapability,
  createLiveSessionCapability,
  destroyLiveSessionCapability,
  forkLiveSessionCapability,
  LiveSessionCapabilityInputError,
  manageLiveSessionParallelJobCapability,
  reloadLiveSessionCapability,
  restoreQueuedLiveSessionMessageCapability,
  resumeLiveSessionCapability,
  submitLiveSessionParallelPromptCapability,
  submitLiveSessionPromptCapability,
  summarizeAndForkLiveSessionCapability,
  takeOverLiveSessionCapability,
  type LiveSessionCapabilityContext,
} from '../conversations/liveSessionCapability.js';
import {
  logError,
  logSlowConversationPerf,
  setServerTimingHeaders,
  logWarn,
} from '../middleware/index.js';
import { parseTailBlocksQuery } from '../conversations/conversationService.js';
import { readSessionMeta } from '../conversations/sessions.js';
import { resolveConversationCwd } from '../conversations/conversationCwd.js';
import { readGitStatusSummaryWithTelemetry } from '../workspace/gitStatus.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('live session routes not initialized');
};

let getRepoRootFn: () => string = () => {
  throw new Error('live session routes not initialized');
};

let getDefaultWebCwdFn: () => string = () => {
  throw new Error('live session routes not initialized');
};

let buildLiveSessionResourceOptionsFn: (profile?: string) => Record<string, unknown> = () => ({
  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  additionalPromptTemplatePaths: [],
  additionalThemePaths: [],
});

let buildLiveSessionExtensionFactoriesFn: () => ExtensionFactory[] = () => [];

let flushLiveDeferredResumesFn: () => Promise<void> = async () => {};

let listTasksForCurrentProfileFn: () => {
  id: string;
  title?: string;
  filePath?: string;
  prompt: string;
  enabled: boolean;
  running: boolean;
  cron?: string;
  at?: string;
  model?: string;
  cwd?: string;
  lastStatus?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastAttemptCount?: number;
}[] = () => [];

let listMemoryDocsFn: () => {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  path: string;
  updated?: string;
}[] = () => [];

function initializeLiveSessionRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes' | 'listTasksForCurrentProfile' | 'listMemoryDocs'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  getDefaultWebCwdFn = context.getDefaultWebCwd;
  buildLiveSessionResourceOptionsFn = context.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = context.buildLiveSessionExtensionFactories;
  flushLiveDeferredResumesFn = context.flushLiveDeferredResumes;
  listTasksForCurrentProfileFn = context.listTasksForCurrentProfile;
  listMemoryDocsFn = context.listMemoryDocs;
  queueDefaultLiveSessionLoaderPrewarm();
}

function buildLiveSessionResourceOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...buildLiveSessionResourceOptionsFn(getCurrentProfileFn()),
    extensionFactories: buildLiveSessionExtensionFactoriesFn(),
    ...overrides,
  };
}

function queueDefaultLiveSessionLoaderPrewarm(): void {
  try {
    const profile = getCurrentProfileFn();
    const cwd = resolveConversationCwd({
      repoRoot: getRepoRootFn(),
      profile,
      explicitCwd: undefined,
      defaultCwd: getDefaultWebCwdFn(),
    });

    void prewarmLiveSessionLoader(cwd, buildLiveSessionResourceOptions()).catch((error) => {
      logWarn('default live session loader prewarm failed', {
        cwd,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });
  } catch (error) {
    logWarn('default live session loader prewarm setup failed', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
}

function getLiveSessionCapabilityContext(): LiveSessionCapabilityContext {
  return {
    getCurrentProfile: getCurrentProfileFn,
    getRepoRoot: getRepoRootFn,
    getDefaultWebCwd: getDefaultWebCwdFn,
    buildLiveSessionResourceOptions: buildLiveSessionResourceOptionsFn,
    buildLiveSessionExtensionFactories: buildLiveSessionExtensionFactoriesFn,
    flushLiveDeferredResumes: flushLiveDeferredResumesFn,
    listTasksForCurrentProfile: listTasksForCurrentProfileFn,
    listMemoryDocs: listMemoryDocsFn,
  };
}

function readPromptImages(value: unknown): Array<{ data: string; mimeType: string; name?: string }> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter((image): image is { data?: unknown; mimeType?: unknown; name?: unknown } => !!image && typeof image === 'object')
    .map((image) => ({
      data: typeof image.data === 'string' ? image.data : '',
      mimeType: typeof image.mimeType === 'string' ? image.mimeType : '',
      ...(typeof image.name === 'string' ? { name: image.name } : {}),
    }));
}

export async function handleLiveSessionPrompt(req: Request, res: Response): Promise<void> {
  try {
    const result = await submitLiveSessionPromptCapability({
      conversationId: req.params.id,
      text: typeof req.body?.text === 'string' ? req.body.text : '',
      behavior: req.body?.behavior,
      images: readPromptImages(req.body?.images),
      attachmentRefs: req.body?.attachmentRefs,
      contextMessages: req.body?.contextMessages,
      relatedConversationIds: req.body?.relatedConversationIds,
      surfaceId: readRequestSurfaceId(req.body),
    }, getLiveSessionCapabilityContext());
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (err instanceof LiveSessionCapabilityInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
}

export async function handleLiveSessionParallelPrompt(req: Request, res: Response): Promise<void> {
  try {
    const result = await submitLiveSessionParallelPromptCapability({
      conversationId: req.params.id,
      text: typeof req.body?.text === 'string' ? req.body.text : '',
      images: readPromptImages(req.body?.images),
      attachmentRefs: req.body?.attachmentRefs,
      contextMessages: req.body?.contextMessages,
      relatedConversationIds: req.body?.relatedConversationIds,
      surfaceId: readRequestSurfaceId(req.body),
    }, getLiveSessionCapabilityContext());
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (err instanceof LiveSessionCapabilityInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
}

export async function handleLiveSessionParallelJobAction(req: Request, res: Response): Promise<void> {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    const result = await manageLiveSessionParallelJobCapability({
      conversationId: req.params.id,
      jobId: req.params.jobId,
      action: (typeof req.body?.action === 'string' ? req.body.action : '') as 'importNow' | 'skip' | 'cancel',
    });
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (err instanceof LiveSessionCapabilityInputError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Parallel prompt no longer exists') ? 409 : 500;
    res.status(status).json({ error: message });
  }
}

function isLiveSession(sessionId: string): boolean {
  return isLocalLive(sessionId);
}

function subscribeLiveSession(
  sessionId: string,
  listener: (event: unknown) => void,
  options?: {
    tailBlocks?: number;
    surface?: {
      surfaceId: string;
      surfaceType: 'desktop_web' | 'mobile_web';
    };
  },
): (() => void) | null {
  return subscribeLocal(sessionId, listener, options);
}

function readRequestSurfaceId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as { surfaceId?: unknown }).surfaceId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function ensureRequestControlsLocalLiveConversation(_conversationId: string, body: unknown): string | undefined {
  return readRequestSurfaceId(body);
}

export function writeLiveConversationControlError(res: Response, error: unknown): boolean {
  if (error instanceof LiveSessionControlError) {
    res.status(409).json({ error: error.message });
    return true;
  }

  return false;
}

export function registerLiveSessionRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes' | 'listTasksForCurrentProfile' | 'listMemoryDocs'>,
): void {
  initializeLiveSessionRoutesContext(context);

  router.get('/api/live-sessions/:id', (req, res) => {
    try {
      const live = isLiveSession(req.params.id);
      if (!live) { res.status(404).json({ live: false }); return; }
      const entry = getLocalLiveSessions().find((session) => session.id === req.params.id);
      res.json({ live: true, ...entry });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new live session */
  router.post('/api/live-sessions', async (req, res) => {
    try {
      const body = req.body as {
        cwd?: string;
        workspaceCwd?: string | null;
        model?: string | null;
        thinkingLevel?: string | null;
        serviceTier?: string | null;
      };
      const result = await createLiveSessionCapability({
        cwd: body.cwd,
        ...(body.workspaceCwd !== undefined ? { workspaceCwd: body.workspaceCwd } : {}),
        ...(body.model !== undefined ? { model: body.model } : {}),
        ...(body.thinkingLevel !== undefined ? { thinkingLevel: body.thinkingLevel } : {}),
        ...(body.serviceTier !== undefined ? { serviceTier: body.serviceTier } : {}),
      }, getLiveSessionCapabilityContext());
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (err instanceof LiveSessionCapabilityInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  /** Resume an existing session file into a live session */
  router.post('/api/live-sessions/resume', async (req, res) => {
    try {
      const result = await resumeLiveSessionCapability({
        sessionFile: typeof req.body?.sessionFile === 'string' ? req.body.sessionFile : '',
        cwd: typeof req.body?.cwd === 'string' ? req.body.cwd : undefined,
      }, getLiveSessionCapabilityContext());
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (err instanceof LiveSessionCapabilityInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/live-sessions/:id/events', (req, res) => {
    const { id } = req.params;
    if (!isLiveSession(id)) { res.status(404).json({ error: 'Not a live session' }); return; }

    const tailBlocks = parseTailBlocksQuery(req.query.tailBlocks);
    const rawSurfaceId = Array.isArray(req.query.surfaceId) ? req.query.surfaceId[0] : req.query.surfaceId;
    const surfaceId = typeof rawSurfaceId === 'string' ? rawSurfaceId.trim() : '';
    const rawSurfaceType = Array.isArray(req.query.surfaceType) ? req.query.surfaceType[0] : req.query.surfaceType;
    const surfaceType = rawSurfaceType === 'mobile_web' ? 'mobile_web' : 'desktop_web';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const unsubscribe = subscribeLiveSession(id, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, {
      ...(tailBlocks ? { tailBlocks } : {}),
      ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  });

  router.get('/api/live-sessions/:id/fork-entries', (req, res) => {
    try {
      const forkEntries = getLiveSessionForkEntries(req.params.id);
      if (!forkEntries) {
        res.status(404).json({ error: 'Session not live' });
        return;
      }
      res.json(forkEntries);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/takeover', (req, res) => {
    try {
      const { id } = req.params;
      const surfaceId = typeof req.body?.surfaceId === 'string' ? req.body.surfaceId.trim() : '';
      if (!surfaceId) {
        res.status(400).json({ error: 'surfaceId is required' });
        return;
      }
      if (!isLocalLive(id)) {
        res.status(400).json({ error: 'Takeover is only available for local live conversations right now.' });
        return;
      }

      res.json(takeOverLiveSessionCapability({ conversationId: id, surfaceId }));
    } catch (error) {
      if (error instanceof LiveSessionControlError) {
        res.status(409).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/live-sessions/:id/prompt', handleLiveSessionPrompt);
  router.post('/api/live-sessions/:id/parallel-prompt', handleLiveSessionParallelPrompt);
  router.post('/api/live-sessions/:id/parallel-jobs/:jobId', handleLiveSessionParallelJobAction);

  router.post('/api/live-sessions/:id/bash', async (req, res) => {
    try {
      const command = typeof req.body?.command === 'string' ? req.body.command.trim() : '';
      if (!command) {
        res.status(400).json({ error: 'command required' });
        return;
      }

      const result = await executeSessionBash(req.params.id, command, {
        excludeFromContext: req.body?.excludeFromContext === true,
      });
      res.json({ ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      const status = message.includes('already running') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/live-sessions/:id/dequeue', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

      const { behavior, index, previewId } = req.body as {
        behavior?: 'steer' | 'followUp';
        index?: number;
        previewId?: string;
        surfaceId?: string;
      };

      if (behavior !== 'steer' && behavior !== 'followUp') {
        res.status(400).json({ error: 'behavior must be "steer" or "followUp"' });
        return;
      }

      if (!Number.isInteger(index) || (index as number) < 0) {
        res.status(400).json({ error: 'index must be a non-negative integer' });
        return;
      }

      res.json(await restoreQueuedLiveSessionMessageCapability({
        conversationId: req.params.id,
        behavior,
        index: index as number,
        ...(typeof previewId === 'string' ? { previewId } : {}),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      const status = message.includes('Queued prompt changed before it could be restored')
        || message.includes('Queued prompt restore is unavailable')
        ? 409
        : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/live-sessions/:id/compact', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { customInstructions } = req.body as { customInstructions?: string; surfaceId?: string };
      res.json(await compactLiveSessionCapability({
        conversationId: req.params.id,
        customInstructions: customInstructions?.trim() || undefined,
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/reload', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      res.json(await reloadLiveSessionCapability({ conversationId: req.params.id }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/export', async (req, res) => {
    try {
      const { outputPath } = req.body as { outputPath?: string };
      const path = await exportSessionHtml(req.params.id, outputPath?.trim() || undefined);
      res.json({ ok: true, path });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  /** Abort a running agent */
  router.post('/api/live-sessions/:id/abort', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      res.json(await abortLiveSessionCapability({ conversationId: req.params.id }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (err instanceof LiveSessionCapabilityInputError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get workspace context for a conversation */
  router.get('/api/live-sessions/:id/context', (req, res) => {
    const startedAt = process.hrtime.bigint();

    try {
      const { id } = req.params;
      const liveEntry = liveRegistry.get(id);
      const storedSession = !liveEntry ? readSessionMeta(id) : null;
      const cwd = liveEntry?.cwd ?? storedSession?.cwd;
      if (!cwd) { res.status(404).json({ error: 'Session not found' }); return; }

      const gitSummaryRead = readGitStatusSummaryWithTelemetry(cwd);
      const gitSummary = gitSummaryRead.summary;

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      setServerTimingHeaders(res, [
        {
          name: 'git',
          durationMs: gitSummaryRead.telemetry.durationMs,
          description: `${gitSummaryRead.telemetry.cache}${gitSummaryRead.telemetry.degraded ? '/degraded' : ''}`,
        },
        { name: 'total', durationMs },
      ], {
        route: 'live-session-context',
        conversationId: id,
        git: gitSummaryRead.telemetry,
        durationMs,
      });
      logSlowConversationPerf('live session context request', {
        conversationId: id,
        durationMs,
        gitCache: gitSummaryRead.telemetry.cache,
        gitDegraded: gitSummaryRead.telemetry.degraded,
      });

      res.json({
        cwd,
        branch: gitSummary?.branch ?? null,
        git: gitSummary
          ? {
            changeCount: gitSummary.changeCount,
            linesAdded: gitSummary.linesAdded,
            linesDeleted: gitSummary.linesDeleted,
            changes: gitSummary.changes.map((change) => ({
              relativePath: change.relativePath,
              change: change.change,
            })),
          }
          : null,
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/summarize-fork', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      res.json(await summarizeAndForkLiveSessionCapability({ conversationId: req.params.id }, getLiveSessionCapabilityContext()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/branch', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { entryId } = req.body as { entryId: string; surfaceId?: string };
      if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
      res.json(await branchLiveSessionCapability({ conversationId: req.params.id, entryId }, getLiveSessionCapabilityContext()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/fork', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { entryId, preserveSource, beforeEntry } = req.body as {
        entryId: string;
        preserveSource?: boolean;
        beforeEntry?: boolean;
        surfaceId?: string;
      };
      if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
      res.json(await forkLiveSessionCapability({
        conversationId: req.params.id,
        entryId,
        preserveSource,
        beforeEntry,
      }, getLiveSessionCapabilityContext()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  /** Destroy / close a live session */
  router.delete('/api/live-sessions/:id', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

      res.json(await destroyLiveSessionCapability({ conversationId: req.params.id }));
    } catch (err) {
      if (writeLiveConversationControlError(res, err)) {
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}

