import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { listSessions, readSessionBlock, readSessionBlocks, readSessionBlocksWithTelemetry, readSessionImageAsset, readSessionMeta, readSessionSearchText, readSessionTree, renameStoredSession } from './conversations/sessions.js';
import { invalidateAppTopics, publishAppEvent } from './shared/appEvents.js';

import { resolveConversationCwd, resolveRequestedCwd } from './conversations/conversationCwd.js';
import { pickFolder } from './workspace/folderPicker.js';
import { readGitStatusSummaryWithTelemetry, type GitStatusReadTelemetry } from './workspace/gitStatus.js';
import {
  commitWorkspaceGitChanges,
  readWorkspaceFile,
  readWorkspaceGitDiff,
  readWorkspaceGitDraftSource,
  readWorkspaceGitStatus,
  readWorkspacePreviewAsset,
  readWorkspaceSnapshot,
  retainWorkspaceWatch,
  stageAllWorkspaceGitChanges,
  stageWorkspaceGitPath,
  unstageAllWorkspaceGitChanges,
  unstageWorkspaceGitPath,
  writeWorkspaceFile,
} from './workspace/workspaceBrowser.js';
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
import { readCodexPlanUsage } from './models/codexUsage.js';
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
import { draftWorkspaceCommitMessage } from './workspace/workspaceCommitDraft.js';
import {
  getProfileConfigFilePath,
} from './ui/profilePreferences.js';
import { syncDaemonTaskScopeToProfile } from './automation/daemonProfileSync.js';
import {
  buildScheduledTaskMarkdown,
  getScheduledTaskStateFilePath,
  loadScheduledTasksForProfile,
  readScheduledTaskFileMetadata,
  taskDirForProfile,
  validateScheduledTaskDefinition,
  type TaskRuntimeEntry,
} from './automation/scheduledTasks.js';
import {
  writeConversationMemoryDistillFailureActivity,
} from './conversations/conversationMemoryActivity.js';
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
import {
  abortRemoteLiveSession,
  browseRemoteTargetDirectory,
  clearRemoteConversationBindingForConversation,
  createLocalMirrorSession,
  createRemoteLiveSession,
  forkLocalMirrorSession,
  getRemoteConversationConnectionState,
  getRemoteLiveSessionMeta,
  isRemoteLiveSession,
  listRemoteLiveSessions,
  submitRemoteLiveSessionPrompt,
  readRemoteConversationBindingForConversation,
  resumeRemoteLiveSession,
  stopRemoteLiveSession,
  subscribeRemoteConversationConnection,
  subscribeRemoteLiveSession,
  syncRemoteConversationMirror,
  type RemoteConversationMirrorSyncTelemetry,
} from './conversations/remoteLiveSessions.js';
import { createWebLiveConversationRunId, syncWebLiveConversationRun } from './conversations/conversationRuns.js';
import { cancelDurableRun, clearDurableRunsListCache, getDurableRun, getDurableRunLog, getDurableRunSnapshot, listDurableRuns, listDurableRunsWithTelemetry, type DurableRunsListTelemetry } from './automation/durableRuns.js';
import { getDurableRunAttentionSignature } from './automation/durableRunAttention.js';
import {
  buildConversationExecutionState,
  buildRemoteExecutionTranscriptResponse,
  importRemoteExecutionRun,
  readRemoteExecutionRunConversationId,
  resolveRemoteExecutionCwd,
  submitRemoteExecutionRun,
  type ConversationExecutionState,
} from './workspace/remoteExecution.js';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedProfilesContext,
  buildReferencedSkillsContext,
  buildReferencedTasksContext,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
} from './knowledge/promptReferences.js';
import {
  INBOX_RETENTION_MS,
  listArchivedAttentionSessions,
  listExpiredActivityRecords,
  listExpiredAttentionSessions,
  listStandaloneActivityRecords,
} from './automation/inbox.js';
import {
  clearActivityConversationLinks,
  deleteConversationArtifact,
  deleteConversationAttachment,
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  getConversationArtifact,
  getConversationAttachment,
  getConversationExecutionTarget,
  getConversationProjectLink,
  getExecutionTarget,
  getSyncRoot,
  getProfilesRoot,
  getLocalProfileDir,
  getStateRoot,
  createMemoryDoc,
  loadMemoryPackageReferences,
  listConversationArtifacts,
  listConversationAttachments,
  inspectMcpServer,
  inspectMcpTool,
  listProfileActivityEntries,
  listDeferredResumeRecords,
  loadDeferredResumeState,
  loadProfileActivityReadState,
  markConversationAttentionRead,
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
  saveExecutionTarget,
  saveProfileActivityReadState,
  setActivityConversationLinks,
  setConversationExecutionTarget,
  summarizeConversationAttention,
  deleteExecutionTarget,
} from '@personal-agent/core';
import {
  installPackageSource,
  readPackageSourceTargetState,
} from '@personal-agent/resources';
import {
  completeDeferredResumeConversationRun,
  listPendingBackgroundRunResults,
  loadDaemonConfig,
  markBackgroundRunResultsDelivered,
  surfaceReadyDeferredResume,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  parsePendingOperation,
  resolveDaemonPaths,
  resolveDurableRunsRoot,
  startScheduledTaskRun,
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
  activateDueDeferredResumesForSessionFile,
  cancelDeferredResumeForSessionFile,
  completeDeferredResumeForSessionFile,
  fireDeferredResumeNowForSessionFile,
  listDeferredResumesForSessionFile,
  retryDeferredResumeForSessionFile,
  scheduleDeferredResumeForSessionFile,
  type DeferredResumeSummary,
} from './automation/deferredResumes.js';

