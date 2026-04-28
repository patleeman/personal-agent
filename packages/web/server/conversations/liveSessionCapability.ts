import { existsSync } from 'node:fs';
import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';
import {
  resolveConversationAttachmentPromptFiles,
} from '@personal-agent/core';
import {
  listPendingBackgroundRunResults,
  loadDaemonConfig,
  markBackgroundRunResultsDelivered,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
} from '@personal-agent/daemon';
import type { MemoryDocSummary } from '../routes/context.js';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedTasksContext,
  expandPromptReferencesWithNodeGraph,
  extractMentionIds,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
} from '../knowledge/promptReferences.js';
import { buildReferencedVaultFilesContext, resolveMentionedVaultFiles } from '../knowledge/vaultFiles.js';
import {
  buildAttachedConversationContextDocsContext,
  readConversationContextDocs,
} from './conversationContextDocs.js';
import { queueConversationSummaryRefresh } from './conversationSummaries.js';
import {
  abortSession as abortLocalSession,
  branchSession as branchLiveSession,
  compactSession as compactLiveSession,
  createSession as createLocalSession,
  destroySession as destroyLiveSession,
  forkSession as forkLiveSession,
  isLive as isLocalLive,
  queuePromptContext,
  registry as liveRegistry,
  reloadSessionResources as reloadLiveSessionResources,
  restoreQueuedMessage as restoreQueuedLiveSessionMessage,
  resumeSession as resumeLocalSession,
  manageParallelPromptJob,
  startParallelPromptSession,
  submitPromptSession as submitLocalPromptSession,
  summarizeAndForkSession as summarizeAndForkLiveSession,
  takeOverSessionControl,
  type PromptImageAttachment,
} from './liveSessions.js';
import { readSessionBlocks, readSessionMeta } from './sessions.js';
import { resolveConversationCwd, resolveNeutralChatCwd } from './conversationCwd.js';
import { syncWebLiveConversationRun } from './conversationRuns.js';
import { appendConversationWorkspaceMetadata } from './sessions.js';
import { invalidateAppTopics, logError, logWarn } from '../middleware/index.js';
import {
  buildRelatedConversationPointers,
} from './relatedConversationPointers.js';

export interface LiveSessionCapabilityContext {
  getCurrentProfile: () => string;
  getRepoRoot: () => string;
  getDefaultWebCwd: () => string;
  buildLiveSessionResourceOptions: (profile?: string) => Record<string, unknown>;
  buildLiveSessionExtensionFactories: () => ExtensionFactory[];
  flushLiveDeferredResumes: () => Promise<void>;
  listTasksForCurrentProfile: () => Array<{
    id: string;
    title?: string;
    filePath?: string;
    prompt: string;
    enabled: boolean;
    running: boolean;
    cron?: string;
    at?: string;
    model?: string;
    cwd?: string;
    lastStatus?: string;
    lastRunAt?: string;
    lastSuccessAt?: string;
    lastAttemptCount?: number;
  }>;
  listMemoryDocs: () => MemoryDocSummary[];
}

export interface CreateLiveSessionCapabilityInput {
  cwd?: string;
  workspaceCwd?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
}

export interface CreateLiveSessionCapabilityResult {
  id: string;
  sessionFile: string;
  bootstrap?: {
    conversationId: string;
    sessionDetail: {
      meta: {
        id: string;
        file: string;
        timestamp: string;
        cwd: string;
        cwdSlug: string;
        model: string;
        title: string;
        messageCount: number;
        isRunning: boolean;
        isLive: boolean;
        lastActivityAt: string;
      };
      blocks: [];
      blockOffset: number;
      totalBlocks: number;
      contextUsage: null;
    };
    sessionDetailSignature: null;
    liveSession: {
      live: true;
      id: string;
      cwd: string;
      sessionFile: string;
      title?: string;
      isStreaming: boolean;
      hasPendingHiddenTurn?: boolean;
    };
  };
}

export interface ResumeLiveSessionCapabilityInput {
  sessionFile: string;
  cwd?: string;
}

export interface PromptAttachmentRefInput {
  attachmentId: string;
  revision?: number;
}

