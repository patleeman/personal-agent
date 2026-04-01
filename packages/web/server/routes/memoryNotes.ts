/**
 * App memory, notes routes
 */

import type { Express, Request } from 'express';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import type { LiveSessionResourceOptions, ServerRouteContext } from './context.js';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  createSkillDoc,
  buildStructuredNoteMarkdown,
  normalizeCreatedNoteTitle,
  normalizeCreatedNoteSummary,
  normalizeCreatedNoteDescription,
  normalizeNoteBody,
  extractNoteSummaryFromBody,
  clearMemoryBrowserCaches,
  listSkillsForProfile,
  readSkillDetailForProfile,
  readSkillWorkspaceDetailForProfile,
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

function inferCaptureTitle(title: string | undefined, body: string): string {
  const normalizedTitle = title?.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  const firstLine = body.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
  return firstLine ? firstLine.slice(0, 80) : 'Quick capture';
}

function summarizeCaptureBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 160) || 'Captured note.';
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function extractHtmlTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] ?? '').slice(0, 160);
}

async function captureUrl(url: string): Promise<{
  finalUrl: string;
  title: string;
  contentType: string;
  raw: string;
  extractedText: string;
}> {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
    headers: {
      'User-Agent': 'personal-agent/knowledge-capture',
      Accept: 'text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.5',
    },
  });
  if (!response.ok) {
    throw new Error(`Capture failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type')?.trim() || 'application/octet-stream';
  const raw = await response.text();
  const isHtml = /html|xml/i.test(contentType);
  const extractedText = (isHtml ? stripHtml(raw) : raw.trim()).slice(0, 20000);
  const title = isHtml ? extractHtmlTitle(raw) : raw.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim().slice(0, 160) ?? '';
  return {
    finalUrl: response.url,
    title,
    contentType,
    raw,
    extractedText,
  };
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
      if (!isEditableMemoryFilePath(filePath, _getCurrentProfile())) { res.status(403).json({ error: 'Access denied' }); return; }
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
      const detail = readSkillWorkspaceDetailForProfile(req.params.name, profile);
      if (!detail) {
        res.status(404).json({ error: 'Skill not found.' });
        return;
      }
      res.json(detail);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.startsWith('Skill not found:') || message.startsWith('Skill file not found:') ? 404 : 500).json({ error: message });
    }
  });

  router.post('/api/skills', (req, res) => {
    try {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const name = typeof req.body?.name === 'string' && req.body.name.trim().length > 0
        ? req.body.name.trim()
        : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      if (!title || !name) {
        res.status(400).json({ error: 'title required' });
        return;
      }

      const created = createSkillDoc({
        name,
        title,
        description: typeof req.body?.description === 'string' ? req.body.description : '',
        body: typeof req.body?.body === 'string' ? req.body.body : undefined,
        profile: _getCurrentProfile(),
      });
      clearMemoryBrowserCaches();
      const detail = readSkillDetailForProfile(created.name, _getCurrentProfile());
      if (!detail) {
        res.status(500).json({ error: 'Created skill could not be loaded.' });
        return;
      }
      res.status(201).json({
        skill: detail,
        content: readFileSync(detail.path, 'utf-8'),
        references: [],
        links: {
          outgoing: [],
          incoming: [],
          unresolved: [],
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(message.includes('already exists') ? 409 : 500).json({ error: message });
    }
  });

  router.post('/api/memory/file', (req, res) => {
    try {
      const { path: filePath, content } = req.body as { path: string; content: string };
      if (!filePath || content === undefined) { res.status(400).json({ error: 'path and content required' }); return; }
      if (!isEditableMemoryFilePath(filePath, _getCurrentProfile())) { res.status(403).json({ error: 'Access denied' }); return; }
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

  router.post('/api/captures', (req, res) => {
    try {
      const body = normalizeNoteBody(req.body?.body);
      if (!body) {
        res.status(400).json({ error: 'body required' });
        return;
      }
      const title = inferCaptureTitle(typeof req.body?.title === 'string' ? req.body.title : undefined, body);
      const noteId = generateNoteId(title);
      const created = createMemoryDoc({
        id: noteId,
        title,
        summary: summarizeCaptureBody(body),
        status: 'inbox',
        type: 'capture',
      });
      writeFileSync(created.filePath!, buildStructuredNoteMarkdown(readFileSync(created.filePath!, 'utf-8'), {
        noteId,
        title,
        summary: summarizeCaptureBody(body),
        body,
      }), 'utf-8');
      clearMemoryBrowserCaches();
      res.status(201).json(readNoteDetail(noteId, _getCurrentProfile()));
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/captures/url', async (req, res) => {
    try {
      const rawUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
      if (!rawUrl) {
        res.status(400).json({ error: 'url required' });
        return;
      }
      const parsed = new URL(rawUrl);
      const captured = await captureUrl(parsed.toString());
      const title = inferCaptureTitle(typeof req.body?.title === 'string' ? req.body.title : captured.title, captured.title || parsed.hostname);
      const noteId = generateNoteId(title);
      const summary = summarizeCaptureBody(captured.extractedText || title);
      const created = createMemoryDoc({
        id: noteId,
        title,
        summary,
        status: 'inbox',
        type: 'capture',
        description: `Saved from ${captured.finalUrl}`,
      });
      const noteBody = [
        `# ${title}`,
        '',
        `Saved from ${captured.finalUrl}.`,
        '',
        'Review this capture and either keep it as a note, promote it into a project, or ignore it.',
      ].join('\n');
      writeFileSync(created.filePath!, buildStructuredNoteMarkdown(readFileSync(created.filePath!, 'utf-8'), {
        noteId,
        title,
        summary,
        description: `Saved from ${captured.finalUrl}`,
        descriptionProvided: true,
        body: noteBody,
      }), 'utf-8');

      const noteDir = dirname(created.filePath!);
      const referencesDir = join(noteDir, 'references');
      mkdirSync(referencesDir, { recursive: true });
      writeFileSync(join(referencesDir, 'source.md'), [
        '---',
        `id: source`,
        `title: ${JSON.stringify(captured.title || title)}`,
        `summary: ${JSON.stringify(summary)}`,
        `updatedAt: ${new Date().toISOString()}`,
        'metadata:',
        `  sourceUrl: ${JSON.stringify(parsed.toString())}`,
        `  finalUrl: ${JSON.stringify(captured.finalUrl)}`,
        `  contentType: ${JSON.stringify(captured.contentType)}`,
        '---',
        '',
        `# ${captured.title || title}`,
        '',
        `Source: ${captured.finalUrl}`,
        '',
        '## Archived extract',
        '',
        captured.extractedText || '(No readable text extracted.)',
        '',
      ].join('\n'), 'utf-8');
      writeFileSync(join(referencesDir, /html|xml/i.test(captured.contentType) ? 'source.raw.html' : 'source.raw.txt'), captured.raw, 'utf-8');
      clearMemoryBrowserCaches();
      res.status(201).json(readNoteDetail(noteId, _getCurrentProfile()));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(message.startsWith('url required') || message.startsWith('Invalid URL') ? 400 : 500).json({ error: message });
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
      res.status(201).json(readNoteDetail(noteId, _getCurrentProfile()));
    } catch (err) {
      logError('request handler error', { message: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/notes/:memoryId', (req, res) => {
    try {
      res.json(readNoteDetail(req.params.memoryId, _getCurrentProfile()));
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
      res.json(readNoteDetail(memory.id, _getCurrentProfile()));
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
