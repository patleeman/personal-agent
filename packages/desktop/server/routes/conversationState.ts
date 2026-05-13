import { existsSync, statSync } from 'node:fs';

import { type ExtensionFactory, SessionManager } from '@earendil-works/pi-coding-agent';
import type { Express } from 'express';

import { readConversationAutoModeStateFromSessionManager, writeConversationAutoModeState } from '../conversations/conversationAutoMode.js';
import { isMissingConversationBootstrapState, readConversationBootstrapState } from '../conversations/conversationBootstrap.js';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';
import { applyConversationModelPreferencesToSessionManager } from '../conversations/conversationModelPreferences.js';
import { recoverConversationCapability } from '../conversations/conversationRecovery.js';
import {
  parseTailBlocksQuery,
  publishConversationSessionMetaChanged,
  readConversationModelPreferenceStateById,
  resolveConversationSessionFile,
} from '../conversations/conversationService.js';
import {
  createSessionFromExisting,
  destroySession,
  getAvailableModelObjects,
  isLive as isLocalLive,
  readLiveSessionAutoModeState,
  registry as liveRegistry,
  renameSession,
  resumeSession,
  setLiveSessionAutoModeState,
  updateLiveSessionModelPreferences,
} from '../conversations/liveSessions.js';
import { appendConversationWorkspaceMetadata, readSessionBlocks, renameStoredSession } from '../conversations/sessions.js';
import { logError, logSlowConversationPerf, setServerTimingHeaders } from '../middleware/index.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { publishAppEvent } from '../shared/appEvents.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE as SETTINGS_FILE } from '../ui/settingsPersistence.js';
import type { LiveSessionResourceOptions, ServerRouteContext } from './context.js';
import { ensureRequestControlsLocalLiveConversation, writeLiveConversationControlError } from './liveSessions.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for conversation state routes');
};

let buildLiveSessionResourceOptionsFn: (profile?: string) => LiveSessionResourceOptions = () => ({
  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  additionalPromptTemplatePaths: [],
  additionalThemePaths: [],
});

let buildLiveSessionExtensionFactoriesFn: () => ExtensionFactory[] = () => [];

let flushLiveDeferredResumesFn: () => Promise<void> = async () => {};

function initializeConversationStateRoutesContext(
  context: Pick<
    ServerRouteContext,
    'getCurrentProfile' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes'
  >,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  buildLiveSessionResourceOptionsFn = context.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = context.buildLiveSessionExtensionFactories;
  flushLiveDeferredResumesFn = context.flushLiveDeferredResumes;
}

function resolveConversationSource(conversationId: string) {
  const liveEntry = liveRegistry.get(conversationId);
  const sessionDetail = readSessionBlocks(conversationId);
  const cwd = liveEntry?.cwd ?? sessionDetail?.meta.cwd;
  const sessionFile = liveEntry?.session.sessionFile ?? sessionDetail?.meta.file;

  if (!cwd || !sessionFile) {
    return null;
  }

  return {
    cwd,
    sessionFile,
    meta: sessionDetail?.meta,
    liveEntry,
  };
}

function parseNonNegativeIntegerQuery(rawValue: unknown): number | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const parsed =
    typeof candidate === 'number'
      ? candidate
      : typeof candidate === 'string' && /^\d+$/.test(candidate.trim())
        ? Number.parseInt(candidate.trim(), 10)
        : undefined;

  return Number.isSafeInteger(parsed) && (parsed as number) >= 0 ? (parsed as number) : undefined;
}

