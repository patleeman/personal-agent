/**
 * App memory routes
 */

import type { Express, Request } from 'express';
import type { ServerRouteContext } from './context.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { getProfilesRoot } from '@personal-agent/core';
import { listProfiles, resolveResourceProfile } from '@personal-agent/resources';
import {
  buildRecentReadUsage,
  clearMemoryBrowserCaches,
  isEditableMemoryFilePath,
  listMemoryDocs,
  listSkillsForProfile,
  normalizeMemoryPath,
} from '../knowledge/memoryDocs.js';
import { logError } from '../middleware/index.js';

let _getCurrentProfile: () => string = () => { throw new Error('not initialized'); };
let _repoRoot = process.cwd();

const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';

function initializeMemoryRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot'>,
): void {
  _getCurrentProfile = context.getCurrentProfile;
  _repoRoot = context.getRepoRoot();
}

function resolveRequestedProfileFromQuery(req: Request): string {
  const requestedProfile = typeof req.query[VIEW_PROFILE_QUERY_PARAM] === 'string'
    ? req.query[VIEW_PROFILE_QUERY_PARAM].trim()
    : '';

  if (!requestedProfile) {
    return _getCurrentProfile();
  }

  const availableProfiles = listProfiles({
    repoRoot: _repoRoot,
    profilesRoot: getProfilesRoot(),
  });
  if (!availableProfiles.includes(requestedProfile)) {
    throw new Error(`Unknown profile: ${requestedProfile}`);
  }

  return requestedProfile;
}

function inferAgentSource(filePath: string, profile: string): string {
  const profilesRoot = getProfilesRoot();
  if (filePath.startsWith(`${profilesRoot}/${profile}/`)) return 'profile';
  if (filePath.includes('/skills/')) return 'global';
  return 'project';
}

export function registerMemoryNotesRoutes(
  router: Pick<Express, 'get' | 'post'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot'>,
): void {
  initializeMemoryRoutesContext(context);

  router.get('/api/memory', (req, res) => {
    try {
      const profile = resolveRequestedProfileFromQuery(req);
      const resolvedProfile = resolveResourceProfile(profile, {
        repoRoot: _repoRoot,
        profilesRoot: getProfilesRoot(),
      });
      const agentsMd = resolvedProfile.agentsFiles.map((filePath) => ({
        source: inferAgentSource(filePath, profile),
        path: filePath,
        exists: existsSync(filePath),
        content: existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined,
      }));
      const skills = listSkillsForProfile(profile);
      const memoryDocs = listMemoryDocs();
      const usageByPath = buildRecentReadUsage([
        ...skills.map((item) => item.path),
        ...memoryDocs.map((item) => item.path),
      ]);

      for (const skill of skills) {
        const usage = usageByPath.get(normalizeMemoryPath(skill.path));
        if (usage) {
          skill.recentSessionCount = usage.recentSessionCount;
          skill.lastUsedAt = usage.lastUsedAt;
          skill.usedInLastSession = usage.usedInLastSession;
        }
      }

      for (const doc of memoryDocs) {
        const usage = usageByPath.get(normalizeMemoryPath(doc.path));
        if (usage) {
          doc.recentSessionCount = usage.recentSessionCount;
          doc.lastUsedAt = usage.lastUsedAt;
          doc.usedInLastSession = usage.usedInLastSession;
        }
      }

      res.json({ profile, agentsMd, skills, memoryDocs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
    }
  });

  router.get('/api/memory/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      if (!isEditableMemoryFilePath(filePath, _getCurrentProfile())) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      if (!existsSync(filePath)) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      res.json({ content: readFileSync(filePath, 'utf-8'), path: filePath });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/memory/file', (req, res) => {
    try {
      const { path: filePath, content } = req.body as { path: string; content: string };
      if (!filePath || content === undefined) {
        res.status(400).json({ error: 'path and content required' });
        return;
      }
      if (!isEditableMemoryFilePath(filePath, _getCurrentProfile())) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      writeFileSync(filePath, content, 'utf-8');
      clearMemoryBrowserCaches();
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
