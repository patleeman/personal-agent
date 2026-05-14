import { existsSync } from 'node:fs';

import { logWarn } from '../shared/logging.js';
import { readGitRepoInfo } from '../workspace/gitStatus.js';
import { buildParallelImportedContent, resolveStableForkEntryId } from './liveSessionForking.js';
import type { LiveSessionLoaderOptions } from './liveSessionLoader.js';
import { normalizeParallelPromptList, type ParallelPromptJob, type ParallelPromptJobStatus } from './liveSessionParallelJobs.js';
import {
  readParallelCurrentWorktreeDirtyPaths,
  readParallelJobCompletionFromSessionFile,
  replacePersistedParallelJob,
  type ResolveParallelChildSession,
} from './liveSessionParallelReconciliation.js';
import type { PromptImageAttachment } from './liveSessionQueue.js';

export interface LiveSessionParallelImportHost {
  sessionId: string;
  cwd: string;
  session: {
    isStreaming: boolean;
    sessionFile?: string | null;
    model?: { id?: string } | null;
    thinkingLevel?: string | null;
    sessionManager?: unknown;
  };
  parallelJobs?: ParallelPromptJob[];
  importingParallelJobs?: boolean;
}

export interface LiveSessionParallelChildHost {
  session: {
    isStreaming: boolean;
    abort: () => Promise<void>;
  };
  listeners: Set<unknown>;
  presenceBySurfaceId?: Map<string, unknown>;
}

export interface LiveSessionParallelImportCallbacks<TEntry extends LiveSessionParallelImportHost> {
  hasQueuedOrActiveStaleTurn: (entry: TEntry) => boolean;
  persistParallelJobs: (entry: TEntry) => void;
  broadcastParallelState: (entry: TEntry, force?: boolean) => void;
  appendParallelImportedMessage: (
    sessionId: string,
    content: string,
    details: { childConversationId: string; status: 'complete' | 'failed' },
  ) => Promise<void>;
  finalizeParallelChildLiveSession: (
    childConversationId: string,
    options?: { abortIfRunning?: boolean },
  ) => Promise<'destroyed' | 'preserved' | 'missing'>;
}

