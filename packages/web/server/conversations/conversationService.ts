import { existsSync, statSync } from 'node:fs';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import {
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  listDeferredResumeRecords,
  listProfileActivityEntries,
  loadDeferredResumeState,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  summarizeConversationAttention,
} from '@personal-agent/core';
import { type DeferredResumeSummary } from '../automation/deferredResumes.js';
import { loadDaemonConfig, resolveDaemonPaths } from '@personal-agent/daemon';
import {
  ensureSessionFileExists,
  registry as liveSessionRegistry,
} from './liveSessions.js';
import { publishAppEvent } from '../shared/appEvents.js';
import {
  listSessions,
  readSessionBlocksWithTelemetry,
  readSessionMeta,
} from './sessions.js';
import { 
  getLiveSessions as getLocalLiveSessions,
  getAvailableModelObjects,
} from './liveSessions.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE as SETTINGS_FILE } from '../ui/settingsPersistence.js';
import {
  resolveConversationModelPreferenceState,
  readConversationModelPreferenceSnapshot,
} from './conversationModelPreferences.js';
import { readSavedModelPreferences } from '../models/modelPreferences.js';
import { type SavedUiPreferences } from '../ui/uiPreferences.js';
import { readConversationContextDocs } from './conversationContextDocs.js';

let getCurrentProfileFn: () => string = () => {
  throw new Error('getCurrentProfile not initialized for conversation service');
};

let getRepoRootFn: () => string = () => process.cwd();

export function getCurrentProfile(): string {
  return getCurrentProfileFn();
}

