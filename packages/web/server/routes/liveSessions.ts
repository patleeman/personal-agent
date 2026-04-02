import { relative } from 'node:path';
import type { Express, Request, Response } from 'express';
import type { ServerRouteContext } from './context.js';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import {
  createSession as createLocalSession,
  destroySession,
  exportSessionHtml,
  forkSession,
  getLiveSessions as getLocalLiveSessions,
  getLiveSessionForkEntries,
  getSessionContextUsage,
  getSessionStats,
  isLive as isLocalLive,
  LiveSessionControlError,
  compactSession,
  reloadSessionResources,
  submitPromptSession as submitLocalPromptSession,
  queuePromptContext,
  renameSession,
  restoreQueuedMessage,
  resumeSession as resumeLocalSession,
  branchSession,
  ensureSessionSurfaceCanControl,
  abortSession as abortLocalSession,
  registry as liveRegistry,
  subscribe as subscribeLocal,
  takeOverSessionControl,
} from '../conversations/liveSessions.js';
import {
  createLocalMirrorSession,
  createRemoteLiveSession,
  getRemoteLiveSessionMeta,
  isRemoteLiveSession,
  listRemoteLiveSessions,
  resumeRemoteLiveSession,
  stopRemoteLiveSession,
  subscribeRemoteLiveSession,
  submitRemoteLiveSessionPrompt,
} from '../conversations/remoteLiveSessions.js';
import { readCompanionSession } from '../ui/companionAuth.js';
import {
  getConversationExecutionTarget,
  getConversationProjectLink,
  getExecutionTarget,
  listAllProjectIds,
  resolveConversationAttachmentPromptFiles,
  setConversationExecutionTarget,
  setConversationProjectLinks,
} from '@personal-agent/core';
import {
  logError,
  logSlowConversationPerf,
  setServerTimingHeaders,
  invalidateAppTopics,
  logWarn,
} from '../middleware/index.js';
import { parseTailBlocksQuery, publishConversationSessionMetaChanged } from '../conversations/conversationService.js';
import { readProjectDetailFromProject, readProjectOwnerProfile, resolveProjectNodePaths } from '../projects/projects.js';
import { readSessionMeta } from '../conversations/sessions.js';
import { resolveConversationCwd } from '../conversations/conversationCwd.js';
import { resolveRemoteExecutionCwd } from '../workspace/remoteExecution.js';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedProfilesContext,
  buildReferencedSkillsContext,
  buildReferencedTasksContext,
  expandPromptReferencesWithNodeGraph,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
} from '../knowledge/promptReferences.js';
import { syncWebLiveConversationRun } from '../conversations/conversationRuns.js';
import { readGitStatusSummaryWithTelemetry, type GitStatusReadTelemetry } from '../workspace/gitStatus.js';
import {
  listPendingBackgroundRunResults,
  markBackgroundRunResultsDelivered,
  loadDaemonConfig,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
} from '@personal-agent/daemon';

let getCurrentProfileFn: () => string = () => {
  throw new Error('live session routes not initialized');
};

let getRepoRootFn: () => string = () => {
  throw new Error('live session routes not initialized');
};

let getDefaultWebCwdFn: () => string = () => {
  throw new Error('live session routes not initialized');
};

let buildLiveSessionResourceOptionsFn: (profile?: string) => Record<string, unknown> = () => ({
  additionalExtensionPaths: [],
  additionalSkillPaths: [],
  additionalPromptTemplatePaths: [],
  additionalThemePaths: [],
});

let buildLiveSessionExtensionFactoriesFn: () => unknown[] = () => [];

let flushLiveDeferredResumesFn: () => Promise<void> = async () => {};

let listTasksForCurrentProfileFn: () => {
  id: string;
  filePath: string;
  prompt: string;
  enabled: boolean;
  running: boolean;
  cron?: string;
  model?: string;
  lastStatus?: string;
}[] = () => [];

let listMemoryDocsFn: () => {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  path: string;
  updated?: string;
}[] = () => [];

let listSkillsForCurrentProfileFn: () => {
  name: string;
  source: string;
  description: string;
  path: string;
}[] = () => [];

let listProfileAgentItemsFn: () => { source: string; path: string }[] = () => [];

const COMPANION_SESSION_COOKIE = 'pa_companion';

function readCookieValue(req: Request, cookieName: string): string {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    return '';
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...valueParts] = pair.split('=');
    if (rawName?.trim() !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join('=').trim());
  }

  return '';
}

function isValidCompanionSession(req: Request): boolean {
  const sessionToken = readCookieValue(req, COMPANION_SESSION_COOKIE);
  return Boolean(readCompanionSession(sessionToken, { touch: false, surface: 'companion' }));
}

function writeSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function initializeLiveSessionRoutesContext(
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes' | 'listTasksForCurrentProfile' | 'listMemoryDocs' | 'listSkillsForCurrentProfile' | 'listProfileAgentItems'>,
): void {
  getCurrentProfileFn = context.getCurrentProfile;
  getRepoRootFn = context.getRepoRoot;
  getDefaultWebCwdFn = context.getDefaultWebCwd;
  buildLiveSessionResourceOptionsFn = context.buildLiveSessionResourceOptions;
  buildLiveSessionExtensionFactoriesFn = context.buildLiveSessionExtensionFactories;
  flushLiveDeferredResumesFn = context.flushLiveDeferredResumes;
  listTasksForCurrentProfileFn = context.listTasksForCurrentProfile;
  listMemoryDocsFn = context.listMemoryDocs;
  listSkillsForCurrentProfileFn = context.listSkillsForCurrentProfile;
  listProfileAgentItemsFn = context.listProfileAgentItems;
}

function listReferenceableProjectIds(): string[] {
  return listAllProjectIds({ repoRoot: getRepoRootFn() });
}

function buildLiveSessionResourceOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...buildLiveSessionResourceOptionsFn(getCurrentProfileFn()),
    extensionFactories: buildLiveSessionExtensionFactoriesFn(),
    ...overrides,
  };
}

function buildBackgroundRunHiddenContext(entries: Array<{ prompt: string }>): string {
  if (entries.length === 0) {
    return '';
  }

  const lines = [
    'Background run completions became available since the previous explicit user turn.',
    'Use this as hidden context only. Do not treat it as a standalone follow-up instruction.',
    'If the only sensible next step is to wait and inspect again later, schedule deferred_resume yourself instead of asking the user to remind you.',
  ];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    lines.push(
      '',
      entries.length === 1 ? 'Completion:' : `Completion ${index + 1}:`,
      entry.prompt,
    );
  }

  return lines.join('\n');
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function readProjectProfileById(projectId: string): string | null {
  try {
    return readProjectOwnerProfile({ repoRoot: getRepoRootFn(), projectId });
  } catch {
    return null;
  }
}

function syncConversationProjectReferences(conversationId: string, mentionedProjectIds: string[]): string[] {
  const profile = getCurrentProfileFn();
  const availableProjectIds = listReferenceableProjectIds();
  const availableProjectIdSet = new Set(availableProjectIds);
  const existingProjectIds = (getConversationProjectLink({
    profile,
    conversationId,
  })?.relatedProjectIds ?? []).filter((projectId) => availableProjectIdSet.has(projectId));
  const relatedProjectIds = [...new Set([...existingProjectIds, ...mentionedProjectIds])];

  const existingMatches = existingProjectIds.length === relatedProjectIds.length
    && existingProjectIds.every((projectId, index) => projectId === relatedProjectIds[index]);

  if (!existingMatches) {
    setConversationProjectLinks({
      profile,
      conversationId,
      relatedProjectIds,
    });
    invalidateAppTopics('projects');
  }

  return relatedProjectIds;
}

function buildReferencedProjectsContext(projectIds: string[]): string {
  const currentProfile = getCurrentProfileFn();
  const lines = projectIds.map((projectId) => {
    const projectProfile = readProjectProfileById(projectId) ?? currentProfile;
    const paths = {
      projectFile: resolveProjectNodePaths({
        repoRoot: getRepoRootFn(),
        profile: projectProfile,
        projectId,
      }).projectFile,
      filesDir: resolveProjectNodePaths({
        repoRoot: getRepoRootFn(),
        profile: projectProfile,
        projectId,
      }).filesDir,
    };
    const lineParts = [`- @${projectId}: ${relative(getRepoRootFn(), paths.projectFile)}`];

    try {
      const detail = readProjectDetailFromProject({
        repoRoot: getRepoRootFn(),
        profile: projectProfile,
        projectId,
      });
      if (projectProfile !== currentProfile) {
        lineParts.push(`  profile: ${projectProfile}`);
      }
      lineParts.push(`  title: ${detail.project.title}`);
      lineParts.push(`  summary: ${detail.project.summary}`);
      if (detail.project.repoRoot) {
        lineParts.push(`  repoRoot: ${detail.project.repoRoot}`);
      }
      if (detail.document) {
        lineParts.push(`  document: ${relative(getRepoRootFn(), detail.document.path)}`);
      }
      if (detail.childPageCount > 0) {
        lineParts.push(`  childPages: ${detail.childPageCount}`);
      }
      if (detail.fileCount > 0) {
        lineParts.push(`  filesDir: ${relative(getRepoRootFn(), paths.filesDir)} (${detail.fileCount} files)`);
      }
    } catch {
      // Ignore malformed project metadata in the lightweight reference summary.
    }

    return lineParts.join('\n');
  });

  return [
    'Referenced pages for this conversation:',
    ...lines,
    'Pages are durable cross-conversation hubs. Read the structured fields, handoff doc, and child pages when you need continuity, and use the project tool for tracked-page CRUD plus conversation reference changes.',
  ].join('\n');
}