export async function startParallelPromptSession<TEntry extends LiveSessionParallelImportHost>(
  entry: TEntry,
  input: {
    text: string;
    images?: PromptImageAttachment[];
    attachmentRefs?: string[];
    contextMessages?: Array<{ customType: string; content: string }>;
  },
  options: LiveSessionLoaderOptions,
  callbacks: {
    createJobId: () => string;
    createSession: (cwd: string, options: LiveSessionLoaderOptions) => Promise<{ id: string; sessionFile: string }>;
    forkSession: (
      sessionId: string,
      entryId: string,
      options: LiveSessionLoaderOptions & { preserveSource?: boolean },
    ) => Promise<{ newSessionId: string; sessionFile: string }>;
    queuePromptContext: (sessionId: string, customType: string, content: string) => Promise<void>;
    submitPromptSession: (
      sessionId: string,
      text: string,
      behavior?: 'steer' | 'followUp',
      images?: PromptImageAttachment[],
    ) => Promise<{ acceptedAs: 'started' | 'queued'; completion: Promise<void> }>;
    resolveDefaultServiceTier: (entry: TEntry) => LiveSessionLoaderOptions['initialServiceTier'];
    hasQueuedOrActiveStaleTurn: (entry: TEntry) => boolean;
    persistParallelJobs: (entry: TEntry) => void;
    broadcastParallelState: (entry: TEntry, force?: boolean) => void;
    getCurrentEntry: () => TEntry | undefined;
    resolveParallelChildSession: ResolveParallelChildSession;
    tryImportReadyParallelJobs: (entry: TEntry) => Promise<void>;
  },
): Promise<{ jobId: string; childConversationId: string }> {
  const text = input.text.trim();
  if (!text && (!input.images || input.images.length === 0)) {
    throw new Error('text or images required');
  }

  const sourceSessionFile = entry.session.sessionFile?.trim();
  if (!sourceSessionFile) {
    throw new Error('Parallel prompts require a persisted session file.');
  }

  const activeTurnInProgress = entry.session.isStreaming || callbacks.hasQueuedOrActiveStaleTurn(entry);
  if (!activeTurnInProgress) {
    throw new Error('Parallel prompts are only available while the conversation is busy.');
  }

  const parallelRepoRoot = readGitRepoInfo(entry.cwd)?.root;
  const stableEntryId = resolveStableForkEntryId(sourceSessionFile, { activeTurnInProgress });
  const forked = stableEntryId
    ? await callbacks.forkSession(entry.sessionId, stableEntryId, {
        preserveSource: true,
        ...options,
      })
    : await callbacks.createSession(entry.cwd, {
        ...options,
        initialModel: options.initialModel === undefined ? (entry.session.model?.id ?? null) : options.initialModel,
        initialThinkingLevel:
          options.initialThinkingLevel === undefined ? (entry.session.thinkingLevel ?? null) : options.initialThinkingLevel,
        initialServiceTier:
          options.initialServiceTier === undefined ? callbacks.resolveDefaultServiceTier(entry) : options.initialServiceTier,
      });

  const childConversationId = 'id' in forked ? forked.id : forked.newSessionId;
  const job = createRunningParallelPromptJob({
    id: callbacks.createJobId(),
    prompt: text,
    childConversationId,
    childSessionFile: forked.sessionFile,
    imageCount: input.images?.length ?? 0,
    attachmentRefs: input.attachmentRefs,
    forkEntryId: stableEntryId ?? undefined,
    repoRoot: parallelRepoRoot,
    cwd: entry.cwd,
  });
  entry.parallelJobs ??= [];
  entry.parallelJobs.push(job);
  callbacks.persistParallelJobs(entry);
  callbacks.broadcastParallelState(entry, true);

  try {
    for (const message of input.contextMessages ?? []) {
      await callbacks.queuePromptContext(childConversationId, message.customType, message.content);
    }

    const submitted = await callbacks.submitPromptSession(childConversationId, text, undefined, input.images);
    const completionInput = {
      sourceSessionFile,
      jobId: job.id,
      childSessionFile: forked.sessionFile,
      cwd: entry.cwd,
      repoRoot: parallelRepoRoot,
      getCurrentEntry: callbacks.getCurrentEntry,
      resolveParallelChildSession: callbacks.resolveParallelChildSession,
      broadcastParallelState: callbacks.broadcastParallelState,
      tryImportReadyParallelJobs: callbacks.tryImportReadyParallelJobs,
    };
    void submitted.completion
      .then(() => handleParallelPromptCompletion(completionInput))
      .catch((error: unknown) => handleParallelPromptCompletion({ ...completionInput, error }));

    return {
      jobId: job.id,
      childConversationId,
    };
  } catch (error) {
    entry.parallelJobs = entry.parallelJobs.filter((candidate) => candidate.id !== job.id);
    callbacks.persistParallelJobs(entry);
    callbacks.broadcastParallelState(entry, true);
    throw error;
  }
}

export function createRunningParallelPromptJob(input: {
  id: string;
  prompt: string;
  childConversationId: string;
  childSessionFile: string;
  imageCount?: number;
  attachmentRefs?: string[];
  forkEntryId?: string;
  repoRoot?: string;
  cwd: string;
}): ParallelPromptJob {
  const now = new Date().toISOString();
  return {
    id: input.id,
    prompt: input.prompt,
    childConversationId: input.childConversationId,
    childSessionFile: input.childSessionFile,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    imageCount: input.imageCount ?? 0,
    attachmentRefs: normalizeParallelPromptList(input.attachmentRefs, 12),
    touchedFiles: [],
    parentTouchedFiles: [],
    overlapFiles: [],
    sideEffects: [],
    ...(input.forkEntryId ? { forkEntryId: input.forkEntryId } : {}),
    ...(input.repoRoot ? { repoRoot: input.repoRoot } : {}),
    worktreeDirtyPathsAtStart: readParallelCurrentWorktreeDirtyPaths(input.cwd, input.repoRoot),
  };
}

