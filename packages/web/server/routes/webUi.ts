import type { Express, Request, Response } from 'express';
import type { ServerRouteContext } from './context.js';
import { requestWebUiServiceRestart } from '../ui/applicationRestart.js';
import { readWebUiState, installWebUiServiceAndReadState, rollbackWebUiServiceAndReadState, startWebUiServiceAndReadState, markBadWebUiReleaseAndReadState, stopWebUiServiceAndReadState, syncConfiguredWebUiTailscaleServe, uninstallWebUiServiceAndReadState, writeWebUiConfig } from '../ui/webUi.js';
import { writeInternalAttentionEntry } from '../shared/internalAttention.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from '../ui/webUiPreferences.js';
import { logError, logWarn } from '../middleware/index.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { resolveConversationCwd } from '../conversations/conversationCwd.js';
import {
  createSession as createLocalSession,
  queuePromptContext,
} from '../conversations/liveSessions.js';
import { findActivityRecord, type ActivityRecord } from '../automation/inboxService.js';

type LiveSessionCreateOptions = Parameters<typeof createLocalSession>[1];
type LiveSessionResourceOptions = Omit<NonNullable<LiveSessionCreateOptions>, 'extensionFactories'>;
type LiveSessionExtensionFactories = NonNullable<LiveSessionCreateOptions>['extensionFactories'];
import { setActivityConversationLinks } from '@personal-agent/core';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for web-ui routes');
};

let getRepoRootFn: () => string = () => {
  throw new Error('getRepoRoot not initialized for web-ui routes');
};

let getDefaultWebCwdFn: () => string = () => {
  throw new Error('getDefaultWebCwd not initialized for web-ui routes');
};

let getWebUiSettingsFileFn: () => string = () => {
  throw new Error('getWebUiSettingsFile not initialized for web-ui routes');
};

let getStateRootFn: () => string = () => {
  throw new Error('getStateRoot not initialized for web-ui routes');
};

let buildLiveSessionResourceOptionsFn: () => LiveSessionResourceOptions = () => {
  throw new Error('buildLiveSessionResourceOptions not initialized for web-ui routes');
};

let buildLiveSessionExtensionFactoriesFn: () => LiveSessionExtensionFactories = () => {
  throw new Error('buildLiveSessionExtensionFactories not initialized for web-ui routes');
};

function initializeWebUiRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSettingsFile' | 'getStateRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  getWebUiSettingsFileFn = context.getSettingsFile;
  getStateRootFn = context.getStateRoot;
  getDefaultWebCwdFn = context.getDefaultWebCwd;
  buildLiveSessionResourceOptionsFn = context.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = context.buildLiveSessionExtensionFactories;
}

