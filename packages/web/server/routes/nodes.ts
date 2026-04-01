import type { Express } from 'express';
import { listProfiles } from '@personal-agent/resources';
import { getProfilesRoot } from '@personal-agent/core';
import { listNodeBrowserData } from '../knowledge/nodes.js';
import { logError } from '../middleware/index.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for node routes');
};

let getRepoRootFn: () => string = () => process.cwd();

export function setNodeRoutesGetters(
  getCurrentProfile: () => string,
  getRepoRoot: () => string,
): void {
  getCurrentProfileFn = getCurrentProfile;
  getRepoRootFn = getRepoRoot;
}

function resolveRequestedProfile(viewProfile: unknown): string {
  const requested = typeof viewProfile === 'string' ? viewProfile.trim() : '';
  if (!requested) {
    return getCurrentProfileFn();
  }

  const availableProfiles = listProfiles({
    repoRoot: getRepoRootFn(),
    profilesRoot: getProfilesRoot(),
  });
  if (!availableProfiles.includes(requested)) {
    throw new Error(`Unknown profile: ${requested}`);
  }

  return requested;
}

export function registerNodeRoutes(router: Pick<Express, 'get'>): void {
  router.get('/api/nodes', (req, res) => {
    try {
      const profile = resolveRequestedProfile(req.query.viewProfile);
      res.json(listNodeBrowserData(profile));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
    }
  });
}
