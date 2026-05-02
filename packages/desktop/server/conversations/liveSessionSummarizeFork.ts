import { SessionManager } from '@mariozechner/pi-coding-agent';

import { logWarn } from '../shared/logging.js';
import { resolveLastCompletedConversationEntryId } from './liveSessionForking.js';
import type { LiveSessionLoaderOptions } from './liveSessionLoader.js';

export interface LiveSessionSummarizeForkHost {
  sessionId: string;
  cwd: string;
  session: {
    sessionFile?: string | null;
    isStreaming: boolean;
  };
}

export async function summarizeAndForkLiveSession(
  entry: LiveSessionSummarizeForkHost,
  options: LiveSessionLoaderOptions,
  callbacks: {
    createSessionFromExisting: (
      sessionFile: string,
      cwd: string,
      options: LiveSessionLoaderOptions,
    ) => Promise<{ id: string; sessionFile: string }>;
    resumeSession: (sessionFile: string, options: LiveSessionLoaderOptions & { cwdOverride?: string }) => Promise<{ id: string }>;
    compactSession: (sessionId: string) => Promise<unknown>;
    appendVisibleCustomMessage: (sessionId: string, customType: string, content: string) => Promise<void>;
  },
): Promise<{ newSessionId: string; sessionFile: string }> {
  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot summarize and fork a live session without a session file.');
  }

  const duplicated = entry.session.isStreaming
    ? await duplicateStreamingSessionAtLastCompletedTurn(entry, sourceSessionFile, options, callbacks)
    : await callbacks.createSessionFromExisting(sourceSessionFile, entry.cwd, options);

  void callbacks.compactSession(duplicated.id).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logWarn('summary fork compaction failed', {
      sourceConversationId: entry.sessionId,
      conversationId: duplicated.id,
      sessionFile: duplicated.sessionFile,
      error: error instanceof Error ? { message: error.message, stack: error.stack } : message,
    });

    try {
      await callbacks.appendVisibleCustomMessage(
        duplicated.id,
        'system_notice',
        `Summarize & New could not compact this copy automatically: ${message}`,
      );
    } catch {
      // Ignore best-effort failure surfacing.
    }
  });

  return { newSessionId: duplicated.id, sessionFile: duplicated.sessionFile };
}

async function duplicateStreamingSessionAtLastCompletedTurn(
  entry: LiveSessionSummarizeForkHost,
  sourceSessionFile: string,
  options: LiveSessionLoaderOptions,
  callbacks: Pick<Parameters<typeof summarizeAndForkLiveSession>[2], 'resumeSession'>,
): Promise<{ id: string; sessionFile: string }> {
  const lastCompletedEntryId = resolveLastCompletedConversationEntryId(sourceSessionFile);
  if (!lastCompletedEntryId) {
    throw new Error('No completed conversation turn is ready to summarize and fork yet.');
  }

  const sourceManager = SessionManager.open(sourceSessionFile, undefined, entry.cwd);
  const forkedSessionFile = sourceManager.createBranchedSession(lastCompletedEntryId);
  if (!forkedSessionFile) {
    throw new Error('Unable to create a summary fork from the latest completed turn.');
  }

  const resumed = await callbacks.resumeSession(forkedSessionFile, {
    ...options,
    cwdOverride: entry.cwd,
  });
  return { id: resumed.id, sessionFile: forkedSessionFile };
}