export interface SubmitLiveSessionPromptCapabilityInput {
  conversationId: string;
  text?: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: unknown;
  contextMessages?: unknown;
  relatedConversationIds?: unknown;
  surfaceId?: string;
}

export interface SubmitLiveSessionParallelPromptCapabilityInput {
  conversationId: string;
  text?: string;
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: unknown;
  contextMessages?: unknown;
  relatedConversationIds?: unknown;
  surfaceId?: string;
}

export interface ManageLiveSessionParallelJobCapabilityInput {
  conversationId: string;
  jobId: string;
  action: 'importNow' | 'skip' | 'cancel';
}

export interface TakeOverLiveSessionCapabilityInput {
  conversationId: string;
  surfaceId: string;
}

export interface RestoreQueuedLiveSessionMessageCapabilityInput {
  conversationId: string;
  behavior: 'steer' | 'followUp';
  index: number;
  previewId?: string;
}

export interface CompactLiveSessionCapabilityInput {
  conversationId: string;
  customInstructions?: string;
}

export interface ReloadLiveSessionCapabilityInput {
  conversationId: string;
}

export interface DestroyLiveSessionCapabilityInput {
  conversationId: string;
}

export interface BranchLiveSessionCapabilityInput {
  conversationId: string;
  entryId: string;
}

export interface ForkLiveSessionCapabilityInput {
  conversationId: string;
  entryId: string;
  preserveSource?: boolean;
  beforeEntry?: boolean;
}

export interface SummarizeAndForkLiveSessionCapabilityInput {
  conversationId: string;
}

export class LiveSessionCapabilityInputError extends Error {}