function parseTrimmedQueryString(rawValue: unknown): string | undefined {
  const candidate = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  if (typeof candidate !== 'string') {
    return undefined;
  }

  const normalized = candidate.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function registerConversationStateRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<
    ServerRouteContext,
    'getCurrentProfile' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes'
  >,
): void {
  initializeConversationStateRoutesContext(context);
  router.get('/api/conversations/:id/bootstrap', async (req, res) => {
    const startedAt = process.hrtime.bigint();

    try {
      const tailBlocks = parseTailBlocksQuery(req.query.tailBlocks);
      const rawKnownSessionSignature = Array.isArray(req.query.knownSessionSignature)
        ? req.query.knownSessionSignature[0]
        : req.query.knownSessionSignature;
      const knownSessionSignature =
        typeof rawKnownSessionSignature === 'string' && rawKnownSessionSignature.trim().length > 0
          ? rawKnownSessionSignature.trim()
          : undefined;
      const knownBlockOffset = parseNonNegativeIntegerQuery(req.query.knownBlockOffset);
      const knownTotalBlocks = parseNonNegativeIntegerQuery(req.query.knownTotalBlocks);
      const knownLastBlockId = parseTrimmedQueryString(req.query.knownLastBlockId);
      const bootstrap = await readConversationBootstrapState({
        conversationId: req.params.id,
        profile: getCurrentProfileFn(),
        tailBlocks,
        knownSessionSignature,
        knownBlockOffset,
        knownTotalBlocks,
        knownLastBlockId,
      });
      if (isMissingConversationBootstrapState(bootstrap.state)) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const sessionReadDescription = bootstrap.telemetry.sessionRead
        ? `${bootstrap.telemetry.sessionRead.cache}/${bootstrap.telemetry.sessionRead.loader}`
        : bootstrap.telemetry.sessionDetailReused
          ? 'reuse/signature'
          : 'missing';
      setServerTimingHeaders(
        res,
        [
          {
            name: 'remote_sync',
            durationMs: bootstrap.telemetry.remoteMirror.durationMs,
            description: bootstrap.telemetry.remoteMirror.status,
          },
          { name: 'session_read', durationMs: bootstrap.telemetry.sessionRead?.durationMs ?? 0, description: sessionReadDescription },
          { name: 'total', durationMs },
        ],
        {
          route: 'conversation-bootstrap',
          conversationId: req.params.id,
          ...(tailBlocks ? { tailBlocks } : {}),
          remoteMirror: bootstrap.telemetry.remoteMirror,
          sessionRead: bootstrap.telemetry.sessionRead,
          durationMs,
        },
      );
      logSlowConversationPerf('conversation bootstrap request', {
        conversationId: req.params.id,
        durationMs,
        ...(tailBlocks ? { tailBlocks } : {}),
        remoteMirrorStatus: bootstrap.telemetry.remoteMirror.status,
        sessionReadCache: bootstrap.telemetry.sessionRead?.cache,
        sessionReadLoader: bootstrap.telemetry.sessionDetailReused ? 'signature' : bootstrap.telemetry.sessionRead?.loader,
        sessionReadDurationMs: bootstrap.telemetry.sessionRead?.durationMs,
      });

      res.json(bootstrap.state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/api/conversations/:id/model-preferences', async (req, res) => {
    try {
      const state = await readConversationModelPreferenceStateById(req.params.id);
      if (!state) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      res.json(state);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/api/conversations/:id/auto-mode', async (req, res) => {
    try {
      if (isLocalLive(req.params.id)) {
        res.json(readLiveSessionAutoModeState(req.params.id));
        return;
      }
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile || !existsSync(sessionFile)) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      res.json(readConversationAutoModeStateFromSessionManager(SessionManager.open(sessionFile)));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: message });
    }
  });

  router.patch('/api/conversations/:id/auto-mode', async (req, res) => {
    try {
      const body = req.body as { enabled?: boolean; mode?: string; surfaceId?: string };
      if (typeof body.enabled !== 'boolean' && typeof body.mode !== 'string') {
        res.status(400).json({ error: 'mode or enabled required' });
        return;
      }
      const input = typeof body.mode === 'string' ? { mode: body.mode as never } : { enabled: body.enabled };
      if (isLocalLive(req.params.id)) {
        ensureRequestControlsLocalLiveConversation(req.params.id, { enabled: body.enabled, surfaceId: body.surfaceId });
        res.json(await setLiveSessionAutoModeState(req.params.id, input));
        return;
      }
      const recovered =
        body.enabled === true
          ? await recoverConversationCapability(req.params.id, {
              getCurrentProfile: getCurrentProfileFn,
              buildLiveSessionResourceOptions: buildLiveSessionResourceOptionsFn,
              buildLiveSessionExtensionFactories: buildLiveSessionExtensionFactoriesFn,
              flushLiveDeferredResumes: flushLiveDeferredResumesFn,
            })
          : { live: false };
      if (recovered.live) {
        ensureRequestControlsLocalLiveConversation(req.params.id, { enabled: body.enabled, surfaceId: body.surfaceId });
        res.json(await setLiveSessionAutoModeState(req.params.id, input));
        return;
      }
      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile || !existsSync(sessionFile)) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }
      const result = writeConversationAutoModeState(SessionManager.open(sessionFile), input);
      publishAppEvent({ type: 'session_file_changed', sessionId: req.params.id });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: message });
    }
  });

  router.patch('/api/conversations/:id/goal', async (req, res) => {
    try {
      const body = typeof req.body === 'object' && req.body !== null ? (req.body as { objective?: unknown }) : {};
      const hasObjective = Object.prototype.hasOwnProperty.call(body, 'objective');
      const objective = body.objective;
      if (hasObjective && typeof objective !== 'string') {
        res.status(400).json({ error: 'objective must be a string' });
        return;
      }

      const trimmedObjective = typeof objective === 'string' ? objective.trim() : '';
      const shouldSetGoal = hasObjective && trimmedObjective.length > 0;

      const setGoal = (sessionManager: SessionManager) => {
        const goalState = {
          objective: trimmedObjective,
          status: 'active' as const,
          tasks: [] as Array<{ id: string; description: string; status: string }>,
          stopReason: null,
          updatedAt: new Date().toISOString(),
          noProgressTurns: 0,
        };
        sessionManager.appendCustomEntry('conversation-goal', goalState);
        return goalState;
      };

      const clearGoal = (sessionManager: SessionManager) => {
        const goalState = {
          objective: '',
          status: 'complete' as const,
          tasks: [] as Array<{ id: string; description: string; status: string }>,
          stopReason: 'cleared',
          updatedAt: new Date().toISOString(),
          noProgressTurns: 0,
        };
        sessionManager.appendCustomEntry('conversation-goal', goalState);
        return goalState;
      };

      if (isLocalLive(req.params.id)) {
        const entry = liveRegistry.get(req.params.id);
        if (!entry) {
          res.status(404).json({ error: 'Session not live' });
          return;
        }
        const sessionManager = entry.session.sessionManager;
        const result = shouldSetGoal ? setGoal(sessionManager) : clearGoal(sessionManager);
        publishAppEvent({ type: 'session_file_changed', sessionId: req.params.id });
        res.json(result);
        return;
      }

      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile || !existsSync(sessionFile)) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const sessionManager = SessionManager.open(sessionFile);
      const result = shouldSetGoal ? setGoal(sessionManager) : clearGoal(sessionManager);
      publishAppEvent({ type: 'session_file_changed', sessionId: req.params.id });
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: message });
    }
  });

  router.patch('/api/conversations/:id/model-preferences', async (req, res) => {
    try {
      const { model, thinkingLevel, serviceTier } = req.body as {
        model?: string | null;
        thinkingLevel?: string | null;
        serviceTier?: string | null;
        surfaceId?: string;
      };

      if (model === undefined && thinkingLevel === undefined && serviceTier === undefined) {
        res.status(400).json({ error: 'model, thinkingLevel, or serviceTier required' });
        return;
      }

      if (
        (model !== undefined && model !== null && typeof model !== 'string') ||
        (thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== 'string') ||
        (serviceTier !== undefined && serviceTier !== null && typeof serviceTier !== 'string')
      ) {
        res.status(400).json({ error: 'model, thinkingLevel, and serviceTier must be strings or null' });
        return;
      }

      const input: {
        model?: string | null;
        thinkingLevel?: string | null;
        serviceTier?: string | null;
      } = {
        ...(model !== undefined ? { model } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
        ...(serviceTier !== undefined ? { serviceTier } : {}),
      };

      if (isLocalLive(req.params.id)) {
        ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
        const availableModels = getAvailableModelObjects();
        const state = await updateLiveSessionModelPreferences(req.params.id, input, availableModels);
        res.json(state);
        return;
      }

      const sessionFile = resolveConversationSessionFile(req.params.id);
      if (!sessionFile || !existsSync(sessionFile)) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const sessionManager = SessionManager.open(sessionFile);
      const availableModels = getAvailableModelObjects();
      const state = applyConversationModelPreferencesToSessionManager(
        sessionManager,
        input,
        readSavedModelPreferences(SETTINGS_FILE, availableModels),
        availableModels,
      );

      publishConversationSessionMetaChanged(req.params.id);
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      const status = message === 'model required' || message.startsWith('Unknown model:') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/conversations/:id/recover', async (req, res) => {
    try {
      const conversationId = req.params.id;
      if (!conversationId) {
        res.status(400).json({ error: 'conversation id required' });
        return;
      }

      const recovered = await recoverConversationCapability(conversationId, {
        getCurrentProfile: getCurrentProfileFn,
        buildLiveSessionResourceOptions: buildLiveSessionResourceOptionsFn,
        buildLiveSessionExtensionFactories: buildLiveSessionExtensionFactoriesFn,
        flushLiveDeferredResumes: flushLiveDeferredResumesFn,
      });
      res.json(recovered);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      const status = message === 'Conversation not found.' ? 404 : message === 'conversationId required' ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.patch('/api/conversations/:id/title', (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { name } = req.body as { name?: string; surfaceId?: string };
      const nextName = name?.trim();
      if (!nextName) {
        res.status(400).json({ error: 'name required' });
        return;
      }

      const conversationId = req.params.id;
      if (isLocalLive(conversationId)) {
        renameSession(conversationId, nextName);
        res.json({ ok: true, title: nextName });
        return;
      }

      const renamed = renameStoredSession(conversationId, nextName);
      publishConversationSessionMetaChanged(conversationId);
      res.json({ ok: true, title: renamed.title });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.includes('not found')
        ? 404
        : message.includes('must not be empty') || message.endsWith('required')
          ? 400
          : 500;
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/conversations/:id/duplicate', async (req, res) => {
    try {
      const conversationId = req.params.id;
      const source = resolveConversationSource(conversationId);

      if (!source) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      const result = await createSessionFromExisting(source.sessionFile, source.cwd, {
        ...buildLiveSessionResourceOptionsFn(),
        extensionFactories: buildLiveSessionExtensionFactoriesFn(),
      });

      publishConversationSessionMetaChanged(conversationId, result.id);
      res.json({ newSessionId: result.id, sessionFile: result.sessionFile });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/conversations/:id/cwd', async (req, res) => {
    try {
      const { cwd: requestedCwd } = req.body as { cwd?: string };
      const conversationId = req.params.id;
      const source = resolveConversationSource(conversationId);

      if (!source) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      if (source.liveEntry?.session.isStreaming) {
        res.status(409).json({ error: 'Stop the current response before changing the working directory.' });
        return;
      }

      const nextCwd = resolveRequestedCwd(requestedCwd, source.cwd);
      if (!nextCwd) {
        res.status(400).json({ error: 'cwd required' });
        return;
      }

      if (!existsSync(nextCwd)) {
        res.status(400).json({ error: `Directory does not exist: ${nextCwd}` });
        return;
      }

      if (!statSync(nextCwd).isDirectory()) {
        res.status(400).json({ error: `Not a directory: ${nextCwd}` });
        return;
      }

      if (nextCwd === source.cwd) {
        res.json({ id: conversationId, sessionFile: source.sessionFile, cwd: source.cwd, changed: false });
        return;
      }

      appendConversationWorkspaceMetadata({
        sessionFile: source.sessionFile,
        previousCwd: source.cwd,
        previousWorkspaceCwd: source.meta?.workspaceCwd ?? source.cwd,
        cwd: nextCwd,
        workspaceCwd: nextCwd,
        visibleMessage: true,
      });

      if (source.liveEntry) {
        destroySession(conversationId);
        await resumeSession(source.sessionFile, {
          cwdOverride: nextCwd,
          ...buildLiveSessionResourceOptionsFn(),
          extensionFactories: buildLiveSessionExtensionFactoriesFn(),
        });
      }

      publishConversationSessionMetaChanged(conversationId);
      res.json({ id: conversationId, sessionFile: source.sessionFile, cwd: nextCwd, changed: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
