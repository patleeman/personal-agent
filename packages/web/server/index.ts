import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { ensureAutomationThread } from '@personal-agent/daemon';
import { listSessions, readSessionBlock, readSessionBlocks, readSessionBlocksWithTelemetry, readSessionImageAsset, readSessionMeta, readSessionSearchText, renameStoredSession } from './conversations/sessions.js';
import { invalidateAppTopics, publishAppEvent } from './shared/appEvents.js';

import { resolveConversationCwd, resolveRequestedCwd } from './conversations/conversationCwd.js';
import { pickFolder } from './workspace/folderPicker.js';
import { readGitStatusSummaryWithTelemetry, type GitStatusReadTelemetry } from './workspace/gitStatus.js';
import {
  installDaemonServiceAndReadState,
  readDaemonState,
  restartDaemonServiceAndReadState,
  startDaemonServiceAndReadState,
  stopDaemonServiceAndReadState,
  uninstallDaemonServiceAndReadState,
} from './automation/daemon.js';
import { readWebUiConfig } from './ui/webUi.js';
import { buildContentDispositionHeader } from './shared/httpHeaders.js';
import { readSavedDefaultCwdPreferences, writeSavedDefaultCwdPreference } from './ui/defaultCwdPreferences.js';
import { readSavedModelPreferences, writeSavedModelPreferences } from './models/modelPreferences.js';

import {
  readModelProvidersState,
  removeModelProvider,
  removeModelProviderModel,
  upsertModelProvider,
  upsertModelProviderModel,
} from './models/modelProviders.js';
import {
  cancelProviderOAuthLogin,
  getProviderOAuthLoginState,
  readProviderAuthState,
  removeProviderCredential,
  setProviderApiKey,
  startProviderOAuthLogin,
  submitProviderOAuthLoginInput,
  subscribeProviderOAuthLogin,
} from './models/providerAuth.js';
import {
  applyConversationModelPreferencesToSessionManager,
  readConversationModelPreferenceSnapshot,
  resolveConversationModelPreferenceState,
} from './conversations/conversationModelPreferences.js';

