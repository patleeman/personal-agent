import {
  createWebLiveConversationRunId,
  listRecoverableWebLiveConversationRuns as listRecoverableWebLiveConversationRunsLocal,
  listRecoverableWebLiveConversationRunsFromDaemon,
  pingDaemon,
  type RecoverableWebLiveConversationRun,
  saveWebLiveConversationRunState,
  type SyncWebLiveConversationRunRequestInput,
  syncWebLiveConversationRunState,
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
  return (
    message.includes('enoent') ||
    message.includes('econnrefused') ||
    message.includes('timed out') ||
    message.includes('closed without response') ||
    message.includes('unknown request type')
  );
}

function isRecoverableRunPersistenceError(error: unknown): boolean {
  if (isDaemonUnavailable(error)) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes('database disk image is malformed') ||
    message.includes('database corruption') ||
    message.includes('database is corrupt')
  );
}

export { createWebLiveConversationRunId };

function normalizeOptionalTimestamp(value: string | Date | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === 'string' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return undefined;
  }

  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  const normalized = new Date(parsed).toISOString();
  return typeof value === 'string' && normalized !== value ? undefined : normalized;
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
    if (!isRecoverableRunPersistenceError(error)) {
      throw error;
    }
  }

  try {
    return await saveWebLiveConversationRunState(normalizedInput);
  } catch (error) {
    if (!isRecoverableRunPersistenceError(error)) {
      throw error;
    }

    // Recovery bookkeeping should not block the live conversation path. If the
    // daemon run database is corrupt, keep the prompt flowing and let the user
    // repair/reset the run store separately.
    return { runId: createWebLiveConversationRunId(input.conversationId) };
  }
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
