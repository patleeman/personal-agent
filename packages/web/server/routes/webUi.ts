import type { Express, Request, Response } from 'express';
import type { ServerRouteContext } from './context.js';
import { readWebUiState, syncConfiguredWebUiTailscaleServe, writeWebUiConfig } from '../ui/webUi.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from '../ui/webUiPreferences.js';
import { logError } from '../middleware/index.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';
import { invalidateAppTopics } from '../shared/appEvents.js';


let getWebUiSettingsFileFn: () => string = () => {
  throw new Error('getWebUiSettingsFile not initialized for web-ui routes');
};

function initializeWebUiRoutesContext(
  context: Pick<ServerRouteContext, 'getSettingsFile'>,
): void {
  getWebUiSettingsFileFn = context.getSettingsFile;
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

function handleWebUiConfigPatch(req: Request, res: Response): void {
  try {
    const {
      useTailscaleServe,
      resumeFallbackPrompt,
    } = req.body as {
      useTailscaleServe?: unknown;
      resumeFallbackPrompt?: unknown;
    };

    if (useTailscaleServe === undefined && resumeFallbackPrompt === undefined) {
      res.status(400).json({ error: 'Provide useTailscaleServe and/or resumeFallbackPrompt.' });
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
      ...(useTailscaleServe !== undefined ? { useTailscaleServe } : {}),
      ...(resumeFallbackPrompt !== undefined ? { resumeFallbackPrompt } : {}),
    });

    if (useTailscaleServe !== undefined) {
      syncConfiguredWebUiTailscaleServe(savedConfig.useTailscaleServe);
    }

    const state = readWebUiState();
    invalidateAppTopics('webUi');

    res.json({
      ...state,
      service: {
        ...state.service,
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

export function registerWebUiRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getSettingsFile'>,
): void {
  initializeWebUiRoutesContext(context);
  router.get('/api/web-ui/state', handleWebUiStateRequest);
  router.post('/api/web-ui/config', handleWebUiConfigPatch);
  router.get('/api/web-ui/open-conversations', handleOpenConversationLayoutReadRequest);
  router.patch('/api/web-ui/open-conversations', handleOpenConversationLayoutWriteRequest);
}