function buildLiveSessionOptions(
  context: LiveSessionCapabilityContext,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...context.buildLiveSessionResourceOptions(context.getCurrentProfile()),
    extensionFactories: context.buildLiveSessionExtensionFactories(),
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
    'If the only sensible next step is to wait and inspect again later, add a conversation_queue item with trigger "delay" or "at" yourself instead of asking the user to remind you.',
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

function normalizePromptContextMessages(value: unknown): Array<{ customType: string; content: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  const messages: Array<{ customType: string; content: string }> = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const customType = typeof (candidate as { customType?: unknown }).customType === 'string'
      ? (candidate as { customType: string }).customType.trim()
      : '';
    const content = typeof (candidate as { content?: unknown }).content === 'string'
      ? (candidate as { content: string }).content.trim()
      : '';
    if (!customType || !content) {
      continue;
    }

    const dedupeKey = `${customType}\n${content}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    messages.push({ customType, content });
  }

  return messages;
}

function normalizePromptImages(value: unknown): PromptImageAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const images = value
    .filter((image): image is { data: string; mimeType: string; name?: string } => (
      !!image
      && typeof image === 'object'
      && typeof (image as { data?: unknown }).data === 'string'
      && (image as { data: string }).data.length > 0
      && typeof (image as { mimeType?: unknown }).mimeType === 'string'
      && (image as { mimeType: string }).mimeType.trim().length > 0
    ))
    .map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType.trim(),
      ...(typeof image.name === 'string' && image.name.trim().length > 0 ? { name: image.name.trim() } : {}),
    }));

  return images.length > 0 ? images : undefined;
}

function normalizePromptBehavior(value: unknown): 'steer' | 'followUp' | undefined {
  return value === 'steer' || value === 'followUp' ? value : undefined;
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

function buildCreatedLiveSessionBootstrap(
  conversationId: string,
  sessionFile: string,
): CreateLiveSessionCapabilityResult['bootstrap'] | undefined {
  const liveEntry = liveRegistry.get(conversationId);
  if (!liveEntry) {
    return undefined;
  }

  const now = new Date().toISOString();
  const title = liveEntry.title.trim() || 'New Conversation';
  const model = typeof liveEntry.session.model?.id === 'string'
    ? liveEntry.session.model.id
    : '';
  const hasPendingHiddenTurn = liveEntry.pendingHiddenTurnCustomTypes.length > 0
    || liveEntry.activeHiddenTurnCustomType !== null;
  const isRunning = liveEntry.session.isStreaming || hasPendingHiddenTurn;

  return {
    conversationId,
    sessionDetail: {
      meta: {
        id: conversationId,
        file: sessionFile,
        timestamp: now,
        cwd: liveEntry.cwd,
        cwdSlug: liveEntry.cwd.replace(/\//g, '-'),
        model,
        title,
        messageCount: 0,
        isRunning,
        isLive: true,
        lastActivityAt: now,
      },
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      contextUsage: null,
    },
    sessionDetailSignature: null,
    liveSession: {
      live: true,
      id: conversationId,
      cwd: liveEntry.cwd,
      sessionFile,
      ...(title ? { title } : {}),
      isStreaming: liveEntry.session.isStreaming,
      ...(hasPendingHiddenTurn ? { hasPendingHiddenTurn: true } : {}),
    },
  };
}

async function ensureConversationPromptTargetLive(
  conversationId: string,
  context: LiveSessionCapabilityContext,
): Promise<string> {
  if (isLocalLive(conversationId)) {
    return conversationId;
  }

  const sessionFile = readSessionBlocks(conversationId)?.meta.file;
  if (!sessionFile || !existsSync(sessionFile)) {
    throw new Error(`Session ${conversationId} is not live`);
  }

  const resumed = await resumeLocalSession(sessionFile, buildLiveSessionOptions(context));
  await context.flushLiveDeferredResumes();
  return resumed.id;
}

export async function createLiveSessionCapability(
  input: CreateLiveSessionCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<CreateLiveSessionCapabilityResult> {
  const profile = context.getCurrentProfile();
  const hasExplicitCwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0;
  const cwd = hasExplicitCwd
    ? resolveConversationCwd({
        repoRoot: context.getRepoRoot(),
        profile,
        explicitCwd: input.cwd,
        defaultCwd: context.getDefaultWebCwd(),
      })
    : resolveNeutralChatCwd(profile);

  const created = await createLocalSession(cwd, buildLiveSessionOptions(context, {
    ...(input.model !== undefined ? { initialModel: input.model } : {}),
    ...(input.thinkingLevel !== undefined ? { initialThinkingLevel: input.thinkingLevel } : {}),
    ...(input.serviceTier !== undefined ? { initialServiceTier: input.serviceTier } : {}),
  }));
  appendConversationWorkspaceMetadata({
    sessionFile: created.sessionFile,
    cwd,
    workspaceCwd: input.workspaceCwd !== undefined ? input.workspaceCwd : (hasExplicitCwd ? cwd : null),
  });
  const bootstrap = buildCreatedLiveSessionBootstrap(created.id, created.sessionFile);

  return {
    ...created,
    ...(bootstrap ? { bootstrap } : {}),
  };
}

export async function resumeLiveSessionCapability(
  input: ResumeLiveSessionCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<{ id: string }> {
  const sessionFile = input.sessionFile?.trim();
  if (!sessionFile) {
    throw new LiveSessionCapabilityInputError('sessionFile required');
  }

  const cwd = typeof input.cwd === 'string' && input.cwd.trim().length > 0
    ? input.cwd.trim()
    : undefined;

  const result = await resumeLocalSession(sessionFile, {
    ...buildLiveSessionOptions(context),
    ...(cwd ? { cwdOverride: cwd } : {}),
  });
  await context.flushLiveDeferredResumes();
  return result;
}

interface PreparedLiveSessionPrompt {
  conversationId: string;
  text: string;
  surfaceId?: string;
  currentProfile: string;
  promptReferences: {
    projectIds: string[];
    taskIds: string[];
    memoryDocIds: string[];
    skillNames: string[];
  };
  referencedVaultFiles: Array<{ id: string; path: string }>;
  referencedAttachments: ReturnType<typeof resolveConversationAttachmentPromptFiles>;
  normalizedContextMessages: Array<{ customType: string; content: string }>;
  promptImages: PromptImageAttachment[] | undefined;
  backgroundRunContextEntries: Array<{ id: string; prompt: string }>;
  sourceSessionFile?: string;
}

function hasConversationTranscriptContent(conversationId: string): boolean {
  const liveEntry = liveRegistry.get(conversationId);
  const liveStateMessages = (liveEntry?.session as { state?: { messages?: unknown[] } } | undefined)?.state?.messages;
  if ((liveStateMessages?.length ?? 0) > 0) {
    return true;
  }

  return (readSessionBlocks(conversationId, { tailBlocks: 1 })?.totalBlocks ?? 0) > 0;
}

const LEGACY_RELATED_THREADS_CONTEXT_CUSTOM_TYPE = 'related_threads_context';

function withoutLegacyRelatedThreadSummaries(
  contextMessages: Array<{ customType: string; content: string }>,
): Array<{ customType: string; content: string }> {
  return contextMessages.filter((message) => message.customType !== LEGACY_RELATED_THREADS_CONTEXT_CUSTOM_TYPE);
}

function buildPromptContextMessagesForSubmit(input: {
  conversationId: string;
  prompt: string;
  currentCwd?: string;
  selectedSessionIds?: unknown;
  contextMessages: Array<{ customType: string; content: string }>;
}): { contextMessages: Array<{ customType: string; content: string }>; warnings: string[] } {
  const contextMessages = withoutLegacyRelatedThreadSummaries(input.contextMessages);
  if (hasConversationTranscriptContent(input.conversationId)) {
    return { contextMessages, warnings: [] };
  }

  try {
    const pointers = buildRelatedConversationPointers({
      prompt: input.prompt,
      currentConversationId: input.conversationId,
      currentCwd: input.currentCwd,
      selectedSessionIds: input.selectedSessionIds,
    });

    return {
      contextMessages: [...contextMessages, ...pointers.contextMessages],
      warnings: pointers.warnings,
    };
  } catch (error) {
    logWarn('related conversation pointer generation failed', {
      conversationId: input.conversationId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      contextMessages,
      warnings: ['Related conversation pointers failed; sent without them.'],
    };
  }
}

async function prepareLiveSessionPrompt(
  input: {
    conversationId: string;
    text?: string;
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: unknown;
    contextMessages?: unknown;
    surfaceId?: string;
  },
  context: LiveSessionCapabilityContext,
): Promise<PreparedLiveSessionPrompt> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const normalizedAttachmentRefs = normalizePromptAttachmentRefs(input.attachmentRefs);
  const promptContextMessages = normalizePromptContextMessages(input.contextMessages);
  const promptImages = normalizePromptImages(input.images);
  if (!text && (!promptImages || promptImages.length === 0) && normalizedAttachmentRefs.length === 0) {
    throw new LiveSessionCapabilityInputError('text, images, or attachmentRefs required');
  }

  const surfaceId = typeof input.surfaceId === 'string' && input.surfaceId.trim().length > 0
    ? input.surfaceId.trim()
    : undefined;

  const currentProfile = context.getCurrentProfile();
  const mentionIds = extractMentionIds(text);
  const hasPromptMentions = mentionIds.length > 0;
  const tasks = hasPromptMentions
    ? context.listTasksForCurrentProfile()
    : [];
  const memoryDocs = hasPromptMentions
    ? context.listMemoryDocs().map((doc) => ({
        ...doc,
        summary: doc.summary ?? '',
        description: doc.description ?? '',
      }))
    : [];
  const promptReferences = hasPromptMentions
    ? resolvePromptReferences({
        text,
        availableProjectIds: [],
        tasks,
        memoryDocs,
        skills: [],
      })
    : {
        projectIds: [],
        taskIds: [],
        memoryDocIds: [],
        skillNames: [],
      };
  const expandedNodeReferences = promptReferences.projectIds.length > 0
    || promptReferences.memoryDocIds.length > 0
    || promptReferences.skillNames.length > 0
    ? expandPromptReferencesWithNodeGraph({
        projectIds: promptReferences.projectIds,
        memoryDocIds: promptReferences.memoryDocIds,
        skillNames: promptReferences.skillNames,
      })
    : {
        projectIds: promptReferences.projectIds,
        memoryDocIds: promptReferences.memoryDocIds,
        skillNames: promptReferences.skillNames,
      };
  const referencedTasks = pickPromptReferencesInOrder(promptReferences.taskIds, tasks);
  const referencedMemoryDocs = pickPromptReferencesInOrder(expandedNodeReferences.memoryDocIds, memoryDocs);
  const referencedVaultFiles = hasPromptMentions
    ? resolveMentionedVaultFiles(text)
    : [];

  let referencedAttachments: ReturnType<typeof resolveConversationAttachmentPromptFiles> = [];
  if (normalizedAttachmentRefs.length > 0) {
    try {
      referencedAttachments = resolveConversationAttachmentPromptFiles({
        profile: currentProfile,
        conversationId,
        refs: normalizedAttachmentRefs,
      });
    } catch (error) {
      throw new LiveSessionCapabilityInputError(error instanceof Error ? error.message : String(error));
    }
  }

  const liveEntry = liveRegistry.get(conversationId);
  const sessionFile = liveEntry?.session.sessionFile;
  const daemonRunsRoot = resolveDurableRunsRoot(resolveDaemonRoot());
  const backgroundRunContextEntries = sessionFile
    ? listPendingBackgroundRunResults({
        runsRoot: daemonRunsRoot,
        sessionFile,
      })
    : [];
  const backgroundRunHiddenContext = buildBackgroundRunHiddenContext(backgroundRunContextEntries);

  const referencedPaths = new Set<string>([
    ...referencedMemoryDocs.map((doc) => doc.path),
    ...referencedVaultFiles.map((file) => file.path),
  ]);
  const attachedConversationContextDocs = readConversationContextDocs(conversationId)
    .filter((doc) => !referencedPaths.has(doc.path));

  const queuedContextBlocks = [
    attachedConversationContextDocs.length > 0 ? buildAttachedConversationContextDocsContext(attachedConversationContextDocs) : '',
    referencedAttachments.length > 0 ? buildConversationAttachmentsContext(referencedAttachments) : '',
    referencedTasks.length > 0 ? buildReferencedTasksContext(referencedTasks, context.getRepoRoot()) : '',
    referencedMemoryDocs.length > 0 ? buildReferencedMemoryDocsContext(referencedMemoryDocs, context.getRepoRoot()) : '',
    referencedVaultFiles.length > 0 ? buildReferencedVaultFilesContext(referencedVaultFiles) : '',
    backgroundRunHiddenContext,
  ].filter(Boolean);

  const hiddenContext = queuedContextBlocks.join('\n\n');
  const normalizedContextMessages = [
    ...promptContextMessages,
    ...(queuedContextBlocks.length > 0
      ? [{
          customType: 'referenced_context',
          content: hiddenContext,
        }]
      : []),
  ];

  return {
    conversationId,
    text,
    surfaceId,
    currentProfile,
    promptReferences,
    referencedVaultFiles: referencedVaultFiles.map((file) => ({ id: file.id, path: file.path })),
    referencedAttachments,
    normalizedContextMessages,
    promptImages,
    backgroundRunContextEntries,
    sourceSessionFile: sessionFile,
  };
}

export async function submitLiveSessionPromptCapability(
  input: SubmitLiveSessionPromptCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<{
  ok: true;
  accepted: true;
  delivery: 'started' | 'queued';
  referencedTaskIds: string[];
  referencedMemoryDocIds: string[];
  referencedVaultFileIds: string[];
  referencedAttachmentIds: string[];
  relatedConversationPointerWarnings?: string[];
}> {
  const prepared = await prepareLiveSessionPrompt(input, context);
  const behavior = normalizePromptBehavior(input.behavior);
  const liveConversationId = await ensureConversationPromptTargetLive(prepared.conversationId, context);
  const recoveredLiveEntry = liveRegistry.get(liveConversationId);
  const promptContext = buildPromptContextMessagesForSubmit({
    conversationId: liveConversationId,
    prompt: prepared.text,
    currentCwd: recoveredLiveEntry?.cwd,
    selectedSessionIds: input.relatedConversationIds,
    contextMessages: prepared.normalizedContextMessages,
  });
  const promptContextMessages = promptContext.contextMessages;

  for (const message of promptContextMessages) {
    await queuePromptContext(liveConversationId, message.customType, message.content);
  }

  if (recoveredLiveEntry?.session.sessionFile) {
    await syncWebLiveConversationRun({
      conversationId: liveConversationId,
      sessionFile: recoveredLiveEntry.session.sessionFile,
      cwd: recoveredLiveEntry.cwd,
      title: recoveredLiveEntry.title,
      profile: prepared.currentProfile,
      state: 'running',
      pendingOperation: {
        type: 'prompt',
        text: prepared.text,
        ...(behavior ? { behavior } : {}),
        ...(prepared.promptImages && prepared.promptImages.length > 0
          ? { images: prepared.promptImages }
          : {}),
        ...(promptContextMessages.length > 0
          ? {
              contextMessages: promptContextMessages,
            }
          : {}),
        enqueuedAt: new Date().toISOString(),
      },
    });
  }

  const submittedPrompt = await submitLocalPromptSession(
    liveConversationId,
    prepared.text,
    behavior,
    prepared.promptImages,
    prepared.surfaceId,
  );
  const promptPromise = submittedPrompt.completion;
  const daemonRunsRoot = resolveDurableRunsRoot(resolveDaemonRoot());

  void promptPromise.then(async () => {
    if (!prepared.sourceSessionFile || prepared.backgroundRunContextEntries.length === 0) {
      return;
    }

    try {
      const deliveredIds = markBackgroundRunResultsDelivered({
        runsRoot: daemonRunsRoot,
        sessionFile: prepared.sourceSessionFile,
        resultIds: prepared.backgroundRunContextEntries.map((entry) => entry.id),
      });
      if (deliveredIds.length > 0) {
        invalidateAppTopics('runs');
      }
    } catch (error) {
      logWarn('background run context completion error', {
        sessionId: prepared.conversationId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }).catch(async (error: unknown) => {
    if (recoveredLiveEntry?.session.sessionFile) {
      await syncWebLiveConversationRun({
        conversationId: liveConversationId,
        sessionFile: recoveredLiveEntry.session.sessionFile,
        cwd: recoveredLiveEntry.cwd,
        title: recoveredLiveEntry.title,
        profile: prepared.currentProfile,
        state: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      });
    }

    logError('live prompt error', {
      sessionId: liveConversationId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  });

  return {
    ok: true,
    accepted: true,
    delivery: submittedPrompt.acceptedAs,
    referencedTaskIds: prepared.promptReferences.taskIds,
    referencedMemoryDocIds: prepared.promptReferences.memoryDocIds,
    referencedVaultFileIds: prepared.referencedVaultFiles.map((file) => file.id),
    referencedAttachmentIds: prepared.referencedAttachments.map((attachment) => attachment.attachmentId),
    ...(promptContext.warnings.length > 0 ? { relatedConversationPointerWarnings: promptContext.warnings } : {}),
  };
}

export async function submitLiveSessionParallelPromptCapability(
  input: SubmitLiveSessionParallelPromptCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<{
  ok: true;
  accepted: true;
  jobId: string;
  childConversationId: string;
  referencedTaskIds: string[];
  referencedMemoryDocIds: string[];
  referencedVaultFileIds: string[];
  referencedAttachmentIds: string[];
  relatedConversationPointerWarnings?: string[];
}> {
  const prepared = await prepareLiveSessionPrompt(input, context);
  const liveConversationId = await ensureConversationPromptTargetLive(prepared.conversationId, context);
  const recoveredLiveEntry = liveRegistry.get(liveConversationId);
  const promptContext = buildPromptContextMessagesForSubmit({
    conversationId: liveConversationId,
    prompt: prepared.text,
    currentCwd: recoveredLiveEntry?.cwd,
    selectedSessionIds: input.relatedConversationIds,
    contextMessages: prepared.normalizedContextMessages,
  });
  const promptContextMessages = promptContext.contextMessages;
  const parallel = await startParallelPromptSession(
    liveConversationId,
    {
      text: prepared.text,
      images: prepared.promptImages,
      attachmentRefs: prepared.referencedAttachments.map((attachment) => `${attachment.attachmentId} (rev ${attachment.revision})`),
      contextMessages: promptContextMessages,
    },
    buildLiveSessionOptions(context),
  );

  return {
    ok: true,
    accepted: true,
    jobId: parallel.jobId,
    childConversationId: parallel.childConversationId,
    referencedTaskIds: prepared.promptReferences.taskIds,
    referencedMemoryDocIds: prepared.promptReferences.memoryDocIds,
    referencedVaultFileIds: prepared.referencedVaultFiles.map((file) => file.id),
    referencedAttachmentIds: prepared.referencedAttachments.map((attachment) => attachment.attachmentId),
    ...(promptContext.warnings.length > 0 ? { relatedConversationPointerWarnings: promptContext.warnings } : {}),
  };
}

export async function manageLiveSessionParallelJobCapability(
  input: ManageLiveSessionParallelJobCapabilityInput,
): Promise<{ ok: true; status: 'imported' | 'queued' | 'skipped' | 'cancelled' }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  const jobId = input.jobId.trim();
  if (!jobId) {
    throw new LiveSessionCapabilityInputError('jobId required');
  }

  if (input.action !== 'importNow' && input.action !== 'skip' && input.action !== 'cancel') {
    throw new LiveSessionCapabilityInputError('action must be "importNow", "skip", or "cancel"');
  }

  return manageParallelPromptJob(conversationId, {
    jobId,
    action: input.action,
  });
}

export function takeOverLiveSessionCapability(input: TakeOverLiveSessionCapabilityInput) {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  const surfaceId = input.surfaceId.trim();
  if (!surfaceId) {
    throw new LiveSessionCapabilityInputError('surfaceId required');
  }

  return takeOverSessionControl(conversationId, surfaceId);
}

export async function restoreQueuedLiveSessionMessageCapability(
  input: RestoreQueuedLiveSessionMessageCapabilityInput,
): Promise<{ ok: true; text: string; images: PromptImageAttachment[] }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }
  if (input.behavior !== 'steer' && input.behavior !== 'followUp') {
    throw new LiveSessionCapabilityInputError('behavior must be "steer" or "followUp"');
  }
  if (!Number.isInteger(input.index) || input.index < 0) {
    throw new LiveSessionCapabilityInputError('index must be a non-negative integer');
  }

  const restored = await restoreQueuedLiveSessionMessage(
    conversationId,
    input.behavior,
    input.index,
    input.previewId,
  );
  return { ok: true, ...restored };
}

export async function compactLiveSessionCapability(
  input: CompactLiveSessionCapabilityInput,
): Promise<{ ok: true; result: unknown }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  const result = await compactLiveSession(conversationId, input.customInstructions?.trim() || undefined);
  return { ok: true, result };
}

export async function reloadLiveSessionCapability(
  input: ReloadLiveSessionCapabilityInput,
): Promise<{ ok: true }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  await reloadLiveSessionResources(conversationId);
  return { ok: true };
}

export async function destroyLiveSessionCapability(
  input: DestroyLiveSessionCapabilityInput,
): Promise<{ ok: true }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  destroyLiveSession(conversationId);
  const meta = readSessionMeta(conversationId);
  if (meta) {
    queueConversationSummaryRefresh(meta);
  }
  return { ok: true };
}

export async function branchLiveSessionCapability(
  input: BranchLiveSessionCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<{ newSessionId: string; sessionFile: string }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  const entryId = input.entryId.trim();
  if (!entryId) {
    throw new LiveSessionCapabilityInputError('entryId required');
  }

  return branchLiveSession(conversationId, entryId, buildLiveSessionOptions(context));
}

export async function forkLiveSessionCapability(
  input: ForkLiveSessionCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<{ newSessionId: string; sessionFile: string }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  const entryId = input.entryId.trim();
  if (!entryId) {
    throw new LiveSessionCapabilityInputError('entryId required');
  }

  return forkLiveSession(conversationId, entryId, {
    preserveSource: input.preserveSource,
    beforeEntry: input.beforeEntry,
    ...buildLiveSessionOptions(context),
  });
}

export async function summarizeAndForkLiveSessionCapability(
  input: SummarizeAndForkLiveSessionCapabilityInput,
  context: LiveSessionCapabilityContext,
): Promise<{ newSessionId: string; sessionFile: string }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  return summarizeAndForkLiveSession(conversationId, buildLiveSessionOptions(context));
}

export async function abortLiveSessionCapability(input: {
  conversationId: string;
}): Promise<{ ok: true }> {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new LiveSessionCapabilityInputError('conversationId required');
  }

  await abortLocalSession(conversationId);
  return { ok: true };
}