const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const COMPANION_DISABLED = process.env.PA_WEB_DISABLE_COMPANION === '1';
const COMPANION_PORT = COMPANION_DISABLED
  ? 0
  : parseInt(process.env.PA_WEB_COMPANION_PORT ?? String(readWebUiConfig().companionPort), 10);
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
  const local = getLocalLiveSessions();
  const localIds = new Set(local.map((session) => session.id));
  const remote = listRemoteLiveSessions().filter((session) => !localIds.has(session.id));
  return [...local, ...remote];
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

// ── Activity read-state ───────────────────────────────────────────────────────
// Stored as a simple JSON set alongside activity files.
function listActivityStateRoots(): Array<string | undefined> {
  try {
    return [undefined, resolveDaemonRoot()];
  } catch {
    return [undefined];
  }
}

function loadReadState(stateRoot: string | undefined, profile = getCurrentProfile()): Set<string> {
  return loadProfileActivityReadState({ repoRoot: REPO_ROOT, stateRoot, profile });
}

function saveReadState(ids: Set<string>, stateRoot: string | undefined, profile = getCurrentProfile()) {
  try {
    saveProfileActivityReadState({ repoRoot: REPO_ROOT, stateRoot, profile, ids });
  } catch { /* ignore */ }
}

const SETTINGS_FILE = DEFAULT_RUNTIME_SETTINGS_FILE;
const INBOX_CULL_INTERVAL_MS = 5 * 60 * 1000;
let cullingInbox = false;

function readOpenConversationIds(): Set<string> {
  try {
    const saved = readSavedWebUiPreferences(SETTINGS_FILE);
    return new Set([...saved.openConversationIds, ...saved.pinnedConversationIds]);
  } catch {
    return new Set();
  }
}

