import { logWarn } from '../shared/logging.js';
import type { SseEvent } from './liveSessionEvents.js';
import type { LiveSessionLoaderOptions } from './liveSessionLoader.js';

export interface PendingConversationWorkingDirectoryChange {
  cwd: string;
  continuePrompt?: string;
  loaderOptions: LiveSessionLoaderOptions;
}

export interface LiveSessionCwdChangeHost {
  sessionId: string;
  cwd: string;
  session: unknown;
}

export function requestLiveSessionWorkingDirectoryChange<TEntry extends LiveSessionCwdChangeHost>(input: {
  conversationId: string;
  cwd: string;
  continuePrompt?: string;
  loaderOptions: LiveSessionLoaderOptions;
  registry: Map<string, TEntry>;
  pendingChanges: Map<string, PendingConversationWorkingDirectoryChange>;
  resolveSessionFile: (entry: TEntry) => string | undefined;
}): {
  conversationId: string;
  cwd: string;
  queued: boolean;
  unchanged?: boolean;
} {
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId is required.');
  }

  const nextCwd = input.cwd.trim();
  if (!nextCwd) {
    throw new Error('cwd is required.');
  }

  const entry = input.registry.get(conversationId);
  if (!entry) {
    throw new Error(`Session ${conversationId} is not live.`);
  }

  if (!input.resolveSessionFile(entry)) {
    throw new Error('Conversation working directory changes require a persisted session file.');
  }

  if (nextCwd === entry.cwd) {
    input.pendingChanges.delete(conversationId);
    return {
      conversationId,
      cwd: entry.cwd,
      queued: false,
      unchanged: true,
    };
  }

  input.pendingChanges.set(conversationId, {
    cwd: nextCwd,
    continuePrompt: input.continuePrompt?.trim() || undefined,
    loaderOptions: input.loaderOptions,
  });

  return {
    conversationId,
    cwd: nextCwd,
    queued: true,
  };
}

export async function applyPendingLiveSessionWorkingDirectoryChange<TEntry extends LiveSessionCwdChangeHost>(input: {
  entry: TEntry;
  pendingChanges: Map<string, PendingConversationWorkingDirectoryChange>;
  resolveSessionFile: (entry: TEntry) => string | undefined;
  changeSessionWorkingDirectory: (entry: TEntry, sessionFile: string, cwd: string, options: LiveSessionLoaderOptions) => Promise<{ id: string; sessionFile: string }>;
  promptSession: (sessionId: string, prompt: string) => Promise<unknown>;
  broadcast: (entry: TEntry, event: SseEvent) => void;
}): Promise<void> {
  const pending = input.pendingChanges.get(input.entry.sessionId);
  if (!pending) {
    return;
  }

  input.pendingChanges.delete(input.entry.sessionId);

  const sourceSessionFile = input.resolveSessionFile(input.entry);
  if (!sourceSessionFile) {
    input.broadcast(input.entry, {
      type: 'error',
      message: 'Could not change the working directory because the session file is unavailable.',
    });
    return;
  }

  try {
    const result = await input.changeSessionWorkingDirectory(input.entry, sourceSessionFile, pending.cwd, pending.loaderOptions);
    const autoContinued = Boolean(pending.continuePrompt);

    input.broadcast(input.entry, {
      type: 'cwd_changed',
      newConversationId: result.id,
      cwd: pending.cwd,
      autoContinued,
    });

    if (pending.continuePrompt) {
      void input.promptSession(result.id, pending.continuePrompt).catch((error) => {
        logWarn('failed to continue conversation after working directory change', {
          conversationId: result.id,
          cwd: pending.cwd,
          error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        });
      });
    }
  } catch (error) {
    input.broadcast(input.entry, {
      type: 'error',
      message: `Could not change the working directory: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}
