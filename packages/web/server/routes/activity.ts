import type { Express } from 'express';
import type { SavedWebUiPreferences } from '../ui/webUiPreferences.js';
import type { ServerRouteContext } from './context.js';
import {
  clearInboxCapability,
  markActivityReadCapability,
  readActivityCountCapability,
  readActivityDetailCapability,
  readActivityEntriesCapability,
} from '../automation/inboxCapability.js';
import { logError } from '../middleware/index.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for activity routes');
};

let getSavedWebUiPreferencesFn: () => SavedWebUiPreferences = () => ({
  openConversationIds: [],
  pinnedConversationIds: [],
  archivedConversationIds: [],
  nodeBrowserViews: [],
});

function initializeActivityRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getSavedWebUiPreferences'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getSavedWebUiPreferencesFn = context.getSavedWebUiPreferences;
}

export function registerActivityRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getSavedWebUiPreferences'>,
): void {
  initializeActivityRoutesContext(context);
  router.get('/api/activity/count', (_req, res) => {
    try {
      res.json(readActivityCountCapability(getCurrentProfileFn()));
    } catch {
      res.json({ count: 0 });
    }
  });

  router.post('/api/inbox/clear', (_req, res) => {
    try {
      const saved = getSavedWebUiPreferencesFn();
      const result = clearInboxCapability({
        profile: getCurrentProfileFn(),
        openConversationIds: [...saved.openConversationIds, ...saved.pinnedConversationIds],
      });
      res.json({
        ok: true,
        deletedActivityIds: result.deletedActivityIds,
        clearedConversationIds: result.clearedConversationIds,
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/activity', (_req, res) => {
    try {
      res.json(readActivityEntriesCapability(getCurrentProfileFn()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/activity/:id', (req, res) => {
    try {
      const entry = readActivityDetailCapability(getCurrentProfileFn(), req.params.id);
      if (!entry) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.json(entry);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/activity/:id', (req, res) => {
    try {
      const { id } = req.params;
      const { read } = req.body as { read?: boolean };
      const changed = markActivityReadCapability(getCurrentProfileFn(), id, read !== false);
      if (!changed) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