export function setConversationServiceContext(input: {
  getCurrentProfile: () => string;
  getRepoRoot: () => string;
  getSavedUiPreferences: () => SavedUiPreferences;
}): void {
  getCurrentProfileFn = input.getCurrentProfile;
  getRepoRootFn = input.getRepoRoot;
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function listActivityStateRoots(): Array<string | undefined> {
  try {
    return [undefined, resolveDaemonRoot()];
  } catch {
    return [undefined];
  }
}

function loadReadState(stateRoot: string | undefined, profile = getCurrentProfileFn()): Set<string> {
  return loadProfileActivityReadState({
    repoRoot: getRepoRootFn(),
    stateRoot,
    profile,
  });
}

type ActivityEntryWithConversationLinks = ReturnType<typeof listProfileActivityEntries>[number]['entry'] & {
  relatedConversationIds?: string[];
};

type ActivityRecord = {
  stateRoot?: string;
  entry: ActivityEntryWithConversationLinks;
  read: boolean;
};

function attachActivityConversationLinks(
  profile: string,
  entry: ReturnType<typeof listProfileActivityEntries>[number]['entry'],
  stateRoot?: string,
): ActivityEntryWithConversationLinks {
  const relatedConversationIds = getActivityConversationLink({
    stateRoot,
    profile,
    activityId: entry.id,
  })?.relatedConversationIds;

  if (!relatedConversationIds || relatedConversationIds.length === 0) {
    return entry;
  }

  return {
    ...entry,
    relatedConversationIds,
  };
}

function listActivityRecordsForProfile(profile = getCurrentProfileFn()): ActivityRecord[] {
  const records: ActivityRecord[] = [];

  for (const stateRoot of listActivityStateRoots()) {
    const readState = loadReadState(stateRoot, profile);
    const entries = listProfileActivityEntries({ repoRoot: getRepoRootFn(), stateRoot, profile });

    for (const { entry } of entries) {
      records.push({
        stateRoot,
        entry: attachActivityConversationLinks(profile, entry, stateRoot),
        read: readState.has(entry.id),
      });
    }
  }

  records.sort((left, right) => {
    const timestampCompare = right.entry.createdAt.localeCompare(left.entry.createdAt);
    if (timestampCompare !== 0) {
      return timestampCompare;
    }

    if (left.stateRoot !== right.stateRoot) {
      return left.stateRoot ? 1 : -1;
    }

    return right.entry.id.localeCompare(left.entry.id);
  });

  const deduped: ActivityRecord[] = [];
  const seenIds = new Set<string>();

  for (const record of records) {
    if (seenIds.has(record.entry.id)) {
      continue;
    }

    seenIds.add(record.entry.id);
    deduped.push(record);
  }

  return deduped;
}

function listUnreadConversationActivityEntries(profile = getCurrentProfileFn()) {
  return listActivityRecordsForProfile(profile)
    .filter((record) => !record.read && record.entry.relatedConversationIds && record.entry.relatedConversationIds.length > 0)
    .map((record) => ({
      id: record.entry.id,
      createdAt: record.entry.createdAt,
      relatedConversationIds: record.entry.relatedConversationIds ?? [],
    }));
}

function getSessionLastActivityAt(sessionFile: string, fallback: string): string {
  try {
    return new Date(statSync(sessionFile).mtimeMs).toISOString();
  } catch {
    return fallback;
  }
}

function toDeferredResumeSummary(record: {
  id: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  attempts: number;
  status: 'scheduled' | 'ready';
  readyAt?: string;
  kind: DeferredResumeSummary['kind'];
  title?: string;
  delivery: DeferredResumeSummary['delivery'];
}): DeferredResumeSummary {
  return {
    id: record.id,
    sessionFile: record.sessionFile,
    prompt: record.prompt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    attempts: record.attempts,
    status: record.status,
    readyAt: record.readyAt,
    kind: record.kind,
    title: record.title,
    delivery: record.delivery,
  };
}

function listDeferredResumeSummariesBySessionFile(): Map<string, DeferredResumeSummary[]> {
  const summariesBySessionFile = new Map<string, DeferredResumeSummary[]>();

  for (const record of listDeferredResumeRecords(loadDeferredResumeState())) {
    const summaries = summariesBySessionFile.get(record.sessionFile);
    const summary = toDeferredResumeSummary(record);
    if (summaries) {
      summaries.push(summary);
      continue;
    }

    summariesBySessionFile.set(record.sessionFile, [summary]);
  }

  return summariesBySessionFile;
}

type LocalLiveSession = ReturnType<typeof getLocalLiveSessions>[number] & {
  session?: {
    sessionManager: unknown;
  };
};

interface SessionDetailRouteRemoteMirrorTelemetry {
  status: 'not-remote' | 'deferred';
  durationMs: number;
}

export interface PublicLiveSessionMeta {
  id: string;
  cwd: string;
  sessionFile: string;
  title?: string;
  isStreaming: boolean;
  hasPendingHiddenTurn?: boolean;
}

export function toPublicLiveSessionMeta(session: {
  id: string;
  cwd: string;
  sessionFile: string;
  title?: string;
  isStreaming: boolean;
  hasPendingHiddenTurn?: boolean;
}): PublicLiveSessionMeta {
  return {
    id: session.id,
    cwd: session.cwd,
    sessionFile: session.sessionFile,
    ...(typeof session.title === 'string' ? { title: session.title } : {}),
    isStreaming: session.isStreaming,
    ...(typeof session.hasPendingHiddenTurn === 'boolean' ? { hasPendingHiddenTurn: session.hasPendingHiddenTurn } : {}),
  };
}

export function listAllLiveSessions(): LocalLiveSession[] {
  const local = getLocalLiveSessions();
  const localManagersById = new Map<string, unknown>(
    Array.from(liveSessionRegistry.entries()).map(([id, entry]) => [id, (entry as { session?: unknown }).session]),
  );
  return local.map((entry) => ({
    ...entry,
    session: localManagersById.get(entry.id) as { sessionManager: unknown } | undefined,
  }));
}
export function publishConversationSessionMetaChanged(...conversationIds: Array<string | null | undefined>): void {
  const seen = new Set<string>();

  for (const value of conversationIds) {
    const conversationId = typeof value === 'string' ? value.trim() : '';
    if (!conversationId || seen.has(conversationId)) {
      continue;
    }

    seen.add(conversationId);
    publishAppEvent({ type: 'session_meta_changed', sessionId: conversationId });
  }
}

export function decorateSessionsWithAttention<T extends {
  id: string;
  file: string;
  timestamp: string;
  messageCount: number;
}>(
  profile: string,
  sessions: T[],
  deferredResumesBySessionFile = listDeferredResumeSummariesBySessionFile(),
) {
  ensureConversationAttentionBaselines({
    profile,
    conversations: sessions.map((session) => ({
      conversationId: session.id,
      messageCount: session.messageCount,
    })),
  });

  const summaries = summarizeConversationAttention({
    profile,
    conversations: sessions.map((session) => ({
      conversationId: session.id,
      messageCount: session.messageCount,
      lastActivityAt: getSessionLastActivityAt(session.file, session.timestamp),
    })),
    unreadActivityEntries: listUnreadConversationActivityEntries(profile),
  });
  const summaryByConversationId = new Map(summaries.map((summary) => [summary.conversationId, summary]));

  return sessions.map((session) => {
    const summary = summaryByConversationId.get(session.id);
    const lastActivityAt = getSessionLastActivityAt(session.file, session.timestamp);

    return {
      ...session,
      lastActivityAt,
      needsAttention: summary?.needsAttention ?? false,
      attentionUpdatedAt: summary?.attentionUpdatedAt,
      attentionUnreadMessageCount: summary?.unreadMessageCount ?? 0,
      attentionUnreadActivityCount: summary?.unreadActivityCount ?? 0,
      attentionActivityIds: summary?.unreadActivityIds ?? [],
      deferredResumes: deferredResumesBySessionFile.get(session.file) ?? [],
      attachedContextDocs: readConversationContextDocs(session.id),
    };
  });
}

function buildSyntheticLiveSessionSnapshot(
  liveEntry: ReturnType<typeof listAllLiveSessions>[number],
  deferredResumesBySessionFile: ReturnType<typeof listDeferredResumeSummariesBySessionFile>,
) {
  const isRunning = liveEntry.isStreaming || Boolean(liveEntry.hasPendingHiddenTurn);
  return {
    id: liveEntry.id,
    file: liveEntry.sessionFile,
    timestamp: new Date().toISOString(),
    cwd: liveEntry.cwd,
    cwdSlug: liveEntry.cwd.replace(/\//g, '-'),
    model: '',
    title: liveEntry.title || 'New Conversation',
    messageCount: 0,
    isRunning,
    isLive: true,
    lastActivityAt: new Date().toISOString(),
    needsAttention: false,
    attentionUnreadMessageCount: 0,
    attentionUnreadActivityCount: 0,
    attentionActivityIds: [],
    deferredResumes: deferredResumesBySessionFile.get(liveEntry.sessionFile) ?? [],
    attachedContextDocs: readConversationContextDocs(liveEntry.id),
  };
}

function isLiveEntryRunning(liveEntry: ReturnType<typeof listAllLiveSessions>[number] | null | undefined): boolean {
  return Boolean(liveEntry?.isStreaming || liveEntry?.hasPendingHiddenTurn);
}

export function listConversationSessionsSnapshot() {
  const profile = getCurrentProfileFn();
  const deferredResumesBySessionFile = listDeferredResumeSummariesBySessionFile();
  const jsonl = decorateSessionsWithAttention(profile, listSessions(), deferredResumesBySessionFile);
  const live = listAllLiveSessions();
  const liveById = new Map(live.map((entry) => [entry.id, entry]));
  const jsonlIds = new Set(jsonl.map((session) => session.id));
  const syntheticLive = live
    .filter((entry) => !jsonlIds.has(entry.id))
    .map((entry) => buildSyntheticLiveSessionSnapshot(entry, deferredResumesBySessionFile));

  return [
    ...syntheticLive,
    ...jsonl.map((session) => {
      const liveEntry = liveById.get(session.id);
      const isRemoteTarget = Boolean(session.remoteHostId && session.remoteConversationId);
      return {
        ...session,
        title: liveEntry?.title || session.title,
        isRunning: isLiveEntryRunning(liveEntry),
        isLive: isRemoteTarget || Boolean(liveEntry),
      };
    }),
  ];
}

export function toggleConversationAttention(input: {
  profile: string;
  conversationId: string;
  read?: boolean;
}): boolean {
  const session = listConversationSessionsSnapshot().find((entry) => entry.id === input.conversationId);
  if (!session) {
    return false;
  }

  if (input.read === false) {
    markConversationAttentionUnread({
      profile: input.profile,
      conversationId: input.conversationId,
      messageCount: session.messageCount,
    });
  } else {
    markConversationAttentionRead({
      profile: input.profile,
      conversationId: input.conversationId,
      messageCount: session.messageCount,
    });
  }

  return true;
}

export function resolveConversationSessionFile(conversationId: string): string | undefined {
  const liveEntry = listAllLiveSessions().find((session) => session.id === conversationId);
  if (liveEntry && 'session' in liveEntry && liveEntry.session?.sessionManager) {
    ensureSessionFileExists(liveEntry.session.sessionManager as Parameters<typeof ensureSessionFileExists>[0]);
  }

  const liveSessionFile = liveEntry?.sessionFile?.trim();
  if (liveSessionFile && existsSync(liveSessionFile)) {
    return liveSessionFile;
  }

  const snapshotSessionFile = listConversationSessionsSnapshot().find((session) => session.id === conversationId)?.file?.trim();
  return snapshotSessionFile || undefined;
}

export function readConversationSessionSignature(conversationId: string): string | null {
  const sessionFile = resolveConversationSessionFile(conversationId);
  if (!sessionFile || !existsSync(sessionFile)) {
    return null;
  }

  try {
    const stats = statSync(sessionFile);
    return `${stats.size}:${stats.mtimeMs}`;
  } catch {
    return null;
  }
}

export function readConversationSessionMeta(conversationId: string) {
  const profile = getCurrentProfileFn();
  const deferredResumesBySessionFile = listDeferredResumeSummariesBySessionFile();
  const storedSession = readSessionMeta(conversationId);
  const decoratedSession = storedSession
    ? decorateSessionsWithAttention(profile, [storedSession], deferredResumesBySessionFile)[0] ?? null
    : null;
  const liveEntry = listAllLiveSessions().find((session) => session.id === conversationId) ?? null;

  if (!decoratedSession) {
    return liveEntry ? buildSyntheticLiveSessionSnapshot(liveEntry, deferredResumesBySessionFile) : null;
  }

  const isRemoteTarget = Boolean(decoratedSession.remoteHostId && decoratedSession.remoteConversationId);

  return {
    ...decoratedSession,
    title: liveEntry?.title || decoratedSession.title,
    isRunning: isLiveEntryRunning(liveEntry),
    isLive: isRemoteTarget || Boolean(liveEntry),
  };
}

type SessionDetailRouteReadResult = ReturnType<typeof readSessionBlocksWithTelemetry>;

export function parseTailBlocksQuery(rawTailBlocks: unknown): number | undefined {
  const candidate = Array.isArray(rawTailBlocks) ? rawTailBlocks[0] : rawTailBlocks;
  const parsed = typeof candidate === 'string'
    ? Number.parseInt(candidate, 10)
    : typeof candidate === 'number'
      ? candidate
      : undefined;

  return Number.isInteger(parsed) && (parsed as number) > 0
    ? parsed as number
    : undefined;
}

export async function readSessionDetailForRoute(input: {
  conversationId: string;
  profile: string;
  tailBlocks?: number;
}): Promise<{
  sessionRead: SessionDetailRouteReadResult;
  remoteMirror: SessionDetailRouteRemoteMirrorTelemetry;
}> {
  const sessionRead = readSessionBlocksWithTelemetry(
    input.conversationId,
    input.tailBlocks ? { tailBlocks: input.tailBlocks } : undefined,
  );

  return {
    sessionRead,
    remoteMirror: sessionRead.detail
      ? { status: 'deferred', durationMs: 0 }
      : { status: 'not-remote', durationMs: 0 },
  };
}

export async function readConversationModelPreferenceStateById(
  conversationId: string,
): Promise<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean } | null> {
  const sessionFile = resolveConversationSessionFile(conversationId);
  if (!sessionFile || !existsSync(sessionFile)) {
    return null;
  }

  const sessionManager = SessionManager.open(sessionFile);
  const availableModels = getAvailableModelObjects();
  return resolveConversationModelPreferenceState(
    readConversationModelPreferenceSnapshot(sessionManager),
    readSavedModelPreferences(SETTINGS_FILE, availableModels),
    availableModels,
  );
}