function deleteActivityIdsForProfile(profile: string, activityIds: Iterable<string>): string[] {
  const requestedIds = [...new Set(Array.from(activityIds)
    .filter((activityId): activityId is string => typeof activityId === 'string')
    .map((activityId) => activityId.trim())
    .filter((activityId) => activityId.length > 0))];

  if (requestedIds.length === 0) {
    return [];
  }

  const requestedIdSet = new Set(requestedIds);
  const deletedIds = new Set<string>();

  for (const stateRoot of listActivityStateRoots()) {
    const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, stateRoot, profile });
    const matchingEntries = entries.filter(({ entry }) => requestedIdSet.has(entry.id));
    if (matchingEntries.length === 0) {
      continue;
    }

    for (const { path, entry } of matchingEntries) {
      rmSync(path, { force: true });
      clearActivityConversationLinks({ stateRoot, profile, activityId: entry.id });
      deletedIds.add(entry.id);
    }

    const readState = loadReadState(stateRoot, profile);
    let readStateChanged = false;
    for (const { entry } of matchingEntries) {
      readStateChanged = readState.delete(entry.id) || readStateChanged;
    }
    if (readStateChanged) {
      saveReadState(readState, stateRoot, profile);
    }
  }

  return [...deletedIds];
}

function markConversationSessionsRead(profile: string, sessions: Array<{ id: string; messageCount: number }>): string[] {
  const dedupedSessions = [...new Map(sessions.map((session) => [session.id, session])).values()];

  for (const session of dedupedSessions) {
    markConversationAttentionRead({
      profile,
      conversationId: session.id,
      messageCount: session.messageCount,
    });
  }

  return dedupedSessions.map((session) => session.id);
}

function clearInboxForCurrentProfile() {
  const profile = getCurrentProfile();
  const sessions = listConversationSessionsSnapshot();
  const activityRecords = listActivityRecordsForProfile(profile);
  const standaloneActivities = listStandaloneActivityRecords(activityRecords, sessions.map((session) => session.id));
  const archivedAttentionSessions = listArchivedAttentionSessions(sessions, readOpenConversationIds());
  const deletedActivityIds = deleteActivityIdsForProfile(profile, standaloneActivities.map((record) => record.entry.id));
  const clearedConversationIds = markConversationSessionsRead(profile, archivedAttentionSessions);

  if (deletedActivityIds.length > 0 || clearedConversationIds.length > 0) {
    invalidateAppTopics('activity', 'sessions');
  }

  return {
    deletedActivityIds,
    clearedConversationIds,
  };
}

function cullExpiredInboxItems() {
  if (cullingInbox) {
    return { deletedActivityIds: [], clearedConversationIds: [] };
  }

  cullingInbox = true;

  try {
    const profile = getCurrentProfile();
    const cutoffMs = Date.now() - INBOX_RETENTION_MS;
    const expiredActivityIds = listExpiredActivityRecords(listActivityRecordsForProfile(profile), cutoffMs)
      .map((record) => record.entry.id);
    const deletedActivityIds = deleteActivityIdsForProfile(profile, expiredActivityIds);

    const sessions = listConversationSessionsSnapshot();
    const archivedAttentionSessions = listArchivedAttentionSessions(sessions, readOpenConversationIds());
    const clearedConversationIds = markConversationSessionsRead(
      profile,
      listExpiredAttentionSessions(archivedAttentionSessions, cutoffMs),
    );

    if (deletedActivityIds.length > 0 || clearedConversationIds.length > 0) {
      invalidateAppTopics('activity', 'sessions');
    }

    return {
      deletedActivityIds,
      clearedConversationIds,
    };
  } finally {
    cullingInbox = false;
  }
}

function startInboxCullLoop(): void {
  void Promise.resolve().then(() => cullExpiredInboxItems()).catch((error) => {
    logWarn(`Inbox cull failed: ${(error as Error).message}`);
  });

  setInterval(() => {
    void Promise.resolve().then(() => cullExpiredInboxItems()).catch((error) => {
      logWarn(`Inbox cull failed: ${(error as Error).message}`);
    });
  }, INBOX_CULL_INTERVAL_MS);
}

type ActivityEntryWithConversationLinks = ReturnType<typeof listProfileActivityEntries>[number]['entry'] & {
  relatedConversationIds?: string[];
};

