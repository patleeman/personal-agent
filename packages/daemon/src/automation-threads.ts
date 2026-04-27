import { existsSync } from 'node:fs';
import { getDurableSessionsDir, listStoredSessions, resolveNeutralChatCwd } from '@personal-agent/core';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import {
  getStoredAutomation,
  setStoredAutomationThreadBinding,
  type AutomationThreadMode,
  type StoredAutomation,
} from './automation-store.js';

function readOptionalString(value: string | undefined | null): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

interface PersistableSessionManager {
  _rewriteFile?: () => void;
  flushed?: boolean;
}

function persistSessionFile(manager: SessionManager): void {
  const persistable = manager as unknown as PersistableSessionManager;
  persistable._rewriteFile?.();
  persistable.flushed = true;
}

function desiredAutomationThreadTitle(task: Pick<StoredAutomation, 'title' | 'id'>): string {
  const title = task.title.trim() || task.id;
  return `Automation: ${title}`;
}

function resolveStoredSessionsRoot(stateRoot?: string): string {
  return getDurableSessionsDir(stateRoot);
}

function resolveExistingSessionFile(input: {
  stateRoot?: string;
  conversationId?: string;
  sessionFile?: string;
}): { sessionFile?: string; conversationId?: string } {
  const directSessionFile = readOptionalString(input.sessionFile);
  if (directSessionFile && existsSync(directSessionFile)) {
    const manager = SessionManager.open(directSessionFile);
    return {
      sessionFile: directSessionFile,
      conversationId: manager.getSessionId(),
    };
  }

  const conversationId = readOptionalString(input.conversationId);
  if (!conversationId) {
    return {};
  }

  const match = listStoredSessions({ sessionsDir: resolveStoredSessionsRoot(input.stateRoot) })
    .find((session) => session.id === conversationId);
  if (!match) {
    return {
      conversationId,
    };
  }

  return {
    sessionFile: match.file,
    conversationId: match.id,
  };
}

function ensureDedicatedThread(task: StoredAutomation, options: { dbPath?: string; stateRoot?: string }): StoredAutomation {
  const expectedSessionFile = readOptionalString(task.threadSessionFile);
  const expectedConversationId = readOptionalString(task.threadConversationId);
  const desiredCwd = task.cwd ?? resolveNeutralChatCwd(task.profile, options.stateRoot);
  const desiredTitle = desiredAutomationThreadTitle(task);

  if (expectedSessionFile && existsSync(expectedSessionFile)) {
    const manager = SessionManager.open(expectedSessionFile);
    const currentConversationId = manager.getSessionId();
    const currentCwd = manager.getCwd();
    const currentTitle = manager.getSessionName();

    if (currentCwd === desiredCwd) {
      if (currentTitle !== desiredTitle) {
        manager.appendSessionInfo(desiredTitle);
        persistSessionFile(manager);
      }

      if (currentConversationId !== expectedConversationId) {
        return setStoredAutomationThreadBinding(task.id, {
          dbPath: options.dbPath,
          mode: 'dedicated',
          conversationId: currentConversationId,
          sessionFile: expectedSessionFile,
        });
      }

      return task;
    }
  }

  const manager = SessionManager.create(desiredCwd, resolveStoredSessionsRoot(options.stateRoot));
  manager.appendSessionInfo(desiredTitle);
  persistSessionFile(manager);
  const sessionFile = manager.getSessionFile();
  if (!sessionFile) {
    throw new Error(`Could not create a dedicated thread for automation @${task.id}.`);
  }

  return setStoredAutomationThreadBinding(task.id, {
    dbPath: options.dbPath,
    mode: 'dedicated',
    conversationId: manager.getSessionId(),
    sessionFile,
  });
}

function ensureExistingThread(task: StoredAutomation, options: { dbPath?: string; stateRoot?: string }): StoredAutomation {
  const resolved = resolveExistingSessionFile({
    stateRoot: options.stateRoot,
    conversationId: task.threadConversationId,
    sessionFile: task.threadSessionFile,
  });

  if (!resolved.sessionFile || !resolved.conversationId) {
    throw new Error(`Automation @${task.id} is bound to a missing thread.`);
  }

  if (resolved.sessionFile !== task.threadSessionFile || resolved.conversationId !== task.threadConversationId) {
    return setStoredAutomationThreadBinding(task.id, {
      dbPath: options.dbPath,
      mode: 'existing',
      conversationId: resolved.conversationId,
      sessionFile: resolved.sessionFile,
    });
  }

  return task;
}

export function ensureAutomationThread(taskId: string, options: { dbPath?: string; stateRoot?: string } = {}): StoredAutomation {
  const task = getStoredAutomation(taskId, { dbPath: options.dbPath });
  if (!task) {
    throw new Error(`Automation not found: ${taskId}`);
  }

  switch (task.threadMode) {
    case 'none':
      return task;
    case 'existing':
      return ensureExistingThread(task, options);
    case 'dedicated':
    default:
      return ensureDedicatedThread(task, options);
  }
}

export function resolveAutomationThreadTitle(task: Pick<StoredAutomation, 'title' | 'id' | 'threadMode'>): string | undefined {
  if (task.threadMode === 'none') {
    return undefined;
  }

  return desiredAutomationThreadTitle(task);
}

export function normalizeAutomationThreadModeForSelection(value: string | null | undefined): AutomationThreadMode {
  if (value === 'none' || value === 'existing' || value === 'dedicated') {
    return value;
  }

  return 'dedicated';
}
