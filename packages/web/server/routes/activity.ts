import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  clearInboxForCurrentProfile,
  findActivityRecord,
  listActivityForCurrentProfile,
  markActivityReadState,
} from '../automation/inboxService.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { logError } from '../middleware/index.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for activity routes');
};

function initializeActivityRoutesContext(context: Pick<ServerRouteContext, 'getCurrentProfile'>): void {
  getCurrentProfileFn = context.getCurrentProfile;
}

export function registerActivityRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile'>,
): void {
  initializeActivityRoutesContext(context);
  router.get('/api/activity/count', (_req, res) => {
    try {
      res.json({ count: listActivityForCurrentProfile(getCurrentProfileFn()).filter(a => !a.read).length });
    } catch {
      res.json({ count: 0 });
    }
  });

  router.post('/api/inbox/clear', (_req, res) => {
    try {
      const result = clearInboxForCurrentProfile(getCurrentProfileFn());
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
      res.json(listActivityForCurrentProfile(getCurrentProfileFn()));
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
      const profile = getCurrentProfileFn();
      const match = findActivityRecord(profile, req.params.id);
      if (!match) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.json({ ...match.entry, read: match.read });
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
      const profile = getCurrentProfileFn();
      const { id } = req.params;
      const { read } = req.body as { read?: boolean };
      const changed = markActivityReadState(profile, id, read !== false);
      if (!changed) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      invalidateAppTopics('activity');
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