export async function handleParallelPromptCompletion<TEntry extends LiveSessionParallelImportHost>(input: {
  sourceSessionFile: string;
  jobId: string;
  childSessionFile: string;
  cwd: string;
  repoRoot?: string;
  error?: unknown;
  getCurrentEntry: () => TEntry | undefined;
  resolveParallelChildSession: ResolveParallelChildSession;
  broadcastParallelState: (entry: TEntry, force?: boolean) => void;
  tryImportReadyParallelJobs: (entry: TEntry) => Promise<void>;
}): Promise<void> {
  const completion = existsSync(input.childSessionFile)
    ? readParallelJobCompletionFromSessionFile(input.childSessionFile, { cwd: input.cwd, repoRoot: input.repoRoot })
    : { hasTerminalReply: false, touchedFiles: [] as string[], sideEffects: [] as string[] };
  const failed = input.error !== undefined;
  const nextJobs = replacePersistedParallelJob(
    input.sourceSessionFile,
    input.jobId,
    (currentJob) => ({
      ...currentJob,
      childSessionFile: input.childSessionFile,
      status: failed ? 'failed' : (completion.status ?? 'ready'),
      updatedAt: new Date().toISOString(),
      touchedFiles: completion.touchedFiles,
      sideEffects: completion.sideEffects,
      ...(failed || completion.status === 'failed'
        ? {
            error:
              completion.error ??
              (input.error instanceof Error
                ? input.error.message
                : input.error !== undefined
                  ? String(input.error)
                  : 'The parallel prompt failed before completing.'),
          }
        : {}),
      ...((!failed && completion.status === 'ready') || completion.resultText !== undefined
        ? { resultText: completion.resultText ?? '' }
        : {}),
    }),
    input.resolveParallelChildSession,
  );
  const currentEntry = input.getCurrentEntry();
  if (!currentEntry || currentEntry.session.sessionFile?.trim() !== input.sourceSessionFile) {
    return;
  }

  currentEntry.parallelJobs = nextJobs;
  input.broadcastParallelState(currentEntry, true);
  await input.tryImportReadyParallelJobs(currentEntry);
}

export function shouldPreserveParallelChildLiveSession(entry: LiveSessionParallelChildHost | undefined): boolean {
  if (!entry) {
    return false;
  }

  return entry.listeners.size > 0 || (entry.presenceBySurfaceId?.size ?? 0) > 0;
}

