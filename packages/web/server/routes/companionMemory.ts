/**
 * Companion memory, notes, and model-preferences routes
 *
 * Memory browsing, skills, notes, and model-preference routes for the companion surface.
 */

import type { Express } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import {
  readConversationModelPreferenceStateById,
} from '../services/conversationService.js';
import {
  listMemoryDocs,
  readNoteDetail,
  createMemoryDoc,
  buildStructuredNoteMarkdown,
  generateCreatedNoteId,
  normalizeCreatedNoteTitle,
  normalizeCreatedNoteSummary,
  normalizeCreatedNoteDescription,
  normalizeNoteBody,
  extractNoteSummaryFromBody,
  clearMemoryBrowserCaches,
  listSkillsForProfile,
} from '../memoryDocs.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

export function registerCompanionMemoryRoutes(router: Pick<Express, 'get'>): void {
  router.get('/api/memory', (_req, res) => {
    try {
      const skills = listSkillsForProfile();
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
      if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
      if (!existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
      const content = readFileSync(filePath, 'utf-8');
      res.json({ content, path: filePath });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/skills/:name', (req, res) => {
    try {
      const skillDetail = listSkillsForProfile().find((s) => s.name === req.params.name);
      if (!skillDetail) { res.status(404).json({ error: 'Skill not found' }); return; }
      res.json(skillDetail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
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

  // PATCH is not implemented in companion — surface changes must go through app
  router.patch('/api/conversations/:id/model-preferences', async (_req, res) => {
    res.status(405).json({ error: 'Per-conversation model changes are not supported for remote conversations yet.' });
  });
}

export function registerCompanionNoteRoutes(router: Pick<Express, 'get' | 'post'>): void {
  router.post('/api/notes', (req, res) => {
    try {
      const title = normalizeCreatedNoteTitle(req.body?.title);
      if (title.length === 0) { res.status(400).json({ error: 'title required' }); return; }
      const editableBody = normalizeNoteBody(req.body?.body);
      const summary = normalizeCreatedNoteSummary(req.body?.summary)
        || extractNoteSummaryFromBody(editableBody)
        || `Personal note about ${title}.`;
      const descriptionVal = normalizeCreatedNoteDescription(req.body?.description);
      const noteId = generateCreatedNoteId(title);
      const created = createMemoryDoc({
        id: noteId,
        title,
        summary: summary ?? undefined,
        description: descriptionVal,
        status: 'active',
      });
      writeFileSync(created.filePath!, buildStructuredNoteMarkdown(readFileSync(created.filePath!, 'utf-8'), {
        noteId,
        title,
        summary,
        description: descriptionVal,
        descriptionProvided: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'description'),
        body: editableBody,
      }), 'utf-8');
      clearMemoryBrowserCaches();
      res.status(201).json(readNoteDetail(noteId));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/notes/:memoryId', (req, res) => {
    try {
      res.json(readNoteDetail(req.params.memoryId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(message === 'Note not found.' || message === 'Note file not found.' ? 404 : 500).json({ error: message });
    }
  });
}
