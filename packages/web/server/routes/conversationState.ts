import { existsSync, statSync } from 'node:fs';
import type { Express } from 'express';
import { SessionManager, type ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { LiveSessionResourceOptions } from './context.js';
import {
  getConversationExecutionTarget,
  getConversationProjectLink,
  getExecutionTarget,
  inspectCliBinary,
  setConversationExecutionTarget,
  setConversationProjectLinks,
} from '@personal-agent/core';
import { parsePendingOperation } from '@personal-agent/daemon';
import {
  applyConversationModelPreferencesToSessionManager,
} from '../conversations/conversationModelPreferences.js';
import {
  createWebLiveConversationRunId,
  syncWebLiveConversationRun,
} from '../conversations/conversationRuns.js';
import {
  listAllLiveSessions,
  parseTailBlocksQuery,
  publishConversationSessionMetaChanged,
  readConversationModelPreferenceStateById,
  readSessionDetailForRoute,
  resolveConversationSessionFile,
} from '../conversations/conversationService.js';
import {
  canInjectResumeFallbackPrompt,
  createSessionFromExisting,
  destroySession,
  getAvailableModelObjects,
  isLive as isLocalLive,
  promptSession as promptLocalSession,
  queuePromptContext,
  registry as liveRegistry,
  renameSession,
  resumeSession as resumeLocalSession,
  updateLiveSessionModelPreferences,
} from '../conversations/liveSessions.js';
import {
  browseRemoteTargetDirectory,
  clearRemoteConversationBindingForConversation,
  createRemoteLiveSession,
  forkLocalMirrorSession,
  getRemoteConversationConnectionState,
  getRemoteLiveSessionMeta,
  isRemoteLiveSession,
  readRemoteConversationBindingForConversation,
  stopRemoteLiveSession,
} from '../conversations/remoteLiveSessions.js';
import { readSessionBlocks, renameStoredSession } from '../conversations/sessions.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import {
  getDurableRun,
  listDurableRunsWithTelemetry,
  type DurableRunsListTelemetry,
} from '../automation/durableRuns.js';
import {
  logError,
  logSlowConversationPerf,
  invalidateAppTopics,
  setServerTimingHeaders,
} from '../middleware/index.js';
import {
  buildConversationExecutionState,
  type ConversationExecutionState,
} from '../workspace/remoteExecution.js';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE as SETTINGS_FILE } from '../ui/settingsPersistence.js';
import { readWebUiConfig } from '../ui/webUi.js';
import {
  ensureRequestControlsLocalLiveConversation,
  writeLiveConversationControlError,
} from './liveSessions.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for conversation state routes');
};

let getRepoRootFn: () => string = () => process.cwd();

let buildLiveSessionResourceOptionsFn: (profile?: string) => LiveSessionResourceOptions = () => ({
  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  additionalPromptTemplatePaths: [],
  additionalThemePaths: [],
});

let buildLiveSessionExtensionFactoriesFn: () => ExtensionFactory[] = () => [];

let flushLiveDeferredResumesFn: () => Promise<void> = async () => {};

export function setConversationStateRoutesGetters(
  getCurrentProfile: () => string,
  getRepoRoot: () => string,
  buildLiveSessionResourceOptions: (profile?: string) => LiveSessionResourceOptions,
  buildLiveSessionExtensionFactories: () => ExtensionFactory[],
  flushLiveDeferredResumes: () => Promise<void> = async () => {},
): void {
  getCurrentProfileFn = getCurrentProfile;
  getRepoRootFn = getRepoRoot;
  buildLiveSessionResourceOptionsFn = buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = buildLiveSessionExtensionFactories;
  flushLiveDeferredResumesFn = flushLiveDeferredResumes;
}

function inspectSshBinaryState() {
  return inspectCliBinary({ command: 'ssh', cwd: getRepoRootFn(), versionArgs: ['-V'] });
}