import { logError, logWarn, installProcessLogging } from './middleware/index.js';
import {
  listMemoryDocs,
  listSkillsForProfile,
  type MemoryDocItem,
  warmMemoryBrowserCaches,
} from './knowledge/memoryDocs.js';
import { registerServerRoutes } from './routes/index.js';
import {
  createServerApps,
  mountStaticServerApps,
  startBootstrapMonitors,
  startConversationRecovery,
  startDeferredResumeLoop,
  startServerListeners,
} from './app/bootstrap.js';
import { createProfileState } from './app/profileState.js';
import { createServerRouteContext } from './app/routeContext.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from './ui/webUiPreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE, persistSettingsWrite } from './ui/settingsPersistence.js';
import {
  getProfileConfigFilePath,
} from './ui/profilePreferences.js';
import { syncDaemonTaskScopeToProfile } from './automation/daemonProfileSync.js';
import {
  getScheduledTaskStateFilePath,
  loadScheduledTasksForProfile,
} from './automation/scheduledTasks.js';
import { buildScheduledTaskThreadDetail } from './automation/scheduledTaskThreads.js';
import {
  createSession as createLocalSession,
  createSessionFromExisting,
  resumeSession as resumeLocalSession,
  ensureSessionFileExists,
  getLiveSessions as getLocalLiveSessions,
  getSessionStats,
  getSessionContextUsage,
  getAvailableModels,
  inspectAvailableTools,
  isLive as isLocalLive,
  subscribe as subscribeLocal,
  promptSession as promptLocalSession,
  submitPromptSession as submitLocalPromptSession,
  restoreQueuedMessage,
  queuePromptContext,
  canInjectResumeFallbackPrompt,
  appendVisibleCustomMessage,
  compactSession,
  reloadSessionResources,
  refreshAllLiveSessionModelRegistries,
  reloadAllLiveSessionAuth,
  exportSessionHtml,
  renameSession,
  abortSession as abortLocalSession,
  destroySession,
  branchSession,
  forkSession,
  LiveSessionControlError,
  ensureSessionSurfaceCanControl,
  takeOverSessionControl,
  registry as liveRegistry,
} from './conversations/liveSessions.js';
import {
  getAvailableModelObjects,
  updateLiveSessionModelPreferences,
} from './conversations/liveSessions.js';
import { createWebLiveConversationRunId } from './conversations/conversationRuns.js';
import { createLiveDeferredResumeFlusher } from './conversations/liveDeferredResumes.js';
import { cancelDurableRun, clearDurableRunsListCache, getDurableRun, getDurableRunLog, getDurableRunSnapshot, listDurableRuns, listDurableRunsWithTelemetry, type DurableRunsListTelemetry } from './automation/durableRuns.js';
import { getDurableRunAttentionSignature } from './automation/durableRunAttention.js';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedProfilesContext,
  buildReferencedSkillsContext,
  buildReferencedTasksContext,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
} from './knowledge/promptReferences.js';
import {
  deleteConversationArtifact,
  deleteConversationAttachment,
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  getConversationArtifact,
  getConversationAttachment,
  getSyncRoot,
  getProfilesRoot,
  getLocalProfileDir,
  getStateRoot,
  hydrateProcessEnvFromShell,
  createMemoryDoc,
  loadMemoryPackageReferences,
  listConversationArtifacts,
  listConversationAttachments,
  inspectMcpServer,
  inspectMcpTool,
  listDeferredResumeRecords,
  listProfileActivityEntries,
  loadDeferredResumeState,
  loadProfileActivityReadState,
  markConversationAttentionUnread,
  markDurableRunAttentionRead,
  markDurableRunAttentionUnread,
  getMemoryDocsDir,
  getDurableSessionsDir,
  getPiAgentRuntimeDir,
  migrateLegacyProfileMemoryDirs,
  readConversationAttachmentDownload,
  readMcpConfig,
  resolveConversationAttachmentPromptFiles,
  saveConversationAttachment,
  summarizeConversationAttention,
  startKnowledgeBaseSyncLoop,
} from '@personal-agent/core';
import {
  installPackageSource,
  readPackageSourceTargetState,
} from '@personal-agent/core';
import {
  listPendingBackgroundRunResults,
  loadDaemonConfig,
  markBackgroundRunResultsDelivered,
  parsePendingOperation,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
  type BackgroundRunResultSummary,
} from '@personal-agent/daemon';
import {
  acknowledgeAlertForProfile,
  dismissAlertForProfile,
  getAlertForProfile,
  getAlertSnapshotForProfile,
  snoozeAlertForProfile,
} from './automation/alerts.js';
import {
  cancelDeferredResumeForSessionFile,
  fireDeferredResumeNowForSessionFile,
  scheduleDeferredResumeForSessionFile,
  type DeferredResumeSummary,
} from './automation/deferredResumes.js';

hydrateProcessEnvFromShell();
startKnowledgeBaseSyncLoop();

const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const LOOPBACK_HOST = '127.0.0.1';
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? DEFAULT_REPO_ROOT;
const PROCESS_CWD = process.cwd();
const AGENT_DIR = getPiAgentRuntimeDir();
const AUTH_FILE = join(AGENT_DIR, 'auth.json');
const SESSIONS_DIR = getDurableSessionsDir();
const TASK_STATE_FILE = getScheduledTaskStateFilePath();
const PROFILE_CONFIG_FILE = getProfileConfigFilePath();
const DEFERRED_RESUME_POLL_MS = 3_000;
const DEFERRED_RESUME_RETRY_DELAY_MS = 30_000;

function listAllLiveSessions() {
  return getLocalLiveSessions();
}

