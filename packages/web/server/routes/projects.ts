/**
 * Project routes
 * 
 * Handles project CRUD, documents, notes, files, milestones, and tasks.
 */

import type { Express } from 'express';
import type { ServerRouteContext } from './context.js';
import {
  addProjectMilestone,
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectMilestone,
  deleteProjectRecord,
  deleteProjectTaskRecord,
  listProjectIndex,
  moveProjectMilestone,
  moveProjectTaskRecord,
  readProjectDetailFromProject,
  readProjectSource,
  saveProjectSource,
  setProjectArchivedState,
  updateProjectMilestone,
  updateProjectRecord,
  updateProjectTaskRecord,
  type InvalidProjectRecord,
  type ProjectDetail,
} from '../projects/projects.js';
import {
  createProjectNoteRecord,
  deleteProjectFileRecord,
  deleteProjectNoteRecord,
  readProjectFileDownload,
  saveProjectDocument,
  updateProjectNoteRecord,
  uploadProjectFile,
} from '../projects/projectResources.js';
import { listConversationProjectLinks } from '@personal-agent/core';
import { listConversationSessionsSnapshot } from '../conversations/conversationService.js';
import { buildProjectSharePackageFileName, exportProjectSharePackage } from '../projects/projectPackages.js';
import { generateProjectDocument } from '../projects/projectDocuments.js';
import { buildContentDispositionHeader } from '../shared/httpHeaders.js';
import { invalidateAppTopics, logError } from '../middleware/index.js';

/**
 * Gets the current profile getter for use in route handlers.
 */
let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for project routes');
};

let listAvailableProfilesFn: () => string[] = () => {
  throw new Error('listAvailableProfiles not initialized for project routes');
};

let REPO_ROOT: string = '';
let SETTINGS_FILE: string = '';
let AUTH_FILE: string = '';

function initializeProjectRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'listAvailableProfiles' | 'getRepoRoot' | 'getSettingsFile' | 'getAuthFile'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  listAvailableProfilesFn = context.listAvailableProfiles;
  REPO_ROOT = context.getRepoRoot();
  SETTINGS_FILE = context.getSettingsFile();
  AUTH_FILE = context.getAuthFile();
}

function readProjectIndexForProfile(profile = getCurrentProfileFn()) {
  return listProjectIndex({
    repoRoot: REPO_ROOT,
    profile,
  });
}

function readProjectIndexForSelection(profile: string | 'all') {
  if (profile !== 'all') {
    const index = readProjectIndexForProfile(profile);
    return {
      profile,
      projects: index.projects.map((project) => ({ ...project, profile })),
      invalidProjects: index.invalidProjects.map((project) => ({ ...project, profile })),
    };
  }

  const projects: Array<Record<string, unknown>> = [];
  const invalidProjects: InvalidProjectRecord[] = [];

  for (const availableProfile of listAvailableProfilesFn()) {
    const index = readProjectIndexForProfile(availableProfile);
    projects.push(...index.projects.map((project) => ({ ...project, profile: availableProfile })));
    invalidProjects.push(...index.invalidProjects.map((project) => ({ ...project, profile: availableProfile })));
  }

  projects.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  return {
    profile,
    projects,
    invalidProjects,
  };
}

function listProjectsForCurrentProfile() {
  return readProjectIndexForSelection(getCurrentProfileFn()).projects;
}

function readProjectDetailForProfile(projectId: string, profile = getCurrentProfileFn()) {
  const detail = readProjectDetailFromProject({
    repoRoot: REPO_ROOT,
    profile,
    projectId,
  });

  const sessionsById = new Map(listConversationSessionsSnapshot().map((session) => [session.id, session]));
  const linkedConversations = listConversationProjectLinks({ profile })
    .filter((document: { relatedProjectIds: string[] }) => document.relatedProjectIds.includes(projectId))
    .map((document: { conversationId: string; updatedAt?: string }) => {
      const session = sessionsById.get(document.conversationId);
      return {
        conversationId: document.conversationId,
        title: session?.title ?? document.conversationId,
        file: session?.file,
        cwd: session?.cwd,
        lastActivityAt: session?.lastActivityAt ?? session?.timestamp ?? document.updatedAt,
        isRunning: Boolean(session?.isRunning),
        needsAttention: Boolean(session?.needsAttention),
      };
    });

  return {
    ...detail,
    profile,
    linkedConversations,
  } as typeof detail & { profile: string };
}

function projectErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return /not found/i.test(message) ? 404 : 400;
}

/**
 * Register project routes on the given router.
 */
