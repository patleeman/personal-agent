/**
 * App memory routes
 */

import { existsSync, readFileSync } from 'node:fs';

import { getDurableAgentFilePath, getProfilesRoot, getVaultRoot } from '@personal-agent/core';
import { resolveResourceProfile } from '@personal-agent/core';
import type { Express } from 'express';

import { buildRecentReadUsage, listMemoryDocs, listSkillsForProfile, normalizeMemoryPath } from '../knowledge/memoryDocs.js';
import { logError } from '../middleware/index.js';
import { readVaultFilesCapability } from '../workspace/workspaceDesktopCapability.js';
import type { ServerRouteContext } from './context.js';

let _getCurrentProfile: () => string = () => {
  throw new Error('not initialized');
};
let _repoRoot = process.cwd();

function initializeMemoryRoutesContext(context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot'>): void {
  _getCurrentProfile = context.getCurrentProfile;
  _repoRoot = context.getRepoRoot();
}

function inferAgentSource(filePath: string): string {
  const baseAgentFile = getDurableAgentFilePath(getVaultRoot());
  if (filePath === baseAgentFile) return 'vault';
  if (filePath.includes('/skills/')) return 'global';
  return 'project';
}

export function registerMemoryNotesRoutes(
  router: Pick<Express, 'get'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot'>,
): void {
  initializeMemoryRoutesContext(context);

  router.get('/api/memory', (req, res) => {
    try {
      void req;
      const resolvedProfile = resolveResourceProfile(_getCurrentProfile(), {
        repoRoot: _repoRoot,
        profilesRoot: getProfilesRoot(),
      });
      const agentsMd = resolvedProfile.agentsFiles.map((filePath) => ({
        source: inferAgentSource(filePath),
        path: filePath,
        exists: existsSync(filePath),
        content: existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined,
      }));
      const skills = listSkillsForProfile(_getCurrentProfile());
      const memoryDocs = listMemoryDocs();
      const usageByPath = buildRecentReadUsage([...skills.map((item) => item.path), ...memoryDocs.map((item) => item.path)]);

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

      res.json({ agentsMd, skills, memoryDocs });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: message });
    }
  });

  router.get('/api/vault-files', (_req, res) => {
    try {
      res.json(readVaultFilesCapability());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: message });
    }
  });
}
