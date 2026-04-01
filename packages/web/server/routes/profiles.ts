/**
 * Profile routes
 * 
 * Handles profile listing and switching functionality.
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

/**
 * Gets the current profile getter/setter for use in route handlers.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for profile routes');
};

let setCurrentProfileFn: (profile: string) => Promise<string> = async () => {
  throw new Error('setCurrentProfile not initialized for profile routes');
};

let listAvailableProfilesFn: () => string[] = () => {
  throw new Error('listAvailableProfiles not initialized for profile routes');
};

function initializeProfileRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'setCurrentProfile' | 'listAvailableProfiles'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  setCurrentProfileFn = context.setCurrentProfile;
  listAvailableProfilesFn = context.listAvailableProfiles;
}

/**
 * Register profile routes on the given router.
 */
export function registerProfileRoutes(
  router: Pick<Express, 'get' | 'patch'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'setCurrentProfile' | 'listAvailableProfiles'>,
): void {
  initializeProfileRoutesContext(context);
  router.get('/api/profiles', (_req, res) => {
    try {
      res.json({
        currentProfile: getCurrentProfileFn(),
        profiles: listAvailableProfilesFn(),
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/profiles/current', async (req, res) => {
    try {
      const { profile } = req.body as { profile?: string };
      if (!profile) { res.status(400).json({ error: 'profile required' }); return; }
      res.json({ ok: true, currentProfile: await setCurrentProfileFn(profile) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = message.startsWith('Unknown profile:') ? 400 : 500;
      res.status(status).json({ error: message });
    }
  });
}