export function registerProjectRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'listAvailableProfiles' | 'getRepoRoot' | 'getSettingsFile' | 'getAuthFile'>,
): void {
  initializeProjectRoutesContext(context);
  router.get('/api/projects', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const index = readProjectIndexForSelection(profile === 'all' ? 'all' : profile);
      res.set('X-Personal-Agent-Project-Warning-Count', String(index.invalidProjects.length));
      res.json(index.projects);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
    }
  });

  router.get('/api/projects/diagnostics', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const index = readProjectIndexForSelection(profile === 'all' ? 'all' : profile);
      res.json({ profile, invalidProjects: index.invalidProjects });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', { message, stack: err instanceof Error ? err.stack : undefined });
      res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
    }
  });

  router.get('/api/projects/:id', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/api/projects/:id/package', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const projectPackage = exportProjectSharePackage({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
      });
      const fileName = buildProjectSharePackageFileName({
        projectId: projectPackage.source.projectId,
        exportedAt: projectPackage.exportedAt,
      });

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', buildContentDispositionHeader('attachment', fileName));
      res.send(`${JSON.stringify(projectPackage, null, 2)}\n`);
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        title?: string;
        description?: string;
        documentContent?: string;
        repoRoot?: string | null;
        summary?: string;
        status?: string;
      };

      const detail = createProjectRecord({
        repoRoot: REPO_ROOT,
        profile,
        title: body.title ?? '',
        description: body.description,
        documentContent: body.documentContent,
        projectRepoRoot: body.repoRoot,
        summary: body.summary,
        status: body.status,
      });
      invalidateAppTopics('projects');
      res.status(201).json(readProjectDetailForProfile(detail.project.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/api/projects/:id', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        title?: string;
        description?: string;
        repoRoot?: string | null;
        summary?: string;
        status?: string;
        currentMilestoneId?: string | null;
      };

      updateProjectRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        title: body.title,
        description: body.description,
        projectRepoRoot: body.repoRoot,
        summary: body.summary,
        status: body.status,
        currentMilestoneId: body.currentMilestoneId,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/api/projects/:id', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const result = deleteProjectRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
      });
      invalidateAppTopics('projects');
      res.json(result);
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/archive', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      setProjectArchivedState({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        archived: true,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/unarchive', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      setProjectArchivedState({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        archived: false,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/document', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as { content?: string };
      saveProjectDocument({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        content: body.content ?? '',
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/document/regenerate', async (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const detail = readProjectDetailForProfile(req.params.id, profile);
      // Activity entries would need to be fetched from the main server context
      // For now, generate without activity entries - they can be added later
      const generatedDocument = await generateProjectDocument({
        detail,
        linkedConversations: detail.linkedConversations,
        activityEntries: [],
        settingsFile: SETTINGS_FILE,
        authFile: AUTH_FILE,
      });
      saveProjectDocument({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        content: generatedDocument,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/notes', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as { title?: string; kind?: string; body?: string };
      createProjectNoteRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        title: body.title ?? '',
        kind: body.kind ?? 'note',
        body: body.body,
      });
      invalidateAppTopics('projects');
      res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/api/projects/:id/notes/:noteId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as { title?: string; kind?: string; body?: string };
      updateProjectNoteRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        noteId: req.params.noteId,
        title: body.title,
        kind: body.kind,
        body: body.body,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/api/projects/:id/notes/:noteId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      deleteProjectNoteRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        noteId: req.params.noteId,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/files', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        name?: string;
        mimeType?: string;
        title?: string;
        description?: string;
        data?: string;
      };
      uploadProjectFile({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        name: body.name ?? '',
        mimeType: body.mimeType,
        title: body.title,
        description: body.description,
        data: body.data ?? '',
      });
      invalidateAppTopics('projects');
      res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/api/projects/:id/files/:fileId/download', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const download = readProjectFileDownload({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        fileId: req.params.fileId,
      });
      if (download.file.mimeType) {
        res.type(download.file.mimeType);
      }
      res.setHeader('Content-Disposition', buildContentDispositionHeader('attachment', download.file.originalName));
      res.sendFile(download.filePath);
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/api/projects/:id/files/:fileId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      deleteProjectFileRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        fileId: req.params.fileId,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/milestones', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        title?: string;
        status?: string;
        summary?: string;
        makeCurrent?: boolean;
      };

      addProjectMilestone({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        title: body.title ?? '',
        status: body.status ?? '',
        summary: body.summary,
        makeCurrent: body.makeCurrent,
      });
      invalidateAppTopics('projects');
      res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/api/projects/:id/milestones/:milestoneId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        title?: string;
        status?: string;
        summary?: string | null;
        makeCurrent?: boolean;
      };

      updateProjectMilestone({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        milestoneId: req.params.milestoneId,
        title: body.title,
        status: body.status,
        summary: body.summary,
        makeCurrent: body.makeCurrent,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/api/projects/:id/milestones/:milestoneId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      deleteProjectMilestone({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        milestoneId: req.params.milestoneId,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/milestones/:milestoneId/move', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as { direction?: 'up' | 'down' };

      moveProjectMilestone({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        milestoneId: req.params.milestoneId,
        direction: body.direction ?? 'up',
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/tasks', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        title?: string;
        status?: string;
        milestoneId?: string | null;
      };

      createProjectTaskRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        title: body.title ?? '',
        status: body.status ?? '',
        milestoneId: body.milestoneId,
      });
      invalidateAppTopics('projects');
      res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.patch('/api/projects/:id/tasks/:taskId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as {
        title?: string;
        status?: string;
        milestoneId?: string | null;
      };

      updateProjectTaskRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        taskId: req.params.taskId,
        title: body.title,
        status: body.status,
        milestoneId: body.milestoneId,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.delete('/api/projects/:id/tasks/:taskId', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      deleteProjectTaskRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        taskId: req.params.taskId,
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/tasks/:taskId/move', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as { direction?: 'up' | 'down' };

      moveProjectTaskRecord({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        taskId: req.params.taskId,
        direction: body.direction ?? 'up',
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/api/projects/:id/source', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      res.json(readProjectSource({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
      }));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/projects/:id/source', (req, res) => {
    try {
      const profile = (req.query.viewProfile as string) || getCurrentProfileFn();
      const body = req.body as { content?: string };
      saveProjectSource({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        content: body.content ?? '',
      });
      invalidateAppTopics('projects');
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

export function registerCompanionProjectRoutes(
  router: Pick<Express, 'get'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'listAvailableProfiles' | 'getRepoRoot' | 'getSettingsFile' | 'getAuthFile'>,
): void {
  initializeProjectRoutesContext(context);
  router.get('/api/projects', (_req, res) => {
    try {
      res.json(listProjectsForCurrentProfile());
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/projects/:id', (req, res) => {
    try {
      const profile = getCurrentProfileFn();
      res.json(readProjectDetailForProfile(req.params.id, profile));
    } catch (error) {
      res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