function publishConversationSessionMetaChanged(...conversationIds: Array<string | null | undefined>): void {
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

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

export function getDefaultWebCwd(): string {
  return readSavedDefaultCwdPreferences(SETTINGS_FILE, PROCESS_CWD).effectiveCwd;
}

installProcessLogging();

async function syncDaemonTaskScopeForProfile(profile: string): Promise<void> {
  try {
    const result = await syncDaemonTaskScopeToProfile({
      profile,
      repoRoot: REPO_ROOT,
    });

  } catch (error) {
    logWarn('failed to sync daemon task scope', {
      profile,
      message: (error as Error).message,
    });
  }
}

const profileState = createProfileState({
  repoRoot: REPO_ROOT,
  agentDir: AGENT_DIR,
  profileConfigFile: PROFILE_CONFIG_FILE,
  logger: {
    warn: (message, fields) => logWarn(message, fields),
  },
  onProfileChanged: syncDaemonTaskScopeForProfile,
});

const {
  getCurrentProfile,
  setCurrentProfile,
  listAvailableProfiles,
  materializeWebProfile,
  getCurrentProfileSettingsFile,
  buildLiveSessionExtensionFactories,
  buildLiveSessionResourceOptions,
  withTemporaryProfileAgentDir,
} = profileState;

void syncDaemonTaskScopeForProfile(getCurrentProfile());

const SETTINGS_FILE = DEFAULT_RUNTIME_SETTINGS_FILE;

type ActivityEntryWithConversationLinks = ReturnType<typeof listProfileActivityEntries>[number]['entry'] & {
  relatedConversationIds?: string[];
};

type ActivityRecord = {
  stateRoot?: string;
  entry: ActivityEntryWithConversationLinks;
  read: boolean;
};

function listActivityStateRoots(): Array<string | undefined> {
  try {
    return [undefined, resolveDaemonRoot()];
  } catch {
    return [undefined];
  }
}

function loadActivityReadState(stateRoot: string | undefined, profile = getCurrentProfile()): Set<string> {
  return loadProfileActivityReadState({ repoRoot: REPO_ROOT, stateRoot, profile });
}

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

function listActivityRecordsForProfile(profile = getCurrentProfile()): ActivityRecord[] {
  const records: ActivityRecord[] = [];

  for (const stateRoot of listActivityStateRoots()) {
    const readState = loadActivityReadState(stateRoot, profile);
    const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, stateRoot, profile });

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

function listTasksForCurrentProfile() {
  const loaded = loadScheduledTasksForProfile(getCurrentProfile());
  const runtimeById = new Map(
    loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
  );

  return loaded.tasks.map((task) => {
    const taskWithThread = task.threadMode === 'dedicated' && !task.threadConversationId
      ? ensureAutomationThread(task.id)
      : task;
    const runtime = loaded.runtimeState[task.id] ?? runtimeById.get(task.id);
    const threadDetail = buildScheduledTaskThreadDetail(taskWithThread);
    return {
      id: taskWithThread.id,
      title: taskWithThread.title,
      filePath: taskWithThread.legacyFilePath,
      scheduleType: taskWithThread.schedule.type,
      running: runtime?.running ?? false,
      enabled: taskWithThread.enabled,
      cron: taskWithThread.schedule.type === 'cron' ? taskWithThread.schedule.expression : undefined,
      at: taskWithThread.schedule.type === 'at' ? taskWithThread.schedule.at : undefined,
      prompt: taskWithThread.prompt.split('\n')[0]?.slice(0, 120) ?? '',
      model: taskWithThread.modelRef,
      cwd: taskWithThread.cwd,
      threadConversationId: threadDetail.threadConversationId,
      threadTitle: threadDetail.threadTitle,
      lastStatus: runtime?.lastStatus,
      lastRunAt: runtime?.lastRunAt,
      lastSuccessAt: runtime?.lastSuccessAt,
      lastAttemptCount: runtime?.lastAttemptCount,
    };
  });
}

function readRequiredTaskId(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error('taskId is required.');
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(normalized)) {
    throw new Error('taskId must use only letters, numbers, hyphens, or underscores.');
  }

  return normalized;
}

function getSessionLastActivityAt(sessionFile: string, fallback: string): string {
  try {
    return new Date(statSync(sessionFile).mtimeMs).toISOString();
  } catch {
    return fallback;
  }
}

function listUnreadConversationActivityEntries(profile = getCurrentProfile()) {
  return listActivityRecordsForProfile(profile)
    .filter((record) => !record.read && record.entry.relatedConversationIds && record.entry.relatedConversationIds.length > 0)
    .map((record) => ({
      id: record.entry.id,
      createdAt: record.entry.createdAt,
      relatedConversationIds: record.entry.relatedConversationIds ?? [],
    }));
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

function buildBackgroundRunHiddenContext(entries: BackgroundRunResultSummary[]): string {
  if (entries.length === 0) {
    return '';
  }

  const lines = [
    'Background run completions became available since the previous explicit user turn.',
    'Use this as hidden context only. Do not treat it as a standalone follow-up instruction.',
    'If the only sensible next step is to wait and inspect again later, add a conversation_queue item with trigger "delay" or "at" yourself instead of asking the user to remind you.',
  ];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    lines.push(
      '',
      entries.length === 1 ? 'Completion:' : `Completion ${index + 1}:`,
      entry.prompt,
    );
  }

  return lines.join('\n');
}