type ActivityRecord = {
  stateRoot?: string;
  entry: ActivityEntryWithConversationLinks;
  read: boolean;
};

type ActivityListEntry = ActivityEntryWithConversationLinks & {
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

function listActivityRecordsForProfile(profile = getCurrentProfile()): ActivityRecord[] {
  const records: ActivityRecord[] = [];

  for (const stateRoot of listActivityStateRoots()) {
    const readState = loadReadState(stateRoot, profile);
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

function listActivityForProfile(profile = getCurrentProfile()): ActivityListEntry[] {
  return listActivityRecordsForProfile(profile).map(({ entry, read }) => ({
    ...entry,
    read,
  }));
}

function findActivityRecord(profile: string, activityId: string): ActivityRecord | undefined {
  return listActivityRecordsForProfile(profile).find((record) => record.entry.id === activityId);
}

function markActivityReadState(profile: string, activityId: string, read: boolean): boolean {
  let changed = false;

  for (const stateRoot of listActivityStateRoots()) {
    const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, stateRoot, profile });
    if (!entries.some(({ entry }) => entry.id === activityId)) {
      continue;
    }

    const state = loadReadState(stateRoot, profile);
    if (read) {
      state.add(activityId);
    } else {
      state.delete(activityId);
    }
    saveReadState(state, stateRoot, profile);
    changed = true;
  }

  return changed;
}

function listActivityForCurrentProfile() {
  return listActivityForProfile(getCurrentProfile());
}

function getConversationMemoryRelatedProjectIds(profile: string, conversationId: string): string[] {
  return getConversationProjectLink({
    profile,
    conversationId,
  })?.relatedProjectIds ?? [];
}

function tryWriteConversationMemoryDistillFailureActivity(options: {
  profile: string;
  conversationId: string;
  error: string;
  relatedProjectIds?: string[];
}): string | undefined {
  try {
    return writeConversationMemoryDistillFailureActivity({
      profile: options.profile,
      conversationId: options.conversationId,
      error: options.error,
      relatedProjectIds: options.relatedProjectIds ?? getConversationMemoryRelatedProjectIds(options.profile, options.conversationId),
    });
  } catch (error) {
    logWarn('failed to write conversation memory distill failure activity', {
      profile: options.profile,
      conversationId: options.conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

function buildInboxActivityConversationContext(entry: ActivityEntryWithConversationLinks): string {
  const lines = [
    'Inbox activity context for this conversation:',
    `- activity id: ${entry.id}`,
    `- kind: ${entry.kind}`,
    `- created at: ${entry.createdAt}`,
    `- summary: ${entry.summary}`,
  ];

  if (entry.notificationState) {
    lines.push(`- notification state: ${entry.notificationState}`);
  }

  if (entry.relatedProjectIds && entry.relatedProjectIds.length > 0) {
    lines.push(`- related projects: ${entry.relatedProjectIds.join(', ')}`);
  }

  if (entry.details && entry.details.trim().length > 0) {
    lines.push('', 'Details:', entry.details.trim());
  }

  lines.push('', 'Use this inbox item as durable context for follow-up in this conversation.');
  return lines.join('\n');
}

function listTasksForCurrentProfile() {
  const loaded = loadScheduledTasksForProfile(getCurrentProfile());
  const runtimeByFilePath = new Map(loaded.runtimeEntries.map((task) => [task.filePath, task]));
  const runtimeById = new Map(
    loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
  );

  return loaded.tasks.map((task) => {
    const runtime = loaded.runtimeState[task.key] ?? runtimeByFilePath.get(task.filePath) ?? runtimeById.get(task.id);
    return {
      id: task.id,
      filePath: task.filePath,
      scheduleType: task.schedule.type,
      running: runtime?.running ?? false,
      enabled: task.enabled,
      cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
      at: task.schedule.type === 'at' ? task.schedule.at : undefined,
      prompt: task.prompt.split('\n')[0]?.slice(0, 120) ?? '',
      model: task.modelRef,
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

function buildTaskDetailResponse(task: { filePath: string }, runtime?: TaskRuntimeEntry) {
  const metadata = readScheduledTaskFileMetadata(task.filePath);
  return {
    ...(runtime ?? {}),
    id: metadata.id,
    filePath: task.filePath,
    scheduleType: metadata.scheduleType,
    running: runtime?.running ?? false,
    enabled: metadata.enabled,
    cron: metadata.cron,
    at: metadata.at,
    model: metadata.model,
    cwd: metadata.cwd,
    timeoutSeconds: metadata.timeoutSeconds,
    prompt: metadata.promptBody,
    fileContent: metadata.fileContent,
  };
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
    'If the only sensible next step is to wait and inspect again later, schedule deferred_resume yourself instead of asking the user to remind you.',
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

function parseSessionActivityAt(session: { lastActivityAt?: string; timestamp: string }): number {
  const timestamp = session.lastActivityAt ?? session.timestamp;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : 0;
}

type SessionDetailRouteRemoteMirrorTelemetry = RemoteConversationMirrorSyncTelemetry | { status: 'deferred'; durationMs: 0 };
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

function buildNoRemoteConversationMirrorTelemetry(): RemoteConversationMirrorSyncTelemetry {
  return { status: 'not-remote', durationMs: 0 };
}

function invalidateSessionsAfterRemoteMirrorSync(
  conversationId: string,
  remoteMirror: RemoteConversationMirrorSyncTelemetry,
): void {
  if (remoteMirror.status === 'synced-live' || remoteMirror.status === 'synced-binding') {
    publishConversationSessionMetaChanged(conversationId);
  }
}

async function readSessionDetailForRoute(input: {
  conversationId: string;
  profile: string;
  tailBlocks?: number;
}): Promise<{
  sessionRead: SessionDetailRouteReadResult;
  remoteMirror: SessionDetailRouteRemoteMirrorTelemetry;
}> {
  const remoteMirrorPromise = syncRemoteConversationMirror({
    profile: input.profile,
    conversationId: input.conversationId,
  }).catch((error) => {
    logWarn('background remote conversation mirror sync failed', {
      conversationId: input.conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
    return buildNoRemoteConversationMirrorTelemetry();
  });

  let sessionRead = readSessionBlocksWithTelemetry(
    input.conversationId,
    input.tailBlocks ? { tailBlocks: input.tailBlocks } : undefined,
  );

  if (sessionRead.detail) {
    void remoteMirrorPromise.then((remoteMirror) => {
      invalidateSessionsAfterRemoteMirrorSync(input.conversationId, remoteMirror);
    });

    return {
      sessionRead,
      remoteMirror: { status: 'deferred', durationMs: 0 },
    };
  }

  const remoteMirror = await remoteMirrorPromise;
  sessionRead = readSessionBlocksWithTelemetry(
    input.conversationId,
    input.tailBlocks ? { tailBlocks: input.tailBlocks } : undefined,
  );

  invalidateSessionsAfterRemoteMirrorSync(input.conversationId, remoteMirror);
  return { sessionRead, remoteMirror };
}

function sortSessionsForCompanionList<T extends {
  isLive?: boolean;
  needsAttention?: boolean;
  isRunning?: boolean;
  lastActivityAt?: string;
  timestamp: string;
}>(sessions: T[]): T[] {
  return [...sessions].sort((left, right) => {
    if (Boolean(left.isLive) !== Boolean(right.isLive)) {
      return left.isLive ? -1 : 1;
    }

    if (Boolean(left.needsAttention) !== Boolean(right.needsAttention)) {
      return left.needsAttention ? -1 : 1;
    }

    if (Boolean(left.isRunning) !== Boolean(right.isRunning)) {
      return left.isRunning ? -1 : 1;
    }

    return parseSessionActivityAt(right) - parseSessionActivityAt(left);
  });
}

function parseBoundedIntegerQueryValue(
  rawValue: unknown,
  defaultValue: number,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number {
  const firstValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const parsed = typeof firstValue === 'string'
    ? Number.parseInt(firstValue, 10)
    : typeof firstValue === 'number'
      ? firstValue
      : Number.NaN;

  if (!Number.isInteger(parsed)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, parsed));
}

function listCompanionConversationSections(options?: { archivedOffset?: number; archivedLimit?: number }) {
  const saved = readSavedWebUiPreferences(SETTINGS_FILE);
  const workspaceSessionIds = [
    ...saved.openConversationIds,
    ...saved.pinnedConversationIds,
  ];
  const workspaceSessionIdSet = new Set(workspaceSessionIds);
  const archivedSessionIdSet = new Set(saved.archivedConversationIds);
  const sessions = sortSessionsForCompanionList(listConversationSessionsSnapshot());
  const live: typeof sessions = [];
  const needsReview: typeof sessions = [];
  const active: typeof sessions = [];
  const archived: typeof sessions = [];

  for (const session of sessions) {
    if (archivedSessionIdSet.has(session.id)) {
      archived.push(session);
      continue;
    }

    // If the session is in the workspace (open/pinned tab in web UI), include it
    // in the live section so it appears in the companion's "Live now" list.
    if (workspaceSessionIdSet.has(session.id)) {
      active.push(session);
      continue;
    }

    if (session.isLive) {
      live.push(session);
      continue;
    }

    if (session.needsAttention) {
      needsReview.push(session);
      continue;
    }

    archived.push(session);
  }

  const archivedOffset = Math.min(options?.archivedOffset ?? 0, archived.length);
  const archivedLimit = Math.max(1, options?.archivedLimit ?? 30);
  const nextArchived = archived.slice(archivedOffset, archivedOffset + archivedLimit);

  return {
    live,
    needsReview,
    active,
    archived: nextArchived,
    archivedTotal: archived.length,
    archivedOffset,
    archivedLimit,
    hasMoreArchived: archivedOffset + nextArchived.length < archived.length,
    workspaceSessionIds,
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

async function readConversationModelPreferenceStateById(conversationId: string): Promise<{ currentModel: string; currentThinkingLevel: string } | null> {
  const profile = getCurrentProfile();
  const binding = readRemoteConversationBindingForConversation({ profile, conversationId });
  if (binding) {
    await syncRemoteConversationMirror({ profile, conversationId });
  }

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

let processingDeferredResumes = false;

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
  const remoteMeta = getRemoteLiveSessionMeta(conversationId);
  if (remoteMeta) {
    return {
      conversationId,
      sessionFile: remoteMeta.sessionFile,
      cwd: remoteMeta.cwd,
      title: remoteMeta.title,
      isStreaming: remoteMeta.isStreaming,
      remote: true,
    };
  }

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

  const targetBinding = getConversationExecutionTarget({
    profile: getCurrentProfile(),
    conversationId,
  });

  if (targetBinding) {
    await resumeRemoteLiveSession({
      profile: getCurrentProfile(),
      conversationId,
      localSessionFile: sessionFile,
      targetId: targetBinding.targetId,
    });

    const resumedRemoteMeta = getRemoteLiveSessionMeta(conversationId);
    if (!resumedRemoteMeta) {
      throw new Error(`Could not resume remote conversation ${conversationId}.`);
    }

    return {
      conversationId,
      sessionFile: resumedRemoteMeta.sessionFile,
      cwd: resumedRemoteMeta.cwd,
      title: resumedRemoteMeta.title,
      isStreaming: resumedRemoteMeta.isStreaming,
      remote: true,
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

async function flushLiveDeferredResumes(): Promise<void> {
  if (processingDeferredResumes) {
    return;
  }

  processingDeferredResumes = true;

  try {
    // Server-side deferred resume delivery injects prompts into already-live conversations.
    const liveSessions = listAllLiveSessions().filter((session) => session.sessionFile);
    const now = new Date();
    const daemonRoot = resolveDaemonRoot();
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
            repoRoot: REPO_ROOT,
            profile: getCurrentProfile(),
            stateRoot: getStateRoot(),
            conversationId: session.id,
          });
        }
      }

      const readyEntries = listDeferredResumesForSessionFile(session.sessionFile)
        .filter((entry) => entry.status === 'ready');
      for (const readyEntry of readyEntries) {
        const liveEntry = liveRegistry.get(session.id);
        if (!liveEntry) {
          break;
        }

        try {
          if (liveEntry.session.sessionFile) {
            await syncWebLiveConversationRun({
              conversationId: session.id,
              sessionFile: liveEntry.session.sessionFile,
              cwd: liveEntry.cwd,
              title: liveEntry.title,
              profile: getCurrentProfile(),
              state: 'running',
              pendingOperation: {
                type: 'prompt',
                text: readyEntry.prompt,
                ...(liveEntry.session.isStreaming ? { behavior: 'followUp' as const } : {}),
                enqueuedAt: new Date().toISOString(),
              },
            });
          }

          await promptLocalSession(
            session.id,
            readyEntry.prompt,
            liveEntry.session.isStreaming ? 'followUp' : undefined,
          );

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
          if (liveEntry.session.sessionFile) {
            await syncWebLiveConversationRun({
              conversationId: session.id,
              sessionFile: liveEntry.session.sessionFile,
              cwd: liveEntry.cwd,
              title: liveEntry.title,
              profile: getCurrentProfile(),
              state: 'failed',
              lastError: (error as Error).message,
            });
          }

          const retryDueAt = new Date(Date.now() + DEFERRED_RESUME_RETRY_DELAY_MS).toISOString();
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
              lastError: (error as Error).message,
            });
          }
          logWarn(`Deferred resume delivery failed for ${session.id}: ${(error as Error).message}`);
          break;
        }
      }
    }

    if (mutated) {
      publishConversationSessionMetaChanged(...mutatedConversationIds);
    }
  } finally {
    processingDeferredResumes = false;
  }
}

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
startInboxCullLoop();

const DIST_DIR =
  process.env.PA_WEB_DIST ??
  join(dirname(fileURLToPath(import.meta.url)), '../dist');
const COMPANION_DIST_DIR = join(DIST_DIR, 'app');
const DIST_ASSETS_DIR = join(DIST_DIR, 'assets');

const { app, companionApp } = createServerApps();

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
  listActivityForCurrentProfile,
  listTasksForCurrentProfile,
  listMemoryDocs: () => listMemoryDocs(),
  listSkillsForCurrentProfile: () => listSkillsForProfile(getCurrentProfile()),
  listProfileAgentItems: () => [],
  withTemporaryProfileAgentDir,
  browseRemoteTargetDirectory,
  getDurableRunSnapshot: async (runId: string, tail: number) => (await getDurableRunSnapshot(runId, tail)) ?? null,
  draftWorkspaceCommitMessage,
  listDurableRuns,
});

registerServerRoutes({
  app,
  companionApp,
  context: routeContext,
});

mountStaticServerApps({
  app,
  companionApp,
  distDir: DIST_DIR,
  companionDistDir: COMPANION_DIST_DIR,
  distAssetsDir: DIST_ASSETS_DIR,
  companionDisabled: COMPANION_DISABLED,
  loopbackHost: LOOPBACK_HOST,
  companionPort: COMPANION_PORT,
});

warmMemoryBrowserCaches(getCurrentProfile());

startServerListeners({
  app,
  companionApp,
  port: PORT,
  companionPort: COMPANION_PORT,
  loopbackHost: LOOPBACK_HOST,
  companionDisabled: COMPANION_DISABLED,
  getCurrentProfile,
  getDefaultWebCwd,
  repoRoot: REPO_ROOT,
  distDir: DIST_DIR,
  companionDistDir: COMPANION_DIST_DIR,
});