export async function finalizeParallelChildLiveSession(
  childConversationId: string,
  input: {
    childEntry: LiveSessionParallelChildHost | undefined;
    destroySession: (childConversationId: string) => void;
    abortIfRunning?: boolean;
  },
): Promise<'destroyed' | 'preserved' | 'missing'> {
  const childEntry = input.childEntry;
  if (!childEntry) {
    return 'missing';
  }

  if (input.abortIfRunning && childEntry.session.isStreaming) {
    try {
      await childEntry.session.abort();
    } catch (error) {
      logWarn('parallel child abort failed before cleanup', {
        conversationId: childConversationId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  if (shouldPreserveParallelChildLiveSession(childEntry)) {
    return 'preserved';
  }

  if (!input.abortIfRunning && childEntry.session.isStreaming) {
    return 'preserved';
  }

  input.destroySession(childConversationId);
  return 'destroyed';
}

export async function tryImportReadyParallelJobs<TEntry extends LiveSessionParallelImportHost>(
  entry: TEntry,
  callbacks: LiveSessionParallelImportCallbacks<TEntry>,
): Promise<void> {
  entry.parallelJobs ??= [];
  if (entry.importingParallelJobs || entry.session.isStreaming || callbacks.hasQueuedOrActiveStaleTurn(entry)) {
    return;
  }

  const nextJob = entry.parallelJobs[0];
  if (!nextJob || (nextJob.status !== 'ready' && nextJob.status !== 'failed')) {
    return;
  }

  entry.importingParallelJobs = true;
  try {
    while (!entry.session.isStreaming && !callbacks.hasQueuedOrActiveStaleTurn(entry)) {
      const currentJob = entry.parallelJobs[0];
      if (!currentJob || (currentJob.status !== 'ready' && currentJob.status !== 'failed')) {
        break;
      }

      const fallbackStatus: Extract<ParallelPromptJobStatus, 'ready' | 'failed'> = currentJob.error?.trim() ? 'failed' : 'ready';
      currentJob.status = 'importing';
      currentJob.updatedAt = new Date().toISOString();
      callbacks.persistParallelJobs(entry);
      callbacks.broadcastParallelState(entry, true);

      try {
        await callbacks.appendParallelImportedMessage(entry.sessionId, buildParallelImportedContent(currentJob), {
          childConversationId: currentJob.childConversationId,
          status: currentJob.error?.trim() ? 'failed' : 'complete',
        });
      } catch (error) {
        currentJob.status = fallbackStatus;
        currentJob.updatedAt = new Date().toISOString();
        callbacks.persistParallelJobs(entry);
        callbacks.broadcastParallelState(entry, true);
        throw error;
      }

      entry.parallelJobs.shift();
      callbacks.persistParallelJobs(entry);
      callbacks.broadcastParallelState(entry, true);
      await callbacks.finalizeParallelChildLiveSession(currentJob.childConversationId);
    }
  } finally {
    entry.importingParallelJobs = false;
  }
}

export async function manageParallelPromptJob<TEntry extends LiveSessionParallelImportHost>(
  entry: TEntry,
  input: { jobId: string; action: 'importNow' | 'skip' | 'cancel' },
  callbacks: Pick<
    LiveSessionParallelImportCallbacks<TEntry>,
    'persistParallelJobs' | 'broadcastParallelState' | 'finalizeParallelChildLiveSession'
  > & {
    tryImportReadyParallelJobs: (entry: TEntry) => Promise<void>;
  },
): Promise<{ ok: true; status: 'imported' | 'queued' | 'skipped' | 'cancelled' }> {
  const jobId = input.jobId.trim();
  if (!jobId) {
    throw new Error('jobId required');
  }

  entry.parallelJobs ??= [];
  const jobIndex = entry.parallelJobs.findIndex((candidate) => candidate.id === jobId);
  if (jobIndex < 0) {
    throw new Error('Parallel prompt no longer exists.');
  }

  const job = entry.parallelJobs[jobIndex]!;
  if (input.action === 'skip') {
    if (job.status === 'running') {
      throw new Error('Use cancel to stop a running parallel prompt.');
    }
    if (job.status === 'importing') {
      throw new Error('Parallel prompt is already being appended.');
    }

    entry.parallelJobs.splice(jobIndex, 1);
    callbacks.persistParallelJobs(entry);
    callbacks.broadcastParallelState(entry, true);
    await callbacks.finalizeParallelChildLiveSession(job.childConversationId);
    return { ok: true, status: 'skipped' };
  }

  if (input.action === 'cancel') {
    if (job.status === 'importing') {
      throw new Error('Parallel prompt is already being appended.');
    }

    entry.parallelJobs.splice(jobIndex, 1);
    callbacks.persistParallelJobs(entry);
    callbacks.broadcastParallelState(entry, true);
    await callbacks.finalizeParallelChildLiveSession(job.childConversationId, { abortIfRunning: true });
    return { ok: true, status: 'cancelled' };
  }

  if (job.status !== 'ready' && job.status !== 'failed') {
    throw new Error('Only completed parallel prompts can be imported now.');
  }

  if (jobIndex > 0) {
    entry.parallelJobs.splice(jobIndex, 1);
    entry.parallelJobs.unshift(job);
    callbacks.persistParallelJobs(entry);
    callbacks.broadcastParallelState(entry, true);
  }

  await callbacks.tryImportReadyParallelJobs(entry);
  const imported = !(entry.parallelJobs ?? []).some((candidate) => candidate.id === jobId);
  return { ok: true, status: imported ? 'imported' : 'queued' };
}
