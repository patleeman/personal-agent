/**
 * App memory, notes routes
 */

import type { Express, Request } from 'express';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { LiveSessionResourceOptions, ServerRouteContext } from './context.js';
import { existsSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  getProfilesRoot,
  listAllProjectIds,
  setConversationProjectLinks,
} from '@personal-agent/core';
import { listProfiles, resolveResourceProfile } from '@personal-agent/resources';
import {
  listMemoryDocs,
  findMemoryDocById,
  readNoteDetail,
  createMemoryDoc,
  buildStructuredNoteMarkdown,
  normalizeCreatedNoteTitle,
  normalizeCreatedNoteSummary,
  normalizeCreatedNoteDescription,
  normalizeNoteBody,
  extractNoteSummaryFromBody,
  clearMemoryBrowserCaches,
  listSkillsForProfile,
  readSkillDetailForProfile,
  isEditableMemoryFilePath,
  buildRecentReadUsage,
  normalizeMemoryPath,
} from '../knowledge/memoryDocs.js';
import { buildReferencedMemoryDocsContext } from '../knowledge/promptReferences.js';
import { buildConversationMemoryWorkItemsFromStates, listConversationMemoryMaintenanceStates } from '../conversations/conversationMemoryMaintenance.js';
import { createSession as createLocalSession, queuePromptContext } from '../conversations/liveSessions.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

let _getCurrentProfile: () => string = () => { throw new Error('not initialized'); };
let _repoRoot: string = process.cwd();
let _getDefaultWebCwd: () => string = () => process.cwd();
let _resolveRequestedCwd: (requestedCwd: string | null | undefined, fallbackCwd?: string) => string | undefined = (requestedCwd, fallbackCwd) => requestedCwd?.trim() || fallbackCwd?.trim() || process.cwd();
let _buildLiveSessionResourceOptions: (profile?: string) => LiveSessionResourceOptions = () => ({ additionalExtensionPaths: [], additionalSkillPaths: [], additionalPromptTemplatePaths: [], additionalThemePaths: [] });
let _buildLiveSessionExtensionFactories: () => ExtensionFactory[] = () => [];

const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';

function initializeMemoryNotesRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'resolveRequestedCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories'>,
): void {
  _getCurrentProfile = context.getCurrentProfile;
  _repoRoot = context.getRepoRoot();
  _getDefaultWebCwd = context.getDefaultWebCwd;
  _resolveRequestedCwd = context.resolveRequestedCwd;
  _buildLiveSessionResourceOptions = context.buildLiveSessionResourceOptions;
  _buildLiveSessionExtensionFactories = context.buildLiveSessionExtensionFactories;
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

function listReferenceableProjectIds(): string[] {
  return listAllProjectIds({ repoRoot: _repoRoot });
}

interface AgentsItem {
  source: string;
  path: string;
  exists: boolean;
  content?: string;
}

function inferAgentSource(filePath: string, profile: string): string {
  const profilesRoot = getProfilesRoot();
  if (filePath.startsWith(`${profilesRoot}/${profile}/`)) return 'profile';
  if (filePath.includes('/skills/')) return 'global';
  return 'project';
}

function generateNoteId(title: string): string {
  const existingIds = new Set(listMemoryDocs().map((e) => e.id));
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 52).replace(/-+$/g, '') || 'note';
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < Number.MAX_SAFE_INTEGER; i++) {
    const candidate = `${base.slice(0, 52 - String(i).length - 1)}-${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export function registerMemoryNotesRoutes(
  router: Pick<Express, 'get' | 'post' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'resolveRequestedCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories'>,
): void {
  initializeMemoryNotesRoutesContext(context);
  router.get('/api/memory', (req, res) => {
    try {
      const profile = resolveRequestedProfileFromQuery(req) as string;
      const resolvedProfile = resolveResourceProfile(profile, {
        repoRoot: _repoRoot,
        profilesRoot: getProfilesRoot(),
      });
      const agentsMd: AgentsItem[] = resolvedProfile.agentsFiles.map((filePath) => ({
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
      if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
      if (!isEditableMemoryFilePath(filePath)) { res.status(403).json({ error: 'Access denied' }); return; }
      if (!existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
      res.json({ content: readFileSync(filePath, 'utf-8'), path: filePath });
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/skills/:name', (req, res) => {
    try {
      const profile = resolveRequestedProfileFromQuery(req) as string;
      res.json(readSkillDetailForProfile(req.params.name, profile));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.startsWith('Skill not found:') || message.startsWith('Skill file not found:') ? 404 : 500).json({ error: message });
    }
  });

  router.post('/api/memory/file', (req, res) => {
    try {
      const { path: filePath, content } = req.body as { path: string; content: string };
      if (!filePath || content === undefined) { res.status(400).json({ error: 'path and content required' }); return; }
      if (!isEditableMemoryFilePath(filePath)) { res.status(403).json({ error: 'Access denied' }); return; }
      writeFileSync(filePath, content, 'utf-8');
      clearMemoryBrowserCaches();
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/notes', (_req, res) => {
    try {
      res.json({ memories: listMemoryDocs({ includeSearchText: true }) });
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/notes/work-queue', (_req, res) => {
    try {
      const memoryQueue = buildConversationMemoryWorkItemsFromStates(
        listConversationMemoryMaintenanceStates({ profile: _getCurrentProfile() }),
      );
      res.json({ memoryQueue });
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/notes', (req, res) => {
    try {
      const title = normalizeCreatedNoteTitle(req.body?.title);
      if (title.length === 0) { res.status(400).json({ error: 'title required' }); return; }
      const editableBody = normalizeNoteBody(req.body?.body);
      const summary = normalizeCreatedNoteSummary(req.body?.summary)
        || extractNoteSummaryFromBody(editableBody)
        || `Personal note about ${title}.`;
      const description = normalizeCreatedNoteDescription(req.body?.description);
      const noteId = generateNoteId(title);
      const { id: _id, filePath } = createMemoryDoc({
        id: noteId,
        title,
        summary,
        description,
        status: 'active',
      });
      const descriptionVal = normalizeCreatedNoteDescription(req.body?.description);
      writeFileSync(filePath!, buildStructuredNoteMarkdown(readFileSync(filePath!, 'utf-8'), {
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
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/notes/:memoryId', (req, res) => {
    try {
      res.json(readNoteDetail(req.params.memoryId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(message === 'Note not found.' || message === 'Note file not found.' ? 404 : 500).json({ error: message });
    }
  });

  router.post('/api/notes/:memoryId', (req, res) => {
    try {
      const memory = findMemoryDocById(req.params.memoryId);
      if (!memory) { res.status(404).json({ error: 'Note not found.' }); return; }
      const { content, title, summary, description, body } = req.body as {
        content?: string; title?: string; summary?: string; description?: string; body?: string;
      };
      if (typeof content === 'string') {
        writeFileSync(memory.path, content, 'utf-8');
      } else if (typeof title === 'string' && typeof body === 'string') {
        const descriptionVal = normalizeCreatedNoteDescription(description);
        writeFileSync(memory.path, buildStructuredNoteMarkdown(readFileSync(memory.path, 'utf-8'), {
          noteId: memory.id,
          title,
          summary,
          description: descriptionVal,
          descriptionProvided: Object.prototype.hasOwnProperty.call(req.body ?? {}, 'description'),
          body,
        }), 'utf-8');
      } else {
        res.status(400).json({ error: 'content or { title, body } required' }); return;
      }
      clearMemoryBrowserCaches();
      res.json(readNoteDetail(memory.id));
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.delete('/api/notes/:memoryId', (req, res) => {
    try {
      const memory = findMemoryDocById(req.params.memoryId);
      if (!memory) { res.status(404).json({ error: 'Note not found.' }); return; }
      if (!existsSync(memory.path)) { res.status(404).json({ error: 'Note file not found.' }); return; }
      rmSync(dirname(memory.path), { recursive: true, force: true });
      clearMemoryBrowserCaches();
      res.json({ deleted: true, memoryId: memory.id });
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/notes/:memoryId/start', async (req, res) => {
    try {
      const profile = _getCurrentProfile();
      const memoryId = req.params.memoryId;
      const memory = listMemoryDocs().find((entry: { id: string }) => entry.id === memoryId);
      if (!memory) { res.status(404).json({ error: 'Note not found.' }); return; }
      const sourceCwd = '';
      const defaultWebCwd = _getDefaultWebCwd();
      const { cwd: requestedCwd } = req.body as { cwd?: string };
      let nextCwd = _resolveRequestedCwd(requestedCwd, sourceCwd || defaultWebCwd);
      if (!nextCwd && !requestedCwd) nextCwd = defaultWebCwd;
      if (!nextCwd) { res.status(400).json({ error: 'cwd required' }); return; }
      if ((!existsSync(nextCwd) || !statSync(nextCwd).isDirectory()) && !requestedCwd && nextCwd !== defaultWebCwd) nextCwd = defaultWebCwd;
      if (!existsSync(nextCwd)) { res.status(400).json({ error: `Directory does not exist: ${nextCwd}` }); return; }
      if (!statSync(nextCwd).isDirectory()) { res.status(400).json({ error: `Not a directory: ${nextCwd}` }); return; }
      const result = await createLocalSession(nextCwd, {
        ..._buildLiveSessionResourceOptions(profile),
        extensionFactories: _buildLiveSessionExtensionFactories(),
      });
      const requestedRelatedProjectIds: string[] = [];
      const availableProjectIds = new Set(listReferenceableProjectIds());
      const relatedProjectIds = requestedRelatedProjectIds.filter((projectId: string) => availableProjectIds.has(projectId));
      if (relatedProjectIds.length > 0) {
        setConversationProjectLinks({ profile, conversationId: result.id, relatedProjectIds });
        invalidateAppTopics('projects');
      }
      await queuePromptContext(result.id, 'referenced_context', buildReferencedMemoryDocsContext([
        { id: memory.id, title: memory.title, summary: memory.summary ?? '', description: memory.description, path: memory.path, updated: memory.updated },
      ], _repoRoot));
      res.json({ memoryId, id: result.id, sessionFile: result.sessionFile, cwd: nextCwd });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: message });
    }
  });
}