function decorateSessionsWithAttention<T extends {
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
    };
  });
}

function buildSyntheticLiveSessionSnapshot(
  liveEntry: ReturnType<typeof listAllLiveSessions>[number],
  deferredResumesBySessionFile: ReturnType<typeof listDeferredResumeSummariesBySessionFile>,
) {
  return {
    id: liveEntry.id,
    file: liveEntry.sessionFile,
    timestamp: new Date().toISOString(),
    cwd: liveEntry.cwd,
    cwdSlug: liveEntry.cwd.replace(/\//g, '-'),
    model: '',
    title: liveEntry.title || 'New Conversation',
    messageCount: 0,
    isRunning: liveEntry.isStreaming,
    isLive: true,
    lastActivityAt: new Date().toISOString(),
    needsAttention: false,
    attentionUnreadMessageCount: 0,
    attentionUnreadActivityCount: 0,
    attentionActivityIds: [],
    deferredResumes: deferredResumesBySessionFile.get(liveEntry.sessionFile) ?? [],
  };
}

function readConversationSessionMeta(conversationId: string) {
  const profile = getCurrentProfile();
  const deferredResumesBySessionFile = listDeferredResumeSummariesBySessionFile();
  const storedSession = readSessionMeta(conversationId);
  const decoratedSession = storedSession
    ? decorateSessionsWithAttention(profile, [storedSession], deferredResumesBySessionFile)[0] ?? null
    : null;
  const liveEntry = listAllLiveSessions().find((session) => session.id === conversationId) ?? null;

  if (!decoratedSession) {
    return liveEntry ? buildSyntheticLiveSessionSnapshot(liveEntry, deferredResumesBySessionFile) : null;
  }

  return {
    ...decoratedSession,
    title: liveEntry?.title || decoratedSession.title,
    isRunning: Boolean(liveEntry?.isStreaming),
    isLive: Boolean(liveEntry),
  };
}

function listConversationSessionsSnapshot() {
  const profile = getCurrentProfile();
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
      return {
        ...session,
        title: liveEntry?.title || session.title,
        isRunning: Boolean(liveEntry?.isStreaming),
        isLive: Boolean(liveEntry),
      };
    }),
  ];
}

type SessionDetailRouteRemoteMirrorTelemetry = { status: 'not-remote' | 'deferred'; durationMs: 0 };
type SessionDetailRouteReadResult = ReturnType<typeof readSessionBlocksWithTelemetry>;

