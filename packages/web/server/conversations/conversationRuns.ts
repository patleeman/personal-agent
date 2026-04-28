import {
  createWebLiveConversationRunId,
  listRecoverableWebLiveConversationRuns as listRecoverableWebLiveConversationRunsLocal,
  listRecoverableWebLiveConversationRunsFromDaemon,
  pingDaemon,
  saveWebLiveConversationRunState,
  syncWebLiveConversationRunState,
  type RecoverableWebLiveConversationRun,
  type SyncWebLiveConversationRunRequestInput,
  type WebLiveConversationPendingOperation,
  type WebLiveConversationPreludeMessage,
  type WebLiveConversationPromptImage,
  type WebLiveConversationRunState,
} from '@personal-agent/daemon';

export type {
  RecoverableWebLiveConversationRun,
  WebLiveConversationPendingOperation,
  WebLiveConversationPreludeMessage,
  WebLiveConversationPromptImage,
  WebLiveConversationRunState,
};

function isDaemonUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes('enoent')
    || message.includes('econnrefused')
    || message.includes('timed out')
    || message.includes('closed without response')
    || message.includes('unknown request type');
}

export { createWebLiveConversationRunId };

function normalizeOptionalTimestamp(value: string | Date | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export async function syncWebLiveConversationRun(input: {
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  profile?: string;
  state: WebLiveConversationRunState;
  updatedAt?: string | Date;
  lastError?: string;
  pendingOperation?: WebLiveConversationPendingOperation | null;
}): Promise<{ runId: string }> {
  const updatedAt = normalizeOptionalTimestamp(input.updatedAt);
  const normalizedInput: SyncWebLiveConversationRunRequestInput = {
    conversationId: input.conversationId,
    sessionFile: input.sessionFile,
    cwd: input.cwd,
    state: input.state,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.profile !== undefined ? { profile: input.profile } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
    ...(input.pendingOperation !== undefined ? { pendingOperation: input.pendingOperation } : {}),
  };

  try {
    if (await pingDaemon()) {
      return await syncWebLiveConversationRunState(normalizedInput);
    }
  } catch (error) {
    if (!isDaemonUnavailable(error)) {
      throw error;
    }
  }

  return saveWebLiveConversationRunState(normalizedInput);
}

export async function listRecoverableWebLiveConversationRuns(): Promise<RecoverableWebLiveConversationRun[]> {
  try {
    if (await pingDaemon()) {
      const result = await listRecoverableWebLiveConversationRunsFromDaemon();
      return result.runs;
    }
  } catch (error) {
    if (!isDaemonUnavailable(error)) {
      throw error;
    }
  }

  return listRecoverableWebLiveConversationRunsLocal();
}