function normalizeMessageContext(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const trimmed = typeof entry === 'string' ? entry.trim() : '';
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function buildInboxActivityConversationContext(entry: ActivityRecord['entry']): string {
  const lines = [
    'Inbox activity context for this conversation:',
    `- activity id: ${entry.id}`,
    `- kind: ${entry.kind}`,
    `- created at: ${entry.createdAt}`,
    `- summary: ${entry.summary}`,
  ];

  if (entry.notificationState) {
    lines.push(`- notification state: ${entry.notificationState}`);
  }

  if (entry.details && entry.details.trim().length > 0) {
    lines.push('', 'Details:', entry.details.trim());
  }

  lines.push('', 'Use this inbox item as durable context for follow-up in this conversation.');
  return lines.join('\n');
}

function handleOpenConversationLayoutReadRequest(_req: Request, res: Response): void {
  try {
    const saved = readSavedWebUiPreferences(getWebUiSettingsFileFn());
    res.json({
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
      archivedSessionIds: saved.archivedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

async function handleOpenConversationLayoutWriteRequest(req: Request, res: Response): Promise<void> {
  try {
    const {
      sessionIds,
      pinnedSessionIds,
      archivedConversationIds,
      archivedSessionIds,
    } = req.body as {
      sessionIds?: unknown;
      pinnedSessionIds?: unknown;
      archivedConversationIds?: unknown;
      archivedSessionIds?: unknown;
    };

    if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
      res.status(400).json({ error: 'sessionIds must be an array when provided' });
      return;
    }

    if (pinnedSessionIds !== undefined && !Array.isArray(pinnedSessionIds)) {
      res.status(400).json({ error: 'pinnedSessionIds must be an array when provided' });
      return;
    }

    if (archivedConversationIds !== undefined && !Array.isArray(archivedConversationIds)) {
      res.status(400).json({ error: 'archivedConversationIds must be an array when provided' });
      return;
    }

    if (archivedSessionIds !== undefined && !Array.isArray(archivedSessionIds)) {
      res.status(400).json({ error: 'archivedSessionIds must be an array when provided' });
      return;
    }

    if (sessionIds === undefined && pinnedSessionIds === undefined && archivedConversationIds === undefined && archivedSessionIds === undefined) {
      res.status(400).json({ error: 'sessionIds, pinnedSessionIds, or archived conversation ids required' });
      return;
    }

    const saved = persistSettingsWrite(
      (settingsFile) => writeSavedWebUiPreferences({
        openConversationIds: sessionIds as string[] | null | undefined,
        pinnedConversationIds: pinnedSessionIds as string[] | null | undefined,
        archivedConversationIds: (archivedConversationIds ?? archivedSessionIds) as string[] | null | undefined,
      }, settingsFile),
      { runtimeSettingsFile: getWebUiSettingsFileFn() },
    );

    invalidateAppTopics('sessions');

    res.json({
      ok: true,
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
      archivedConversationIds: saved.archivedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiStateRequest(_req: Request, res: Response): void {
  try {
    res.json(readWebUiState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiServiceInstall(_req: Request, res: Response): void {
  try {
    const state = installWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiServiceStart(_req: Request, res: Response): void {
  try {
    const state = startWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiServiceRestart(_req: Request, res: Response): void {
  try {
    res.status(202).json(requestWebUiServiceRestart({ repoRoot: getRepoRootFn() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Managed web UI restart already in progress')
      || message.startsWith('Application restart already in progress')
      || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
}

function handleWebUiServiceRollback(req: Request, res: Response): void {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const snapshot = rollbackWebUiServiceAndReadState({ reason });
    invalidateAppTopics('webUi');
    try {
      writeInternalAttentionEntry({
        repoRoot: getRepoRootFn(),
        stateRoot: getStateRootFn(),
        profile: getCurrentProfileFn(),
        kind: 'deployment',
        summary: 'Web UI rollback complete.',
        details: [
          `Completed: ${new Date().toISOString()}`,
          snapshot.service.deployment?.activeSlot ? `Active slot: ${snapshot.service.deployment.activeSlot}` : undefined,
          snapshot.service.deployment?.activeRelease?.revision ? `Active release: ${snapshot.service.deployment.activeRelease.revision}` : undefined,
          reason ? `Reason: ${reason}` : undefined,
        ].filter((line): line is string => typeof line === 'string').join('\n'),
        idPrefix: 'web-ui-rollback',
      });
    } catch (activityError) {
      logWarn('failed to write web ui rollback activity', {
        message: activityError instanceof Error ? activityError.message : String(activityError),
      });
    }
    res.json(snapshot);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiServiceMarkBad(req: Request, res: Response): void {
  try {
    const slot = req.body?.slot === 'blue' || req.body?.slot === 'green'
      ? req.body.slot
      : undefined;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const snapshot = markBadWebUiReleaseAndReadState({ slot, reason });
    invalidateAppTopics('webUi');
    try {
      writeInternalAttentionEntry({
        repoRoot: getRepoRootFn(),
        stateRoot: getStateRootFn(),
        profile: getCurrentProfileFn(),
        kind: 'deployment',
        summary: 'Web UI release marked bad.',
        details: [
          `Completed: ${new Date().toISOString()}`,
          slot ? `Slot: ${slot}` : undefined,
          snapshot.service.deployment?.activeRelease?.revision ? `Active release: ${snapshot.service.deployment.activeRelease.revision}` : undefined,
          reason ? `Reason: ${reason}` : undefined,
        ].filter((line): line is string => typeof line === 'string').join('\n'),
        idPrefix: 'web-ui-mark-bad',
      });
    } catch (activityError) {
      logWarn('failed to write web ui mark-bad activity', {
        message: activityError instanceof Error ? activityError.message : String(activityError),
      });
    }
    res.json(snapshot);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiServiceStop(_req: Request, res: Response): void {
  try {
    const state = stopWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiServiceUninstall(_req: Request, res: Response): void {
  try {
    const state = uninstallWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleWebUiConfigPatch(req: Request, res: Response): void {
  try {
    const {
      companionPort,
      useTailscaleServe,
      resumeFallbackPrompt,
    } = req.body as {
      companionPort?: unknown;
      useTailscaleServe?: unknown;
      resumeFallbackPrompt?: unknown;
    };

    if (companionPort === undefined && useTailscaleServe === undefined && resumeFallbackPrompt === undefined) {
      res.status(400).json({ error: 'Provide companionPort, useTailscaleServe, and/or resumeFallbackPrompt.' });
      return;
    }

    if (companionPort !== undefined && (!Number.isInteger(companionPort) || Number(companionPort) <= 0 || Number(companionPort) > 65535)) {
      res.status(400).json({ error: 'companionPort must be a valid port when provided.' });
      return;
    }

    if (useTailscaleServe !== undefined && typeof useTailscaleServe !== 'boolean') {
      res.status(400).json({ error: 'useTailscaleServe must be a boolean when provided.' });
      return;
    }

    if (resumeFallbackPrompt !== undefined && typeof resumeFallbackPrompt !== 'string') {
      res.status(400).json({ error: 'resumeFallbackPrompt must be a string when provided.' });
      return;
    }

    const savedConfig = writeWebUiConfig({
      ...(companionPort !== undefined ? { companionPort: Number(companionPort) } : {}),
      ...(useTailscaleServe !== undefined ? { useTailscaleServe } : {}),
      ...(resumeFallbackPrompt !== undefined ? { resumeFallbackPrompt } : {}),
    });

    if (useTailscaleServe !== undefined || companionPort !== undefined) {
      syncConfiguredWebUiTailscaleServe(savedConfig.useTailscaleServe);
    }

    const state = readWebUiState();
    invalidateAppTopics('webUi');

    res.json({
      ...state,
      service: {
        ...state.service,
        companionPort: savedConfig.companionPort,
        companionUrl: `http://127.0.0.1:${savedConfig.companionPort}`,
        tailscaleServe: savedConfig.useTailscaleServe,
        resumeFallbackPrompt: savedConfig.resumeFallbackPrompt,
      },
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

async function handleActivityStart(req: Request, res: Response): Promise<void> {
  try {
    const profile = getCurrentProfileFn();
    const match = findActivityRecord(profile, req.params.id);

    if (!match) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const entry = match.entry;
    const cwd = resolveConversationCwd({
      repoRoot: getRepoRootFn(),
      profile,
      defaultCwd: getDefaultWebCwdFn(),
    });

    const result = await createLocalSession(cwd, {
      ...buildLiveSessionResourceOptionsFn(),
      extensionFactories: buildLiveSessionExtensionFactoriesFn(),
    });

    const relatedConversationIds = [...new Set([...(entry.relatedConversationIds ?? []), result.id])];
    setActivityConversationLinks({
      stateRoot: match.stateRoot,
      profile,
      activityId: entry.id,
      relatedConversationIds,
    });

    await queuePromptContext(result.id, 'referenced_context', buildInboxActivityConversationContext({
      ...entry,
      relatedConversationIds,
    }));

    invalidateAppTopics('activity', 'sessions');
    res.json({
      activityId: entry.id,
      id: result.id,
      sessionFile: result.sessionFile,
      cwd,
      relatedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

export function registerWebUiRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSettingsFile' | 'getStateRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories'>,
): void {
  initializeWebUiRoutesContext(context);
  router.get('/api/web-ui/state', handleWebUiStateRequest);
  router.post('/api/web-ui/service/install', handleWebUiServiceInstall);
  router.post('/api/web-ui/service/start', handleWebUiServiceStart);
  router.post('/api/web-ui/service/restart', handleWebUiServiceRestart);
  router.post('/api/web-ui/service/rollback', handleWebUiServiceRollback);
  router.post('/api/web-ui/service/mark-bad', handleWebUiServiceMarkBad);
  router.post('/api/web-ui/service/stop', handleWebUiServiceStop);
  router.post('/api/web-ui/service/uninstall', handleWebUiServiceUninstall);
  router.post('/api/web-ui/config', handleWebUiConfigPatch);
  router.get('/api/web-ui/open-conversations', handleOpenConversationLayoutReadRequest);
  router.patch('/api/web-ui/open-conversations', handleOpenConversationLayoutWriteRequest);
  router.post('/api/activity/:id/start', handleActivityStart);
}

export function registerCompanionWebUiRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getSettingsFile' | 'getStateRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories'>,
): void {
  initializeWebUiRoutesContext(context);
  router.get('/api/web-ui/state', handleWebUiStateRequest);
  router.post('/api/web-ui/service/restart', handleWebUiServiceRestart);
  router.get('/api/web-ui/open-conversations', handleOpenConversationLayoutReadRequest);
  router.patch('/api/web-ui/open-conversations', handleOpenConversationLayoutWriteRequest);
  router.post('/api/activity/:id/start', handleActivityStart);
}
