import type { Express, Request, Response } from 'express';

import { logError } from '../middleware/index.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { persistSettingsWrite } from '../ui/settingsPersistence.js';
import { readSavedUiPreferences, writeSavedUiPreferences } from '../ui/uiPreferences.js';
import type { ServerRouteContext } from './context.js';

let getUiSettingsFileFn: () => string = () => {
  throw new Error('getUiSettingsFile not initialized for UI preference routes');
};

function initializeUiPreferenceRoutesContext(context: Pick<ServerRouteContext, 'getSettingsFile'>): void {
  getUiSettingsFileFn = context.getSettingsFile;
}

function handleOpenConversationLayoutReadRequest(_req: Request, res: Response): void {
  try {
    const saved = readSavedUiPreferences(getUiSettingsFileFn());
    res.json({
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
      archivedSessionIds: saved.archivedConversationIds,
      workspacePaths: saved.workspacePaths,
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
    const { sessionIds, pinnedSessionIds, archivedConversationIds, archivedSessionIds, workspacePaths } = req.body as {
      sessionIds?: unknown;
      pinnedSessionIds?: unknown;
      archivedConversationIds?: unknown;
      archivedSessionIds?: unknown;
      workspacePaths?: unknown;
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

    if (workspacePaths !== undefined && !Array.isArray(workspacePaths)) {
      res.status(400).json({ error: 'workspacePaths must be an array when provided' });
      return;
    }

    if (
      sessionIds === undefined &&
      pinnedSessionIds === undefined &&
      archivedConversationIds === undefined &&
      archivedSessionIds === undefined &&
      workspacePaths === undefined
    ) {
      res.status(400).json({ error: 'sessionIds, pinnedSessionIds, archived conversation ids, or workspacePaths required' });
      return;
    }

    const saved = persistSettingsWrite(
      (settingsFile) =>
        writeSavedUiPreferences(
          {
            openConversationIds: sessionIds as string[] | null | undefined,
            pinnedConversationIds: pinnedSessionIds as string[] | null | undefined,
            archivedConversationIds: (archivedConversationIds ?? archivedSessionIds) as string[] | null | undefined,
            workspacePaths: workspacePaths as string[] | null | undefined,
          },
          settingsFile,
        ),
      { runtimeSettingsFile: getUiSettingsFileFn() },
    );

    if (
      sessionIds !== undefined ||
      pinnedSessionIds !== undefined ||
      archivedConversationIds !== undefined ||
      archivedSessionIds !== undefined
    ) {
      invalidateAppTopics('sessions');
    }
    if (workspacePaths !== undefined) {
      invalidateAppTopics('workspace');
    }

    res.json({
      ok: true,
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
      archivedConversationIds: saved.archivedConversationIds,
      workspacePaths: saved.workspacePaths,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

export function registerUiPreferenceRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch'>,
  context: Pick<ServerRouteContext, 'getSettingsFile'>,
): void {
  initializeUiPreferenceRoutesContext(context);
  router.get('/api/ui/open-conversations', handleOpenConversationLayoutReadRequest);
  router.patch('/api/ui/open-conversations', handleOpenConversationLayoutWriteRequest);
}
