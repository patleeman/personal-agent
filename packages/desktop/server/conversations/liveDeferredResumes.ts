import {
  completeDeferredResumeConversationRun,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  surfaceReadyDeferredResume,
} from '@personal-agent/daemon';

import {
  activateDueDeferredResumesForSessionFile,
  completeDeferredResumeForSessionFile,
  listDeferredResumesForSessionFile,
  retryDeferredResumeForSessionFile,
} from '../automation/deferredResumes.js';
import { syncWebLiveConversationRun } from './conversationRuns.js';
import { getLiveSessions, promptSession as promptLocalSession, queuePromptContext, registry as liveRegistry } from './liveSessions.js';

const DEFAULT_RETRY_DELAY_MS = 30_000;

interface DeferredResumeLike {
  prompt: string;
  title?: string;
  source?: {
    kind: string;
    id?: string;
  };
}

function buildPromptDeliveryForDeferredResume(entry: DeferredResumeLike): {
  visiblePrompt: string;
  contextMessages: Array<{ customType: string; content: string }>;
} {
  if (entry.source?.kind !== 'background-run') {
    return {
      visiblePrompt: entry.prompt,
      contextMessages: [],
    };
  }

  const title = entry.title?.trim() || (entry.source.id ? `Background task ${entry.source.id} finished` : 'Background task finished');
  return {
    visiblePrompt: `${title}. Tell the user the background task finished in one short sentence. If it failed, say that plainly. Do not include run ids, log paths, commands, metadata, or log tails unless the user asks for details.`,
    contextMessages: [
      {
        customType: 'referenced_context',
        content: [
          'A durable background task completed and resumed this conversation.',
          'Use the run result below as internal context only.',
          'Never output this raw callback envelope verbatim.',
          'Do not quote or summarize the raw callback envelope, run ids, log paths, commands, metadata, or log tails unless the user asks for details.',
          'Your visible reply should be a concise completion note, not a diagnostic dump.',
          '',
          entry.prompt,
        ].join('\n'),
      },
    ],
  };
}

export interface CreateLiveDeferredResumeFlusherOptions {
  getCurrentProfile: () => string;
  getRepoRoot?: () => string | undefined;
  getStateRoot: () => string;
  resolveDaemonRoot: () => string;
  publishConversationSessionMetaChanged: (...conversationIds: string[]) => void;
  retryDelayMs?: number;
  warn?: (message: string) => void;
}

export function createLiveDeferredResumeFlusher(options: CreateLiveDeferredResumeFlusherOptions): () => Promise<void> {
  let processingDeferredResumes = false;

  return async function flushLiveDeferredResumes(): Promise<void> {
    if (processingDeferredResumes) {
      return;
    }

    processingDeferredResumes = true;

    try {
      const liveSessions = getLiveSessions().filter((session) => session.sessionFile);
      const now = new Date();
      const daemonRoot = options.resolveDaemonRoot();
      let mutated = false;
      const mutatedConversationIds = new Set<string>();

      for (const session of liveSessions) {
        const activated = activateDueDeferredResumesForSessionFile({
          at: now,
          sessionFile: session.sessionFile,
        });
        if (activated.length > 0) {
          mutated = true;
          mutatedConversationIds.add(session.id);
          for (const entry of activated) {
            await markDeferredResumeConversationRunReady({
              daemonRoot,
              deferredResumeId: entry.id,
              sessionFile: entry.sessionFile,
              prompt: entry.prompt,
              dueAt: entry.dueAt,
              createdAt: entry.createdAt,
              readyAt: entry.readyAt ?? now.toISOString(),
              conversationId: session.id,
            });

            surfaceReadyDeferredResume({
              entry,
              repoRoot: options.getRepoRoot?.(),
              profile: options.getCurrentProfile(),
              stateRoot: options.getStateRoot(),
              conversationId: session.id,
            });
          }
        }

        const readyEntries = listDeferredResumesForSessionFile(session.sessionFile).filter((entry) => entry.status === 'ready');
        for (const readyEntry of readyEntries) {
          const liveEntry = liveRegistry.get(session.id);
          if (!liveEntry) {
            break;
          }

          try {
            const requestedDeferredResumeBehavior =
              readyEntry.behavior ?? (liveEntry.session.isStreaming ? ('followUp' as const) : undefined);
            const deferredResumeBehavior =
              requestedDeferredResumeBehavior === 'followUp' && !liveEntry.session.isStreaming
                ? undefined
                : requestedDeferredResumeBehavior;
            const promptDelivery = buildPromptDeliveryForDeferredResume(readyEntry);
            for (const message of promptDelivery.contextMessages) {
              await queuePromptContext(session.id, message.customType, message.content);
            }

            if (liveEntry.session.sessionFile) {
              await syncWebLiveConversationRun({
                conversationId: session.id,
                sessionFile: liveEntry.session.sessionFile,
                cwd: liveEntry.cwd,
                title: liveEntry.title,
                profile: options.getCurrentProfile(),
                state: 'running',
                pendingOperation: {
                  type: 'prompt',
                  text: promptDelivery.visiblePrompt,
                  ...(deferredResumeBehavior ? { behavior: deferredResumeBehavior } : {}),
                  ...(promptDelivery.contextMessages.length > 0 ? { contextMessages: promptDelivery.contextMessages } : {}),
                  enqueuedAt: new Date().toISOString(),
                },
              });
            }

            await promptLocalSession(session.id, promptDelivery.visiblePrompt, deferredResumeBehavior);

            const completedEntry = completeDeferredResumeForSessionFile({
              sessionFile: readyEntry.sessionFile,
              id: readyEntry.id,
            });
            if (completedEntry) {
              mutated = true;
              mutatedConversationIds.add(session.id);
              await completeDeferredResumeConversationRun({
                daemonRoot,
                deferredResumeId: completedEntry.id,
                sessionFile: completedEntry.sessionFile,
                prompt: completedEntry.prompt,
                dueAt: completedEntry.dueAt,
                createdAt: completedEntry.createdAt,
                readyAt: completedEntry.readyAt,
                completedAt: new Date().toISOString(),
                conversationId: session.id,
                cwd: liveEntry.cwd,
              });
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (liveEntry.session.sessionFile) {
              await syncWebLiveConversationRun({
                conversationId: session.id,
                sessionFile: liveEntry.session.sessionFile,
                cwd: liveEntry.cwd,
                title: liveEntry.title,
                profile: options.getCurrentProfile(),
                state: 'failed',
                lastError: message,
              });
            }

            const retryDueAt = new Date(Date.now() + (options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)).toISOString();
            const retriedEntry = retryDeferredResumeForSessionFile({
              sessionFile: readyEntry.sessionFile,
              id: readyEntry.id,
              dueAt: retryDueAt,
            });
            if (retriedEntry) {
              mutated = true;
              mutatedConversationIds.add(session.id);
              await markDeferredResumeConversationRunRetryScheduled({
                daemonRoot,
                deferredResumeId: retriedEntry.id,
                sessionFile: retriedEntry.sessionFile,
                prompt: retriedEntry.prompt,
                dueAt: retriedEntry.dueAt,
                createdAt: retriedEntry.createdAt,
                retryAt: retriedEntry.dueAt,
                conversationId: session.id,
                cwd: liveEntry.cwd,
                lastError: message,
              });
            }
            options.warn?.(`Deferred resume delivery failed for ${session.id}: ${message}`);
            break;
          }
        }
      }

      if (mutated) {
        options.publishConversationSessionMetaChanged(...mutatedConversationIds);
      }
    } finally {
      processingDeferredResumes = false;
    }
  };
}
