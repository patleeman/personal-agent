import { logWarn } from '../shared/logging.js';
import { buildParallelImportedContent } from './liveSessionForking.js';
import type { ParallelPromptJob, ParallelPromptJobStatus } from './liveSessionParallelJobs.js';

export interface LiveSessionParallelImportHost {
  sessionId: string;
  session: {
    isStreaming: boolean;
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
  hasQueuedOrActiveHiddenTurn: (entry: TEntry) => boolean;
  persistParallelJobs: (entry: TEntry) => void;
  broadcastParallelState: (entry: TEntry, force?: boolean) => void;
  appendParallelImportedMessage: (
    sessionId: string,
    content: string,
    details: { childConversationId: string; status: 'complete' | 'failed' },
  ) => Promise<void>;
  finalizeParallelChildLiveSession: (childConversationId: string, options?: { abortIfRunning?: boolean }) => Promise<'destroyed' | 'preserved' | 'missing'>;
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
  if (entry.importingParallelJobs || entry.session.isStreaming || callbacks.hasQueuedOrActiveHiddenTurn(entry)) {
    return;
  }

  const nextJob = entry.parallelJobs[0];
  if (!nextJob || (nextJob.status !== 'ready' && nextJob.status !== 'failed')) {
    return;
  }

  entry.importingParallelJobs = true;
  try {
    while (!entry.session.isStreaming && !callbacks.hasQueuedOrActiveHiddenTurn(entry)) {
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
        await callbacks.appendParallelImportedMessage(
          entry.sessionId,
          buildParallelImportedContent(currentJob),
          {
            childConversationId: currentJob.childConversationId,
            status: currentJob.error?.trim() ? 'failed' : 'complete',
          },
        );
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
  callbacks: Pick<LiveSessionParallelImportCallbacks<TEntry>, 'persistParallelJobs' | 'broadcastParallelState' | 'finalizeParallelChildLiveSession'> & {
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
