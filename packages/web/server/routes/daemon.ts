/**
 * Daemon routes
 * 
 * Handles daemon service lifecycle management (install, start, stop, restart, uninstall).
 */

import type { Express } from 'express';
import {
  installDaemonServiceAndReadState,
  readDaemonState,
  restartDaemonServiceAndReadState,
  startDaemonServiceAndReadState,
  stopDaemonServiceAndReadState,
  uninstallDaemonServiceAndReadState,
} from '../automation/daemon.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';
import { suppressMonitoredServiceAttention } from '../shared/internalAttention.js';

function mapDaemonServiceLifecycleErrorStatus(message: string): number {
  if (message.startsWith('Managed daemon service lifecycle is unavailable in desktop runtime')) {
    return 400;
  }

  return 500;
}

/**
 * Register daemon routes on the given router.
 */
export function registerDaemonRoutes(router: Pick<Express, 'get' | 'post'>): void {
  router.get('/api/daemon', async (_req, res) => {
    try {
      res.json(await readDaemonState());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/daemon/service/install', async (_req, res) => {
    try {
      suppressMonitoredServiceAttention('daemon');
      const state = await installDaemonServiceAndReadState();
      invalidateAppTopics('daemon');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(mapDaemonServiceLifecycleErrorStatus(message)).json({ error: message });
    }
  });

  router.post('/api/daemon/service/start', async (_req, res) => {
    try {
      suppressMonitoredServiceAttention('daemon');
      const state = await startDaemonServiceAndReadState();
      invalidateAppTopics('daemon');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(mapDaemonServiceLifecycleErrorStatus(message)).json({ error: message });
    }
  });

  router.post('/api/daemon/service/restart', async (_req, res) => {
    try {
      suppressMonitoredServiceAttention('daemon');
      const state = await restartDaemonServiceAndReadState();
      invalidateAppTopics('daemon');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(mapDaemonServiceLifecycleErrorStatus(message)).json({ error: message });
    }
  });

  router.post('/api/daemon/service/stop', async (_req, res) => {
    try {
      suppressMonitoredServiceAttention('daemon');
      const state = await stopDaemonServiceAndReadState();
      invalidateAppTopics('daemon');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(mapDaemonServiceLifecycleErrorStatus(message)).json({ error: message });
    }
  });

  router.post('/api/daemon/service/uninstall', async (_req, res) => {
    try {
      suppressMonitoredServiceAttention('daemon');
      const state = await uninstallDaemonServiceAndReadState();
      invalidateAppTopics('daemon');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(mapDaemonServiceLifecycleErrorStatus(message)).json({ error: message });
    }
  });
}

export function registerCompanionDaemonRoutes(router: Pick<Express, 'get' | 'post'>): void {
  router.get('/api/daemon', async (_req, res) => {
    try {
      res.json(await readDaemonState());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/daemon/service/restart', async (_req, res) => {
    try {
      suppressMonitoredServiceAttention('daemon');
      const state = await restartDaemonServiceAndReadState();
      invalidateAppTopics('daemon');
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(mapDaemonServiceLifecycleErrorStatus(message)).json({ error: message });
    }
  });
}
