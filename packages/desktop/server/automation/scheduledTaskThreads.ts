import {
  type AutomationThreadMode,
  ensureAutomationThread,
  normalizeAutomationThreadModeForSelection,
  resolveAutomationThreadTitle,
  setStoredAutomationThreadBinding,
  type StoredAutomation,
} from '@personal-agent/daemon';

import { resolveConversationSessionFile } from '../conversations/conversationService.js';
import { readSessionMeta } from '../conversations/sessions.js';

export interface ScheduledTaskThreadInput {
  threadMode?: string | null;
  threadConversationId?: string | null;
  threadSessionFile?: string | null;
}

export interface ScheduledTaskThreadDetail {
  threadMode: AutomationThreadMode;
  threadConversationId?: string;
  threadTitle?: string;
}

function readOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export function resolveScheduledTaskThreadBinding(input: ScheduledTaskThreadInput & { cwd?: string | null }): {
  mode: AutomationThreadMode;
  conversationId?: string;
  sessionFile?: string;
} {
  const mode = normalizeAutomationThreadModeForSelection(input.threadMode);
  if (mode === 'none') {
    return { mode };
  }

  if (mode === 'dedicated') {
    return { mode };
  }

  const conversationId = readOptionalString(input.threadConversationId);
  if (!conversationId) {
    throw new Error('Choose an existing thread.');
  }

  const sessionFile = readOptionalString(input.threadSessionFile);
  const resolvedSessionFile = sessionFile || resolveConversationSessionFile(conversationId);
  if (!resolvedSessionFile) {
    throw new Error('Selected thread was not found.');
  }

  const sessionMeta = readSessionMeta(conversationId);
  const expectedCwd = readOptionalString(input.cwd ?? undefined);
  if (expectedCwd && sessionMeta?.cwd && sessionMeta.cwd !== expectedCwd) {
    throw new Error('Selected thread must use the same working directory as the automation.');
  }

  return {
    mode,
    conversationId,
    sessionFile: resolvedSessionFile,
  };
}

export function applyScheduledTaskThreadBinding(
  taskId: string,
  input: ScheduledTaskThreadInput & {
    cwd?: string | null;
    dbPath?: string;
  },
): StoredAutomation {
  const resolved = resolveScheduledTaskThreadBinding(input);
  const updated = setStoredAutomationThreadBinding(taskId, {
    dbPath: input.dbPath,
    mode: resolved.mode,
    conversationId: resolved.conversationId,
    sessionFile: resolved.sessionFile,
  });

  if (updated.threadMode === 'none') {
    return updated;
  }

  return ensureAutomationThread(taskId, { dbPath: input.dbPath });
}

export function buildScheduledTaskThreadDetail(task: StoredAutomation): ScheduledTaskThreadDetail {
  const title = task.threadConversationId ? readSessionMeta(task.threadConversationId)?.title : resolveAutomationThreadTitle(task);

  return {
    threadMode: task.threadMode,
    ...(task.threadConversationId ? { threadConversationId: task.threadConversationId } : {}),
    ...(title ? { threadTitle: title } : {}),
  };
}
