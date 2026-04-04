/**
 * Companion memory and model-preference routes
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import { existsSync, readFileSync } from 'node:fs';
import {
  readConversationModelPreferenceStateById,
} from '../conversations/conversationService.js';
import {
  isEditableMemoryFilePath,
  listMemoryDocs,
  listSkillsForProfile,
} from '../knowledge/memoryDocs.js';
import { logError } from '../middleware/index.js';

export function registerCompanionMemoryRoutes(
  router: Pick<Express, 'get'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile'>,
): void {
  router.get('/api/memory', (_req, res) => {
    try {
      const skills = listSkillsForProfile(context.getCurrentProfile());
      const memoryDocs = listMemoryDocs();
      res.json({ skills, memoryDocs });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/memory/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: 'path required' });
        return;
      }
      if (!isEditableMemoryFilePath(filePath, context.getCurrentProfile())) {
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
}

export function registerCompanionModelPreferenceRoutes(router: Pick<Express, 'get' | 'patch'>): void {
  router.get('/api/conversations/:id/model-preferences', async (req, res) => {
    try {
      const state = await readConversationModelPreferenceStateById(req.params.id);
      if (!state) { res.status(404).json({ error: 'Conversation preferences not found.' }); return; }
      res.json(state);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.patch('/api/conversations/:id/model-preferences', async (_req, res) => {
    res.status(405).json({ error: 'Per-conversation model changes are not supported for remote conversations yet.' });
  });
}
