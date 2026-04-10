/**
 * Alert routes
 * 
 * Handles CRUD operations for user alerts including acknowledgement, dismissal,
 * and snoozing functionality.
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  acknowledgeAlertCapability,
  dismissAlertCapability,
  readAlertCapability,
  readAlertSnapshotCapability,
  snoozeAlertCapability,
} from '../automation/alertCapability.js';
import { logError } from '../middleware/index.js';

/**
 * Gets the current profile getter for use in route handlers.
 * This should be set during server initialization.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for alert routes');
};

function initializeAlertRoutesContext(context: Pick<ServerRouteContext, 'getCurrentProfile'>): void {
  getCurrentProfileFn = context.getCurrentProfile;
}

/**
 * Register alert routes on the given router.
 * Routes:
 *   GET  /api/alerts         - Get snapshot of all alerts
 *   GET  /api/alerts/:id     - Get a specific alert
 *   POST /api/alerts/:id/ack - Acknowledge an alert
 *   POST /api/alerts/:id/dismiss - Dismiss an alert
 *   POST /api/alerts/:id/snooze  - Snooze an alert
 */
export function registerAlertRoutes(
  router: Pick<Express, 'get' | 'post'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile'>,
): void {
  initializeAlertRoutesContext(context);
  router.get('/api/alerts', (_req, res) => {
    try {
      res.json(readAlertSnapshotCapability(getCurrentProfileFn()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/alerts/:id', (req, res) => {
    try {
      const alert = readAlertCapability(getCurrentProfileFn(), req.params.id);
      if (!alert) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.json(alert);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/alerts/:id/ack', (req, res) => {
    try {
      const alert = acknowledgeAlertCapability(getCurrentProfileFn(), req.params.id);
      if (!alert) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.json({ ok: true, alert });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/alerts/:id/dismiss', (req, res) => {
    try {
      const alert = dismissAlertCapability(getCurrentProfileFn(), req.params.id);
      if (!alert) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.json({ ok: true, alert });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/alerts/:id/snooze', async (req, res) => {
    try {
      const { delay, at } = req.body as { delay?: string; at?: string };
      const result = await snoozeAlertCapability(getCurrentProfileFn(), req.params.id, { delay, at });
      if (!result) {
        res.status(404).json({ error: 'Not found' });
        return;
      }

      res.json({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });
}