function parseTailBlocksQuery(rawTailBlocks: unknown): number | undefined {
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

function buildNoRemoteConversationMirrorTelemetry(): SessionDetailRouteRemoteMirrorTelemetry {
  return { status: 'not-remote', durationMs: 0 };
}

function invalidateSessionsAfterRemoteMirrorSync(
  _conversationId: string,
  _remoteMirror: SessionDetailRouteRemoteMirrorTelemetry,
): void {
}

async function readSessionDetailForRoute(input: {
  conversationId: string;
  profile: string;
  tailBlocks?: number;
}): Promise<{
  sessionRead: SessionDetailRouteReadResult;
  remoteMirror: SessionDetailRouteRemoteMirrorTelemetry;
}> {
  void input.profile;
  const sessionRead = readSessionBlocksWithTelemetry(
    input.conversationId,
    input.tailBlocks ? { tailBlocks: input.tailBlocks } : undefined,
  );

  return {
    sessionRead,
    remoteMirror: sessionRead.detail
      ? { status: 'deferred', durationMs: 0 }
      : buildNoRemoteConversationMirrorTelemetry(),
  };
}

function resolveConversationSessionFile(conversationId: string): string | undefined {
  const liveEntry = liveRegistry.get(conversationId);
  if (liveEntry) {
    ensureSessionFileExists(liveEntry.session.sessionManager);
  }

  const liveSessionFile = liveEntry?.session.sessionFile?.trim();
  if (liveSessionFile && existsSync(liveSessionFile)) {
    return liveSessionFile;
  }

  const snapshotSessionFile = listConversationSessionsSnapshot().find((session) => session.id === conversationId)?.file?.trim();
  return snapshotSessionFile || undefined;
}

async function readConversationModelPreferenceStateById(conversationId: string): Promise<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean } | null> {
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

interface BackgroundConversationPromptTarget {
  conversationId: string;
  sessionFile: string;
  cwd: string;
  title?: string;
  isStreaming: boolean;
  remote: boolean;
}

async function resolveBackgroundConversationPromptTarget(
  conversationId: string,
  sessionFile: string,
): Promise<BackgroundConversationPromptTarget> {
  const localEntry = liveRegistry.get(conversationId);
  if (localEntry?.session.sessionFile) {
    return {
      conversationId,
      sessionFile: localEntry.session.sessionFile,
      cwd: localEntry.cwd,
      title: localEntry.title,
      isStreaming: localEntry.session.isStreaming,
      remote: false,
    };
  }

  const resumed = await resumeLocalSession(sessionFile, {
    ...buildLiveSessionResourceOptions(),
    extensionFactories: buildLiveSessionExtensionFactories(),
  });
  const resumedEntry = liveRegistry.get(resumed.id);
  if (!resumedEntry?.session.sessionFile) {
    throw new Error(`Could not resume local conversation ${conversationId}.`);
  }

  return {
    conversationId: resumed.id,
    sessionFile: resumedEntry.session.sessionFile,
    cwd: resumedEntry.cwd,
    title: resumedEntry.title,
    isStreaming: resumedEntry.session.isStreaming,
    remote: false,
  };
}

const flushLiveDeferredResumes = createLiveDeferredResumeFlusher({
  getCurrentProfile,
  getRepoRoot: () => REPO_ROOT,
  getStateRoot,
  resolveDaemonRoot,
  publishConversationSessionMetaChanged,
  retryDelayMs: DEFERRED_RESUME_RETRY_DELAY_MS,
  warn: (message) => logWarn(message),
});

startDeferredResumeLoop({
  flushLiveDeferredResumes,
  pollMs: DEFERRED_RESUME_POLL_MS,
});
startConversationRecovery({
  flushLiveDeferredResumes,
  buildLiveSessionResourceOptions: () => buildLiveSessionResourceOptions(),
  buildLiveSessionExtensionFactories,
  isLive: isLocalLive,
  resumeSession: resumeLocalSession,
  queuePromptContext,
  promptSession: promptLocalSession,
});
const DIST_DIR =
  process.env.PA_WEB_DIST ??
  join(dirname(fileURLToPath(import.meta.url)), '../dist');

const { app } = createServerApps();

startBootstrapMonitors({
  repoRoot: REPO_ROOT,
  sessionsDir: SESSIONS_DIR,
  taskStateFile: TASK_STATE_FILE,
  profileConfigFile: PROFILE_CONFIG_FILE,
  getCurrentProfile,
  daemonRoot: resolveDaemonRoot(),
  readDaemonState,
});

const routeContext = createServerRouteContext({
  repoRoot: REPO_ROOT,
  settingsFile: SETTINGS_FILE,
  authFile: AUTH_FILE,
  getCurrentProfile,
  setCurrentProfile,
  listAvailableProfiles,
  getCurrentProfileSettingsFile,
  materializeWebProfile,
  getStateRoot,
  serverPort: PORT,
  getDefaultWebCwd,
  resolveRequestedCwd,
  buildLiveSessionResourceOptions,
  buildLiveSessionExtensionFactories,
  flushLiveDeferredResumes,
  getSavedWebUiPreferences: () => readSavedWebUiPreferences(SETTINGS_FILE),
  listTasksForCurrentProfile,
  listMemoryDocs: () => listMemoryDocs(),
  listSkillsForCurrentProfile: () => listSkillsForProfile(getCurrentProfile()),
  listProfileAgentItems: () => [],
  withTemporaryProfileAgentDir,
  getDurableRunSnapshot: async (runId: string, tail: number) => (await getDurableRunSnapshot(runId, tail)) ?? null,
});

registerServerRoutes({
  app,
  context: routeContext,
});

mountStaticServerApps({
  app,
  distDir: DIST_DIR,
});

warmMemoryBrowserCaches(getCurrentProfile());

startServerListeners({
  app,
  port: PORT,
  loopbackHost: LOOPBACK_HOST,
  getCurrentProfile,
  getDefaultWebCwd,
  repoRoot: REPO_ROOT,
  distDir: DIST_DIR,
});