async function readConversationExecutionStateWithTelemetry(conversationId: string): Promise<{
  state: ConversationExecutionState;
  telemetry: DurableRunsListTelemetry;
}> {
  const stored = getConversationExecutionTarget({
    profile: getCurrentProfileFn(),
    conversationId,
  });
  const runs = await listDurableRunsWithTelemetry();

  return {
    state: buildConversationExecutionState({
      conversationId,
      targetId: stored?.targetId ?? null,
      runs: runs.result.runs,
      inspectSshBinary: inspectSshBinaryState,
    }),
    telemetry: runs.telemetry,
  };
}

async function readConversationExecutionState(conversationId: string) {
  return (await readConversationExecutionStateWithTelemetry(conversationId)).state;
}

async function readConversationBootstrapState(input: {
  conversationId: string;
  profile: string;
  tailBlocks?: number;
}) {
  const [sessionResult, execution] = await Promise.all([
    readSessionDetailForRoute({
      conversationId: input.conversationId,
      profile: input.profile,
      tailBlocks: input.tailBlocks,
    }),
    readConversationExecutionStateWithTelemetry(input.conversationId),
  ]);

  const relatedProjectIds = getConversationProjectLink({
    profile: input.profile,
    conversationId: input.conversationId,
  })?.relatedProjectIds ?? [];
  const liveSession = listAllLiveSessions().find((session) => session.id === input.conversationId);

  return {
    state: {
      conversationId: input.conversationId,
      sessionDetail: sessionResult.sessionRead.detail,
      projects: {
        conversationId: input.conversationId,
        relatedProjectIds,
      },
      execution: execution.state,
      remoteConnection: getRemoteConversationConnectionState({
        profile: input.profile,
        conversationId: input.conversationId,
      }),
      liveSession: liveSession
        ? { live: true as const, ...liveSession }
        : { live: false as const },
    },
    telemetry: {
      sessionRead: sessionResult.sessionRead.telemetry,
      remoteMirror: sessionResult.remoteMirror,
      execution: execution.telemetry,
    },
  };
}

