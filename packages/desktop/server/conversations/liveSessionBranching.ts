import { type AgentSession, SessionManager } from '@earendil-works/pi-coding-agent';

import type { LiveSessionLoaderOptions } from './liveSessionLoader.js';

export interface LiveSessionBranchHost {
  sessionId: string;
  cwd: string;
  session: AgentSession;
}

export interface LiveSessionBranchCallbacks {
  createSession: (cwd: string, options: LiveSessionLoaderOptions) => Promise<{ id: string; sessionFile: string }>;
  resumeSession: (sessionFile: string, options: LiveSessionLoaderOptions & { cwdOverride?: string }) => Promise<{ id: string }>;
  destroySession: (sessionId: string) => void;
  resolveDefaultServiceTier: (entry: LiveSessionBranchHost) => LiveSessionLoaderOptions['initialServiceTier'];
}

export async function branchLiveSession(
  entry: LiveSessionBranchHost,
  entryId: string,
  options: LiveSessionLoaderOptions,
  callbacks: Pick<LiveSessionBranchCallbacks, 'resumeSession'>,
): Promise<{ newSessionId: string; sessionFile: string }> {
  // Safe while streaming: Pi only persists completed messages on message_end, so the
  // session file is already a stable snapshot of the conversation before the active turn.
  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot branch a live session without a session file.');
  }

  const sourceManager = SessionManager.open(sourceSessionFile, undefined, entry.cwd);
  if (!sourceManager.getEntry(entryId)) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  const branchedSessionFile = sourceManager.createBranchedSession(entryId);
  if (!branchedSessionFile) {
    throw new Error('Unable to create a branched session file.');
  }

  const resumed = await callbacks.resumeSession(branchedSessionFile, {
    ...options,
    cwdOverride: entry.cwd,
  });
  return { newSessionId: resumed.id, sessionFile: branchedSessionFile };
}

export async function forkLiveSession(
  entry: LiveSessionBranchHost,
  entryId: string,
  options: LiveSessionLoaderOptions & { preserveSource?: boolean; beforeEntry?: boolean },
  callbacks: LiveSessionBranchCallbacks,
): Promise<{ newSessionId: string; sessionFile: string }> {
  const { preserveSource, beforeEntry, ...loaderOptions } = options;

  if (entry.session.isStreaming && !preserveSource) {
    throw new Error('Cannot replace a running conversation while forking. Keep the source conversation open instead.');
  }

  // Safe while streaming: Pi only persists completed messages on message_end, so the
  // session file is already a stable snapshot of the conversation before the active turn.
  const sourceSessionFile = entry.session.sessionFile;
  if (!sourceSessionFile) {
    throw new Error('Cannot fork a live session without a session file.');
  }

  const sourceManager = SessionManager.open(sourceSessionFile, undefined, entry.cwd);
  const sourceEntry = sourceManager.getEntry(entryId);
  if (!sourceEntry) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  if (beforeEntry && !sourceEntry.parentId) {
    const created = await callbacks.createSession(entry.cwd, {
      ...loaderOptions,
      initialModel: loaderOptions.initialModel === undefined ? (entry.session.model?.id ?? null) : loaderOptions.initialModel,
      initialThinkingLevel:
        loaderOptions.initialThinkingLevel === undefined ? (entry.session.thinkingLevel ?? null) : loaderOptions.initialThinkingLevel,
      initialServiceTier:
        loaderOptions.initialServiceTier === undefined ? callbacks.resolveDefaultServiceTier(entry) : loaderOptions.initialServiceTier,
    });

    if (!preserveSource) {
      callbacks.destroySession(entry.sessionId);
    }

    return { newSessionId: created.id, sessionFile: created.sessionFile };
  }

  const targetEntryId = beforeEntry ? sourceEntry.parentId : entryId;
  if (!targetEntryId) {
    throw new Error(`Session entry not found: ${entryId}`);
  }

  const forkedSessionFile = sourceManager.createBranchedSession(targetEntryId);
  if (!forkedSessionFile) {
    throw new Error('Unable to create a forked session file.');
  }

  const resumed = await callbacks.resumeSession(forkedSessionFile, {
    ...loaderOptions,
    cwdOverride: entry.cwd,
  });

  if (!preserveSource) {
    callbacks.destroySession(entry.sessionId);
  }

  return { newSessionId: resumed.id, sessionFile: forkedSessionFile };
}