interface PromptAttachmentRefInput {
  attachmentId: string;
  revision?: number;
}

function normalizePromptAttachmentRefs(value: unknown): PromptAttachmentRefInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: PromptAttachmentRefInput[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const attachmentId = typeof (candidate as { attachmentId?: unknown }).attachmentId === 'string'
      ? (candidate as { attachmentId: string }).attachmentId.trim()
      : '';
    if (!attachmentId) {
      continue;
    }

    const revisionCandidate = (candidate as { revision?: unknown }).revision;
    const revision = Number.isInteger(revisionCandidate) && (revisionCandidate as number) > 0
      ? revisionCandidate as number
      : undefined;

    const dedupeKey = `${attachmentId}:${String(revision ?? 'latest')}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    refs.push({
      attachmentId,
      ...(revision ? { revision } : {}),
    });
  }

  return refs;
}

function buildConversationAttachmentsContext(
  attachments: ReturnType<typeof resolveConversationAttachmentPromptFiles>,
): string {
  if (attachments.length === 0) {
    return '';
  }

  const lines = attachments.map((attachment) => {
    const lineParts = [
      `- ${attachment.attachmentId} [${attachment.kind}] ${attachment.title} (rev ${attachment.revision})`,
      `  sourcePath: ${attachment.sourcePath}`,
      `  previewPath: ${attachment.previewPath}`,
      `  sourceMimeType: ${attachment.sourceMimeType}`,
      `  previewMimeType: ${attachment.previewMimeType}`,
    ];

    return lineParts.join('\n');
  });

  return [
    'Referenced conversation attachments:',
    ...lines,
    'Use these local files with tools when needed. The sourcePath points at editable .excalidraw data, and previewPath points at the rendered PNG preview.',
  ].join('\n');
}

export async function handleLiveSessionPrompt(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { text = '', behavior, images, attachmentRefs } = req.body as {
      text?: string;
      behavior?: 'steer' | 'followUp';
      images?: Array<{ type?: 'image'; data: string; mimeType: string; name?: string }>;
      attachmentRefs?: unknown;
      surfaceId?: string;
    };
    const normalizedAttachmentRefs = normalizePromptAttachmentRefs(attachmentRefs);
    if (!text && (!images || images.length === 0) && normalizedAttachmentRefs.length === 0) {
      res.status(400).json({ error: 'text, images, or attachmentRefs required' });
      return;
    }

    const surfaceId = readRequestSurfaceId(req.body);
    const isRemoteLive = isRemoteLiveSession(id);

    const currentProfile = getCurrentProfileFn();
    const tasks = listTasksForCurrentProfileFn();
    const memoryDocs = listMemoryDocsFn().map((doc) => ({
      ...doc,
      summary: doc.summary ?? '',
      description: doc.description ?? '',
    }));
    const skills = listSkillsForCurrentProfileFn().map((skill) => ({
      name: skill.name,
      source: skill.source,
      description: skill.description,
      path: skill.path,
    }));
    const profileAgents = listProfileAgentItemsFn().map((item) => ({
      id: item.source,
      source: item.source,
      path: item.path,
    }));
    const promptReferences = resolvePromptReferences({
      text,
      availableProjectIds: listReferenceableProjectIds(),
      tasks,
      memoryDocs,
      skills,
      profiles: profileAgents,
    });
    const expandedNodeReferences = expandPromptReferencesWithNodeGraph({
      projectIds: promptReferences.projectIds,
      memoryDocIds: promptReferences.memoryDocIds,
      skillNames: promptReferences.skillNames,
    });

    const relatedProjectIds = syncConversationProjectReferences(id, expandedNodeReferences.projectIds);
    const referencedTasks = pickPromptReferencesInOrder(promptReferences.taskIds, tasks);
    const referencedMemoryDocs = pickPromptReferencesInOrder(expandedNodeReferences.memoryDocIds, memoryDocs);
    const referencedSkills = pickPromptReferencesInOrder(expandedNodeReferences.skillNames, skills);
    const referencedProfiles = pickPromptReferencesInOrder(promptReferences.profileIds, profileAgents);
    let referencedAttachments: ReturnType<typeof resolveConversationAttachmentPromptFiles> = [];
    if (normalizedAttachmentRefs.length > 0) {
      try {
        referencedAttachments = resolveConversationAttachmentPromptFiles({
          profile: currentProfile,
          conversationId: id,
          refs: normalizedAttachmentRefs,
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const liveEntry = !isRemoteLive ? liveRegistry.get(id) : undefined;
    const remoteLive = isRemoteLive ? getRemoteLiveSessionMeta(id) : null;
    const sessionFile = liveEntry?.session.sessionFile ?? remoteLive?.sessionFile;
    const daemonRunsRoot = resolveDurableRunsRoot(resolveDaemonRoot());
    const backgroundRunContextEntries = sessionFile
      ? listPendingBackgroundRunResults({
          runsRoot: daemonRunsRoot,
          sessionFile,
        })
      : [];
    const backgroundRunHiddenContext = buildBackgroundRunHiddenContext(backgroundRunContextEntries);

    const queuedContextBlocks = [
      relatedProjectIds.length > 0 ? buildReferencedProjectsContext(relatedProjectIds) : '',
      referencedAttachments.length > 0 ? buildConversationAttachmentsContext(referencedAttachments) : '',
      referencedTasks.length > 0 ? buildReferencedTasksContext(referencedTasks, getRepoRootFn()) : '',
      referencedMemoryDocs.length > 0 ? buildReferencedMemoryDocsContext(referencedMemoryDocs, getRepoRootFn()) : '',
      referencedSkills.length > 0 ? buildReferencedSkillsContext(referencedSkills, getRepoRootFn()) : '',
      referencedProfiles.length > 0 ? buildReferencedProfilesContext(referencedProfiles, getRepoRootFn()) : '',
      backgroundRunHiddenContext,
    ].filter(Boolean);

    const hiddenContext = queuedContextBlocks.join('\n\n');

    if (!isRemoteLive && queuedContextBlocks.length > 0) {
      await queuePromptContext(id, 'referenced_context', hiddenContext);
    }

    if (!isRemoteLive && liveEntry?.session.sessionFile) {
      await syncWebLiveConversationRun({
        conversationId: id,
        sessionFile: liveEntry.session.sessionFile,
        cwd: liveEntry.cwd,
        title: liveEntry.title,
        profile: currentProfile,
        state: 'running',
        pendingOperation: {
          type: 'prompt',
          text,
          ...(behavior ? { behavior } : {}),
          ...(images && images.length > 0
            ? {
              images: images.map((image) => ({
                type: 'image' as const,
                data: image.data,
                mimeType: image.mimeType,
                ...(image.name ? { name: image.name } : {}),
              })),
            }
            : {}),
          ...(queuedContextBlocks.length > 0
            ? {
              contextMessages: [{
                customType: 'referenced_context',
                content: hiddenContext,
              }],
            }
            : {}),
          enqueuedAt: new Date().toISOString(),
        },
      });
    }

    if (isRemoteLive && referencedAttachments.length > 0) {
      res.status(400).json({ error: 'Remote conversations do not support local attachment references yet.' });
      return;
    }

    const promptImages = images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
      ...(image.name ? { name: image.name } : {}),
    }));
    const submittedPrompt = (isRemoteLive
      ? await submitRemoteLiveSessionPrompt({
        conversationId: id,
        text,
        behavior,
        images: promptImages,
        ...(hiddenContext ? { hiddenContext } : {}),
      })
      : await submitLocalPromptSession(id, text, behavior, promptImages, surfaceId)) as {
      acceptedAs: 'queued' | 'started';
      completion: Promise<void>;
    };
    const promptPromise = submittedPrompt.completion;

    void promptPromise.then(async () => {
      if (!sessionFile || backgroundRunContextEntries.length === 0) {
        return;
      }

      try {
        const deliveredIds = markBackgroundRunResultsDelivered({
          runsRoot: daemonRunsRoot,
          sessionFile,
          resultIds: backgroundRunContextEntries.map((entry) => entry.id),
        });
        if (deliveredIds.length > 0) {
          invalidateAppTopics('runs');
        }
      } catch (error) {
        logWarn('background run context completion error', {
          sessionId: id,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }).catch(async (err: unknown) => {
      if (!isRemoteLive && liveEntry?.session.sessionFile) {
        await syncWebLiveConversationRun({
          conversationId: id,
          sessionFile: liveEntry.session.sessionFile,
          cwd: liveEntry.cwd,
          title: liveEntry.title,
          profile: currentProfile,
          state: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        });
      }

      logError('live prompt error', {
        sessionId: id,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
    res.json({
      ok: true,
      accepted: true,
      delivery: submittedPrompt.acceptedAs,
      relatedProjectIds,
      referencedTaskIds: promptReferences.taskIds,
      referencedMemoryDocIds: promptReferences.memoryDocIds,
      referencedSkillNames: promptReferences.skillNames,
      referencedProfileIds: promptReferences.profileIds,
      referencedAttachmentIds: referencedAttachments.map((attachment) => attachment.attachmentId),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
}

function isLiveSession(sessionId: string): boolean {
  return isLocalLive(sessionId) || isRemoteLiveSession(sessionId);
}

function listAllLiveSessions() {
  const local = getLocalLiveSessions();
  const localIds = new Set(local.map((session: { id: string }) => session.id));
  const remote = listRemoteLiveSessions().filter((session) => !localIds.has(session.id));
  return [...local, ...remote];
}

function subscribeLiveSession(
  sessionId: string,
  listener: (event: unknown) => void,
  options?: {
    tailBlocks?: number;
    surface?: {
      surfaceId: string;
      surfaceType: 'desktop_web' | 'mobile_web';
    };
  },
): (() => void) | null {
  return subscribeLocal(sessionId, listener, options)
    ?? subscribeRemoteLiveSession(sessionId, listener, options ? { tailBlocks: options.tailBlocks } : undefined);
}

function readRequestSurfaceId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as { surfaceId?: unknown }).surfaceId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function ensureRequestControlsLocalLiveConversation(conversationId: string, body: unknown): string | undefined {
  const surfaceId = readRequestSurfaceId(body);
  if (!isLocalLive(conversationId)) {
    return surfaceId;
  }

  if (!surfaceId) {
    throw new Error('surfaceId is required for local live conversation control.');
  }

  ensureSessionSurfaceCanControl(conversationId, surfaceId);
  return surfaceId;
}

export function writeLiveConversationControlError(res: Response, error: unknown): boolean {
  if (error instanceof LiveSessionControlError) {
    res.status(409).json({ error: error.message });
    return true;
  }

  if (error instanceof Error && error.message === 'surfaceId is required for local live conversation control.') {
    res.status(400).json({ error: error.message });
    return true;
  }

  return false;
}

async function abortLiveSession(sessionId: string): Promise<void> {
  if (isRemoteLiveSession(sessionId)) {
    await stopRemoteLiveSession(sessionId);
    return;
  }

  await abortLocalSession(sessionId);
}

export function registerLiveSessionRoutes(
  router: Pick<Express, 'get' | 'post' | 'patch' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes' | 'listTasksForCurrentProfile' | 'listMemoryDocs' | 'listSkillsForCurrentProfile' | 'listProfileAgentItems'>,
): void {
  initializeLiveSessionRoutesContext(context);
  router.get('/api/live-sessions', (_req, res) => {
    res.json(listAllLiveSessions());
  });

  router.get('/api/live-sessions/:id', (req, res) => {
    try {
      const live = isLiveSession(req.params.id);
      if (!live) { res.status(404).json({ live: false }); return; }
      const entry = listAllLiveSessions().find((session) => session.id === req.params.id);
      res.json({ live: true, ...entry });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  /** Create a new live session */
  router.post('/api/live-sessions', async (req, res) => {
    try {
      const body = req.body as {
        cwd?: string;
        referencedProjectIds?: string[];
        text?: string;
        targetId?: string | null;
        model?: string | null;
        thinkingLevel?: string | null;
      };
      const profile = getCurrentProfileFn();
      const availableProjectIds = listReferenceableProjectIds();
      const inferredReferencedProjectIds = body.text
        ? resolvePromptReferences({
          text: body.text,
          availableProjectIds,
          tasks: [],
          memoryDocs: [],
          skills: [],
          profiles: [],
        }).projectIds
        : [];
      const referencedProjectIds = body.referencedProjectIds && body.referencedProjectIds.length > 0
        ? body.referencedProjectIds.filter((projectId) => availableProjectIds.includes(projectId))
        : inferredReferencedProjectIds;
      const cwd = resolveConversationCwd({
        repoRoot: getRepoRootFn(),
        profile,
        explicitCwd: body.cwd,
        defaultCwd: getDefaultWebCwdFn(),
        referencedProjectIds,
      });
      const targetId = typeof body.targetId === 'string' ? body.targetId.trim() || null : null;

      if (targetId) {
        const target = getExecutionTarget({ targetId });
        if (!target) {
          res.status(400).json({ error: `Execution target ${targetId} not found.` });
          return;
        }

        const remoteCwd = resolveRemoteExecutionCwd(target, cwd);
        const result = await createLocalMirrorSession({
          remoteCwd,
          ...(body.model !== undefined ? { initialModel: body.model } : {}),
          ...(body.thinkingLevel !== undefined ? { initialThinkingLevel: body.thinkingLevel } : {}),
        });
        setConversationExecutionTarget({
          profile,
          conversationId: result.id,
          targetId,
        });
        await createRemoteLiveSession({
          profile,
          targetId,
          remoteCwd,
          localSessionFile: result.sessionFile,
          conversationId: result.id,
        });

        if (referencedProjectIds.length > 0) {
          setConversationProjectLinks({
            profile,
            conversationId: result.id,
            relatedProjectIds: referencedProjectIds,
          });
          invalidateAppTopics('projects');
        }

        publishConversationSessionMetaChanged(result.id);
        res.json(result);
        return;
      }

      const result = await createLocalSession(cwd, buildLiveSessionResourceOptions({
        ...(body.model !== undefined ? { initialModel: body.model } : {}),
        ...(body.thinkingLevel !== undefined ? { initialThinkingLevel: body.thinkingLevel } : {}),
      }));
      if (referencedProjectIds.length > 0) {
        setConversationProjectLinks({
          profile,
          conversationId: result.id,
          relatedProjectIds: referencedProjectIds,
        });
        invalidateAppTopics('projects');
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  /** Resume an existing session file into a live session */
  router.post('/api/live-sessions/resume', async (req, res) => {
    try {
      const { sessionFile } = req.body as { sessionFile: string };
      if (!sessionFile) { res.status(400).json({ error: 'sessionFile required' }); return; }

      const conversationId = SessionManager.open(sessionFile).getSessionId();
      const targetBinding = getConversationExecutionTarget({
        profile: getCurrentProfileFn(),
        conversationId,
      });

      if (targetBinding) {
        const result = await resumeRemoteLiveSession({
          profile: getCurrentProfileFn(),
          conversationId,
          localSessionFile: sessionFile,
          targetId: targetBinding.targetId,
        });
        res.json(result);
        return;
      }

      const result = await resumeLocalSession(sessionFile, buildLiveSessionResourceOptions());
      await flushLiveDeferredResumesFn();
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/live-sessions/:id/events', (req, res) => {
    const { id } = req.params;
    if (!isLiveSession(id)) { res.status(404).json({ error: 'Not a live session' }); return; }

    const tailBlocks = parseTailBlocksQuery(req.query.tailBlocks);
    const rawSurfaceId = Array.isArray(req.query.surfaceId) ? req.query.surfaceId[0] : req.query.surfaceId;
    const surfaceId = typeof rawSurfaceId === 'string' ? rawSurfaceId.trim() : '';
    const rawSurfaceType = Array.isArray(req.query.surfaceType) ? req.query.surfaceType[0] : req.query.surfaceType;
    const surfaceType = rawSurfaceType === 'mobile_web' ? 'mobile_web' : 'desktop_web';

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const unsubscribe = subscribeLiveSession(id, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, {
      ...(tailBlocks ? { tailBlocks } : {}),
      ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  });

  router.get('/api/live-sessions/:id/fork-entries', (req, res) => {
    try {
      const forkEntries = getLiveSessionForkEntries(req.params.id);
      if (!forkEntries) {
        res.status(404).json({ error: 'Session not live' });
        return;
      }
      res.json(forkEntries);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/takeover', (req, res) => {
    try {
      const { id } = req.params;
      const surfaceId = typeof req.body?.surfaceId === 'string' ? req.body.surfaceId.trim() : '';
      if (!surfaceId) {
        res.status(400).json({ error: 'surfaceId is required' });
        return;
      }
      if (!isLocalLive(id)) {
        res.status(400).json({ error: 'Takeover is only available for local live conversations right now.' });
        return;
      }

      res.json(takeOverSessionControl(id, surfaceId));
    } catch (error) {
      if (error instanceof LiveSessionControlError) {
        res.status(409).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/live-sessions/:id/prompt', handleLiveSessionPrompt);

  router.post('/api/live-sessions/:id/dequeue', (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

      const { behavior, index } = req.body as {
        behavior?: 'steer' | 'followUp';
        index?: number;
        surfaceId?: string;
      };

      if (behavior !== 'steer' && behavior !== 'followUp') {
        res.status(400).json({ error: 'behavior must be "steer" or "followUp"' });
        return;
      }

      if (!Number.isInteger(index) || (index as number) < 0) {
        res.status(400).json({ error: 'index must be a non-negative integer' });
        return;
      }

      const restored = restoreQueuedMessage(req.params.id, behavior, index as number);
      res.json({ ok: true, ...restored });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logError('request handler error', {
        message,
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      const status = message.includes('Queued prompt changed before it could be restored')
        || message.includes('Queued prompt restore is unavailable')
        ? 409
        : 500;
      res.status(status).json({ error: message });
    }
  });

  router.post('/api/live-sessions/:id/compact', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { customInstructions } = req.body as { customInstructions?: string; surfaceId?: string };
      const result = await compactSession(req.params.id, customInstructions?.trim() || undefined);
      res.json({ ok: true, result });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/reload', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      await reloadSessionResources(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/export', async (req, res) => {
    try {
      const { outputPath } = req.body as { outputPath?: string };
      const path = await exportSessionHtml(req.params.id, outputPath?.trim() || undefined);
      res.json({ ok: true, path });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.patch('/api/live-sessions/:id/name', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { name } = req.body as { name?: string; surfaceId?: string };
      const nextName = name?.trim();
      if (!nextName) {
        res.status(400).json({ error: 'name required' });
        return;
      }

      renameSession(req.params.id, nextName);
      res.json({ ok: true, name: nextName });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  /** Abort a running agent */
  router.post('/api/live-sessions/:id/abort', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      await abortLiveSession(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  /** Get workspace context for a conversation */
  router.get('/api/live-sessions/:id/context', (req, res) => {
    const startedAt = process.hrtime.bigint();

    try {
      const { id } = req.params;
      const liveEntry = liveRegistry.get(id);
      const remoteLive = getRemoteLiveSessionMeta(id);
      const storedSession = !liveEntry && !remoteLive ? readSessionMeta(id) : null;
      const cwd = liveEntry?.cwd ?? remoteLive?.cwd ?? storedSession?.cwd;
      if (!cwd) { res.status(404).json({ error: 'Session not found' }); return; }

      const gitSummaryRead = remoteLive
        ? { summary: null, telemetry: { cache: 'hit' as const, durationMs: 0, hasRepo: false } satisfies GitStatusReadTelemetry }
        : readGitStatusSummaryWithTelemetry(cwd);
      const gitSummary = gitSummaryRead.summary;

      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      setServerTimingHeaders(res, [
        { name: 'git', durationMs: gitSummaryRead.telemetry.durationMs, description: remoteLive ? 'remote-skip' : gitSummaryRead.telemetry.cache },
        { name: 'total', durationMs },
      ], {
        route: 'live-session-context',
        conversationId: id,
        git: gitSummaryRead.telemetry,
        durationMs,
      });
      logSlowConversationPerf('live session context request', {
        conversationId: id,
        durationMs,
        gitCache: gitSummaryRead.telemetry.cache,
      });

      res.json({
        cwd,
        branch: gitSummary?.branch ?? null,
        git: gitSummary
          ? {
            changeCount: gitSummary.changeCount,
            linesAdded: gitSummary.linesAdded,
            linesDeleted: gitSummary.linesDeleted,
            changes: gitSummary.changes.map((change) => ({
              relativePath: change.relativePath,
              change: change.change,
            })),
          }
          : null,
      });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/branch', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { entryId } = req.body as { entryId: string; surfaceId?: string };
      if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
      res.json(await branchSession(req.params.id, entryId, buildLiveSessionResourceOptions()));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/:id/fork', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      const { entryId, preserveSource } = req.body as { entryId: string; preserveSource?: boolean; surfaceId?: string };
      if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
      res.json(await forkSession(req.params.id, entryId, {
        preserveSource,
        ...buildLiveSessionResourceOptions(),
      }));
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });

  /** Destroy / close a live session */
  router.delete('/api/live-sessions/:id', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

      if (isRemoteLiveSession(req.params.id)) {
        await stopRemoteLiveSession(req.params.id);
        res.json({ ok: true });
        return;
      }

      destroySession(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      if (writeLiveConversationControlError(res, err)) {
        return;
      }

      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });
}

export function registerCompanionLiveSessionRoutes(
  router: Pick<Express, 'get' | 'post' | 'delete'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes' | 'listTasksForCurrentProfile' | 'listMemoryDocs' | 'listSkillsForCurrentProfile' | 'listProfileAgentItems'>,
): void {
  initializeLiveSessionRoutesContext(context);
  router.get('/api/live-sessions', (_req, res) => {
    res.json(listAllLiveSessions());
  });

  router.post('/api/live-sessions', async (req, res) => {
    try {
      const body = req.body as { referencedProjectIds?: string[]; text?: string };
      const profile = getCurrentProfileFn();
      const availableProjectIds = listReferenceableProjectIds();
      const inferredReferencedProjectIds = body.text
        ? resolvePromptReferences({
          text: body.text,
          availableProjectIds,
          tasks: [],
          memoryDocs: [],
          skills: [],
          profiles: [],
        }).projectIds
        : [];
      const referencedProjectIds = body.referencedProjectIds && body.referencedProjectIds.length > 0
        ? body.referencedProjectIds.filter((projectId) => availableProjectIds.includes(projectId))
        : inferredReferencedProjectIds;
      const cwd = resolveConversationCwd({
        repoRoot: getRepoRootFn(),
        profile,
        explicitCwd: undefined,
        defaultCwd: getDefaultWebCwdFn(),
        referencedProjectIds,
      });

      const result = await createLocalSession(cwd, buildLiveSessionResourceOptions());
      if (referencedProjectIds.length > 0) {
        setConversationProjectLinks({
          profile,
          conversationId: result.id,
          relatedProjectIds: referencedProjectIds,
        });
        invalidateAppTopics('projects');
      }
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.post('/api/live-sessions/resume', async (req, res) => {
    try {
      const { sessionFile } = req.body as { sessionFile: string };
      if (!sessionFile) {
        res.status(400).json({ error: 'sessionFile required' });
        return;
      }

      const conversationId = SessionManager.open(sessionFile).getSessionId();
      const profile = getCurrentProfileFn();
      const targetBinding = getConversationExecutionTarget({
        profile,
        conversationId,
      });

      if (targetBinding) {
        const result = await resumeRemoteLiveSession({
          profile,
          conversationId,
          localSessionFile: sessionFile,
          targetId: targetBinding.targetId,
        });
        res.json(result);
        return;
      }

      const result = await resumeLocalSession(sessionFile, buildLiveSessionResourceOptions());
      await flushLiveDeferredResumesFn();
      res.json(result);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/live-sessions/:id', (req, res) => {
    const live = isLiveSession(req.params.id);
    if (!live) {
      res.status(404).json({ live: false });
      return;
    }

    const entry = listAllLiveSessions().find((session) => session.id === req.params.id);
    res.json({ live: true, ...entry });
  });

  router.post('/api/live-sessions/:id/takeover', (req, res) => {
    try {
      const { id } = req.params;
      const surfaceId = typeof req.body?.surfaceId === 'string' ? req.body.surfaceId.trim() : '';
      if (!surfaceId) {
        res.status(400).json({ error: 'surfaceId is required' });
        return;
      }
      if (!isLocalLive(id)) {
        res.status(400).json({ error: 'Takeover is only available for local live conversations right now.' });
        return;
      }

      res.json(takeOverSessionControl(id, surfaceId));
    } catch (error) {
      if (error instanceof LiveSessionControlError) {
        res.status(409).json({ error: error.message });
        return;
      }

      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.get('/api/live-sessions/:id/events', (req, res) => {
    const { id } = req.params;
    if (!isLiveSession(id)) {
      res.status(404).json({ error: 'Not a live session' });
      return;
    }

    const rawTailBlocks = Array.isArray(req.query.tailBlocks) ? req.query.tailBlocks[0] : req.query.tailBlocks;
    const parsedTailBlocks = typeof rawTailBlocks === 'string'
      ? Number.parseInt(rawTailBlocks, 10)
      : typeof rawTailBlocks === 'number'
        ? rawTailBlocks
        : undefined;
    const tailBlocks = Number.isInteger(parsedTailBlocks) && (parsedTailBlocks as number) > 0
      ? parsedTailBlocks as number
      : undefined;
    const rawSurfaceId = Array.isArray(req.query.surfaceId) ? req.query.surfaceId[0] : req.query.surfaceId;
    const surfaceId = typeof rawSurfaceId === 'string' ? rawSurfaceId.trim() : '';
    const rawSurfaceType = Array.isArray(req.query.surfaceType) ? req.query.surfaceType[0] : req.query.surfaceType;
    const surfaceType = rawSurfaceType === 'mobile_web' ? 'mobile_web' : 'desktop_web';

    writeSseHeaders(res);

    const heartbeat = setInterval(() => {
      if (!isValidCompanionSession(req)) {
        clearInterval(heartbeat);
        unsubscribe?.();
        res.end();
        return;
      }

      res.write(': heartbeat\n\n');
    }, 15_000);

    const unsubscribe = subscribeLiveSession(id, (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }, {
      ...(tailBlocks ? { tailBlocks } : {}),
      ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
    });

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe?.();
    });
  });

  router.post('/api/live-sessions/:id/prompt', handleLiveSessionPrompt);

  router.post('/api/live-sessions/:id/abort', async (req, res) => {
    try {
      ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
      await abortLiveSession(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      if (writeLiveConversationControlError(res, err)) {
        return;
      }
      res.status(500).json({ error: String(err) });
    }
  });
}

export function registerLiveSessionStatsRoutes(
  router: Pick<Express, 'get'>,
  context: Pick<ServerRouteContext, 'getCurrentProfile' | 'getRepoRoot' | 'getDefaultWebCwd' | 'buildLiveSessionResourceOptions' | 'buildLiveSessionExtensionFactories' | 'flushLiveDeferredResumes' | 'listTasksForCurrentProfile' | 'listMemoryDocs' | 'listSkillsForCurrentProfile' | 'listProfileAgentItems'>,
): void {
  initializeLiveSessionRoutesContext(context);
  router.get('/api/live-sessions/:id/stats', (req, res) => {
    try {
      const stats = getSessionStats(req.params.id);
      if (!stats) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(stats);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });

  router.get('/api/live-sessions/:id/context-usage', (req, res) => {
    if (isRemoteLiveSession(req.params.id)) {
      res.json({ tokens: null, modelId: undefined, contextWindow: undefined });
      return;
    }

    try {
      const usage = getSessionContextUsage(req.params.id);
      if (!usage) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.json(usage);
    } catch (err) {
      logError('request handler error', {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: String(err) });
    }
  });
}