export function registerConversationStateRoutes(router: Pick<Express, 'get' | 'post' | 'patch'>): void {
  router.get('/api/conversations/:id/bootstrap', async (req, res) => {
    const startedAt = process.hrtime.bigint();

    try {
      const tailBlocks = parseTailBlocksQuery(req.query.tailBlocks);
      const bootstrap = await readConversationBootstrapState({
        conversationId: req.params.id,
        profile: getCurrentProfileFn(),
        tailBlocks,
      });
      if (!bootstrap.state.sessionDetail && !bootstrap.state.liveSession.live) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      setServerTimingHeaders(res, [
        { name: 'remote_sync', durationMs: bootstrap.telemetry.remoteMirror.durationMs, description: bootstrap.telemetry.remoteMirror.status },
        { name: 'session_read', durationMs: bootstrap.telemetry.sessionRead?.durationMs ?? 0, description: bootstrap.telemetry.sessionRead ? `${bootstrap.telemetry.sessionRead.cache}/${bootstrap.telemetry.sessionRead.loader}` : 'missing' },
        { name: 'runs', durationMs: bootstrap.telemetry.execution.durationMs, description: `${bootstrap.telemetry.execution.cache}/${bootstrap.telemetry.execution.source}` },
        { name: 'total', durationMs },
      ], {
        route: 'conversation-bootstrap',
        conversationId: req.params.id,
        ...(tailBlocks ? { tailBlocks } : {}),
        remoteMirror: bootstrap.telemetry.remoteMirror,
        sessionRead: bootstrap.telemetry.sessionRead,
        execution: bootstrap.telemetry.execution,
        durationMs,
      });
      logSlowConversationPerf('conversation bootstrap request', {
        conversationId: req.params.id,
        durationMs,
        ...(tailBlocks ? { tailBlocks } : {}),
        remoteMirrorStatus: bootstrap.telemetry.remoteMirror.status,
        sessionReadCache: bootstrap.telemetry.sessionRead?.cache,
        sessionReadLoader: bootstrap.telemetry.sessionRead?.loader,
        sessionReadDurationMs: bootstrap.telemetry.sessionRead?.durationMs,
        executionRunsCache: bootstrap.telemetry.execution.cache,
        executionRunsSource: bootstrap.telemetry.execution.source,
        executionRunsDurationMs: bootstrap.telemetry.execution.durationMs,
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

  router.patch('/api/conversations/:id/model-preferences', async (req, res) => {
    try {
      const { model, thinkingLevel } = req.body as {
        model?: string | null;
        thinkingLevel?: string | null;
        surfaceId?: string;
      };

      if (model === undefined && thinkingLevel === undefined) {
        res.status(400).json({ error: 'model or thinkingLevel required' });
        return;
      }

      if ((model !== undefined && model !== null && typeof model !== 'string')
        || (thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== 'string')) {
        res.status(400).json({ error: 'model and thinkingLevel must be strings or null' });
        return;
      }

      const profile = getCurrentProfileFn();
      const input: {
        model?: string | null;
        thinkingLevel?: string | null;
      } = {
        ...(model !== undefined ? { model } : {}),
        ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
      };

      if (isRemoteLiveSession(req.params.id) || readRemoteConversationBindingForConversation({ profile, conversationId: req.params.id })) {
        res.status(409).json({ error: 'Per-conversation model changes are not supported for remote conversations yet.' });
        return;
      }

      if (isLocalLive(req.params.id)) {
        ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
        const availableModels = getAvailableModelObjects();
        const state = updateLiveSessionModelPreferences(req.params.id, input, availableModels);
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
      const status = message === 'model required'
        || message.startsWith('Unknown model:')
        ? 400
        : 500;
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

      const resumeFallbackPrompt = readWebUiConfig().resumeFallbackPrompt;

      if (isLocalLive(conversationId)) {
        const liveEntry = liveRegistry.get(conversationId);
        const shouldInjectFallbackPrompt = canInjectResumeFallbackPrompt(conversationId);
        const fallbackPendingOperation = shouldInjectFallbackPrompt
          ? {
              type: 'prompt' as const,
              text: resumeFallbackPrompt,
              enqueuedAt: new Date().toISOString(),
            }
          : null;

        if (liveEntry?.session.sessionFile) {
          await syncWebLiveConversationRun({
            conversationId,
            sessionFile: liveEntry.session.sessionFile,
            cwd: liveEntry.cwd,
            title: liveEntry.title,
            profile: getCurrentProfileFn(),
            state: 'running',
            pendingOperation: fallbackPendingOperation,
          });
        }

        if (shouldInjectFallbackPrompt) {
          promptLocalSession(conversationId, resumeFallbackPrompt).catch(async (error) => {
            if (liveEntry?.session.sessionFile) {
              await syncWebLiveConversationRun({
                conversationId,
                sessionFile: liveEntry.session.sessionFile,
                cwd: liveEntry.cwd,
                title: liveEntry.title,
                profile: getCurrentProfileFn(),
                state: 'failed',
                lastError: error instanceof Error ? error.message : String(error),
              });
            }

            logError('conversation recovery error', {
              sessionId: conversationId,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            });
          });
        }

        res.json({
          conversationId,
          live: true,
          recovered: true,
          replayedPendingOperation: false,
          usedFallbackPrompt: shouldInjectFallbackPrompt,
        });
        return;
      }

      const runDetail = await getDurableRun(createWebLiveConversationRunId(conversationId));
      const payload = runDetail?.run.checkpoint?.payload;
      const checkpointPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : {};
      const readCheckpointString = (key: string): string | undefined => {
        const value = checkpointPayload[key];
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
      };

      const pendingOperation = parsePendingOperation(checkpointPayload.pendingOperation);
      const sessionDetail = readSessionBlocks(conversationId);
      const sessionFile = sessionDetail?.meta.file
        ?? readCheckpointString('sessionFile')
        ?? runDetail?.run.manifest?.source?.filePath?.trim();

      if (!sessionFile || !existsSync(sessionFile)) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      const currentProfile = getCurrentProfileFn();
      const manifestSpec = runDetail?.run.manifest?.spec;
      const manifestCwd = typeof manifestSpec?.cwd === 'string' && manifestSpec.cwd.trim().length > 0
        ? manifestSpec.cwd.trim()
        : undefined;
      const resumed = await resumeLocalSession(sessionFile, {
        ...buildLiveSessionResourceOptionsFn(),
        extensionFactories: buildLiveSessionExtensionFactoriesFn(),
      });
      await flushLiveDeferredResumesFn();

      const resumedEntry = liveRegistry.get(resumed.id);
      const effectiveCwd = resumedEntry?.cwd
        ?? sessionDetail?.meta.cwd
        ?? readCheckpointString('cwd')
        ?? manifestCwd;
      const effectiveTitle = sessionDetail?.meta.title ?? readCheckpointString('title');
      const effectiveProfile = readCheckpointString('profile') ?? currentProfile;

      if (!effectiveCwd) {
        res.status(500).json({ error: 'Could not determine the conversation working directory.' });
        return;
      }

      const shouldInjectFallbackPrompt = !pendingOperation
        && (!resumedEntry || canInjectResumeFallbackPrompt(resumed.id));
      const recoveryOperation = pendingOperation ?? (shouldInjectFallbackPrompt
        ? {
            type: 'prompt' as const,
            text: resumeFallbackPrompt,
            enqueuedAt: new Date().toISOString(),
          }
        : null);
      const replayedPendingOperation = Boolean(pendingOperation);
      const usedFallbackPrompt = shouldInjectFallbackPrompt;

      await syncWebLiveConversationRun({
        conversationId: resumed.id,
        sessionFile,
        cwd: effectiveCwd,
        title: effectiveTitle,
        profile: effectiveProfile,
        state: 'running',
        pendingOperation: recoveryOperation,
      });

      if (recoveryOperation) {
        for (const message of recoveryOperation.contextMessages ?? []) {
          await queuePromptContext(resumed.id, message.customType, message.content);
        }

        promptLocalSession(
          resumed.id,
          recoveryOperation.text,
          recoveryOperation.behavior,
          recoveryOperation.images,
        ).catch(async (error) => {
          await syncWebLiveConversationRun({
            conversationId: resumed.id,
            sessionFile,
            cwd: effectiveCwd,
            title: effectiveTitle,
            profile: effectiveProfile,
            state: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
          });

          logError('conversation recovery error', {
            sessionId: resumed.id,
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        });
      }

      res.json({
        conversationId: resumed.id,
        live: true,
        recovered: true,
        replayedPendingOperation,
        usedFallbackPrompt,
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/conversations/:id/execution', async (req, res) => {
    const startedAt = process.hrtime.bigint();

    try {
      const execution = await readConversationExecutionStateWithTelemetry(req.params.id);
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      setServerTimingHeaders(res, [
        { name: 'runs', durationMs: execution.telemetry.durationMs, description: `${execution.telemetry.cache}/${execution.telemetry.source}` },
        { name: 'total', durationMs },
      ], {
        route: 'conversation-execution',
        conversationId: req.params.id,
        runs: execution.telemetry,
        durationMs,
      });
      logSlowConversationPerf('conversation execution request', {
        conversationId: req.params.id,
        durationMs,
        runsCache: execution.telemetry.cache,
        runsSource: execution.telemetry.source,
        runsDurationMs: execution.telemetry.durationMs,
      });

      res.json(execution.state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch('/api/conversations/:id/execution', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

      const targetId = req.body?.targetId === null
        ? null
        : typeof req.body?.targetId === 'string'
          ? req.body.targetId.trim() || null
          : null;

      if (targetId && !getExecutionTarget({ targetId })) {
        res.status(400).json({ error: `Execution target ${targetId} not found.` });
        return;
      }

      const profile = getCurrentProfileFn();
      const previous = getConversationExecutionTarget({
        profile,
        conversationId: req.params.id,
      });

      if (previous?.targetId && previous.targetId !== targetId) {
        await stopRemoteLiveSession(req.params.id).catch(() => undefined);
        clearRemoteConversationBindingForConversation({
          profile,
          conversationId: req.params.id,
        });
      }

      setConversationExecutionTarget({
        profile,
        conversationId: req.params.id,
        targetId,
      });

      if (targetId === null) {
        clearRemoteConversationBindingForConversation({
          profile,
          conversationId: req.params.id,
        });
      }

      invalidateAppTopics('executionTargets');
      res.json(await readConversationExecutionState(req.params.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(message.startsWith('Invalid') ? 400 : 500).json({ error: message });
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

  router.post('/api/conversations/:id/cwd', async (req, res) => {
    try {
      const { cwd: requestedCwd } = req.body as { cwd?: string };
      const conversationId = req.params.id;
      const profile = getCurrentProfileFn();
      const remoteBinding = readRemoteConversationBindingForConversation({
        profile,
        conversationId,
      });

      const liveEntry = liveRegistry.get(conversationId);
      const sessionDetail = readSessionBlocks(conversationId);
      const currentCwd = liveEntry?.cwd ?? sessionDetail?.meta.cwd;
      const sourceSessionFile = liveEntry?.session.sessionFile ?? sessionDetail?.meta.file;

      if (!currentCwd || !sourceSessionFile) {
        res.status(404).json({ error: 'Conversation not found.' });
        return;
      }

      if (remoteBinding) {
        const remoteLive = getRemoteLiveSessionMeta(conversationId);
        if (remoteLive?.isStreaming) {
          res.status(409).json({ error: 'Stop the current response before changing the working directory.' });
          return;
        }

        const resolved = await browseRemoteTargetDirectory({
          targetId: remoteBinding.targetId,
          cwd: requestedCwd,
          baseCwd: currentCwd,
        });

        if (resolved.cwd === currentCwd) {
          res.json({ id: conversationId, sessionFile: sourceSessionFile, cwd: currentCwd, changed: false });
          return;
        }

        const result = forkLocalMirrorSession({
          sessionFile: sourceSessionFile,
          remoteCwd: resolved.cwd,
        });

        const relatedProjectIds = getConversationProjectLink({
          profile,
          conversationId,
        })?.relatedProjectIds ?? [];

        if (relatedProjectIds.length > 0) {
          setConversationProjectLinks({
            profile,
            conversationId: result.id,
            relatedProjectIds,
          });
        }

        setConversationExecutionTarget({
          profile,
          conversationId: result.id,
          targetId: remoteBinding.targetId,
        });
        await createRemoteLiveSession({
          profile,
          targetId: remoteBinding.targetId,
          remoteCwd: resolved.cwd,
          localSessionFile: result.sessionFile,
          conversationId: result.id,
          bootstrapLocalSessionFile: result.sessionFile,
        });

        if (remoteLive) {
          await stopRemoteLiveSession(conversationId).catch(() => undefined);
        }

        if (relatedProjectIds.length > 0) {
          invalidateAppTopics('projects');
        }
        publishConversationSessionMetaChanged(conversationId, result.id);
        res.json({ id: result.id, sessionFile: result.sessionFile, cwd: resolved.cwd, changed: true });
        return;
      }

      if (liveEntry?.session.isStreaming) {
        res.status(409).json({ error: 'Stop the current response before changing the working directory.' });
        return;
      }

      const nextCwd = resolveRequestedCwd(requestedCwd, currentCwd);
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

      if (nextCwd === currentCwd) {
        res.json({ id: conversationId, sessionFile: sourceSessionFile, cwd: currentCwd, changed: false });
        return;
      }

      const result = await createSessionFromExisting(sourceSessionFile, nextCwd, {
        ...buildLiveSessionResourceOptionsFn(),
        extensionFactories: buildLiveSessionExtensionFactoriesFn(),
      });

      const relatedProjectIds = getConversationProjectLink({
        profile,
        conversationId,
      })?.relatedProjectIds ?? [];

      if (relatedProjectIds.length > 0) {
        setConversationProjectLinks({
          profile,
          conversationId: result.id,
          relatedProjectIds,
        });
        invalidateAppTopics('projects');
      }

      if (liveEntry) {
        destroySession(conversationId);
      }

      publishConversationSessionMetaChanged(conversationId, result.id);
      res.json({ id: result.id, sessionFile: result.sessionFile, cwd: nextCwd, changed: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
