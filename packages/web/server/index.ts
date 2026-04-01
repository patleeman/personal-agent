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
  ensureMemoryDocsDir,
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
import {
  writeInternalAttentionEntry,
} from './shared/internalAttention.js';
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
import { ensureDaemonAvailable } from './automation/daemonToolUtils.js';
import {
  saveCuratedDistilledConversationMemory,
  type DistilledConversationMemoryDraft,
} from './conversations/conversationMemoryCuration.js';
import {
  writeConversationMemoryDistillActivity,
  writeConversationMemoryDistillFailureActivity,
} from './conversations/conversationMemoryActivity.js';
import {
  buildConversationMemoryWorkItemsFromStates,
  CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX,
  isConversationMemoryDistillRecoveryTitle,
  normalizeConversationMemoryDistillRecoveryTitle,
  listConversationMemoryMaintenanceStates,
  markConversationMemoryMaintenanceRunCompleted,
  markConversationMemoryMaintenanceRunFailed,
  markConversationMemoryMaintenanceRunStarted,
  readConversationCheckpointSnapshotFromState,
  readConversationMemoryMaintenanceState,
  type ConversationMemoryMaintenanceMode,
  type ConversationMemoryMaintenanceTrigger,
  type ConversationMemoryWorkItem,
} from './conversations/conversationMemoryMaintenance.js';
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
  addConversationProjectLink,
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
  loadMemoryDocs,
  loadMemoryPackageReferences,
  listConversationProjectLinks,
  listConversationArtifacts,
  listConversationAttachments,
  inspectMcpServer,
  inspectMcpTool,
  listProfileActivityEntries,
  listAllProjectIds,
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
  readProjectOwnerProfile,
  removeConversationProjectLink,
  resolveConversationAttachmentPromptFiles,
  resolveProjectPaths,
  saveConversationAttachment,
  saveExecutionTarget,
  saveProfileActivityReadState,
  setActivityConversationLinks,
  setConversationExecutionTarget,
  setConversationProjectLinks,
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
  startBackgroundRun,
  type BackgroundRunResultSummary,
} from '@personal-agent/daemon';
import {
  addProjectMilestone,
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectMilestone,
  deleteProjectRecord,
  deleteProjectTaskRecord,
  listProjectIndex,
  moveProjectMilestone,
  moveProjectTaskRecord,
  readProjectDetailFromProject,
  readProjectSource,
  saveProjectSource,
  setProjectArchivedState,
  updateProjectMilestone,
  updateProjectRecord,
  updateProjectTaskRecord,
  type InvalidProjectRecord,
  type ProjectDetail,
  type ProjectLinkedConversation,
  type ProjectTimelineEntry,
} from './projects/projects.js';
import {
  createProjectNoteRecord,
  deleteProjectFileRecord,
  deleteProjectNoteRecord,
  readProjectFileDownload,
  saveProjectDocument,
  updateProjectNoteRecord,
  uploadProjectFile,
} from './projects/projectResources.js';
import {
  buildProjectSharePackageFileName,
  exportProjectSharePackage,
} from './projects/projectPackages.js';
import { readNodeLinks, type NodeLinkKind, type NodeLinks } from './knowledge/nodeLinks.js';
import { generateProjectDocument } from './projects/projectDocuments.js';
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
const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';
const CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE = 'conversation-node-distill';
const LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE = 'conversation-memory-distill';
const CONVERSATION_NODE_DISTILL_BATCH_RECOVERY_RUN_SOURCE_TYPE = 'conversation-node-distill-recovery-batch';
const CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting']);

function isConversationNodeDistillRunSourceType(value: string | undefined): boolean {
  return value === CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE
    || value === LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE;
}

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

    if (result.daemonRestarted) {
      try {
        writeInternalAttentionEntry({
          repoRoot: REPO_ROOT,
          stateRoot: resolveDaemonRoot(),
          profile,
          kind: 'service',
          summary: 'Daemon restarted for the active profile.',
          details: [
            `Profile: ${profile}`,
            `Running task dir: ${result.runningTaskDir ?? 'unknown'}`,
            `Desired task dir: ${result.desiredTaskDir}`,
            'The web UI restarted the daemon so scheduled work matches the active profile task scope.',
          ].join('\n'),
          idPrefix: 'daemon-profile-sync',
        });
      } catch (error) {
        logWarn('failed to write daemon profile sync activity', {
          profile,
          message: (error as Error).message,
        });
      }
    }
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

export { buildLiveSessionExtensionFactories, buildLiveSessionResourceOptions };

void syncDaemonTaskScopeForProfile(getCurrentProfile());

function readNodeLinksForProfile(kind: NodeLinkKind, id: string, profile = getCurrentProfile()): NodeLinks {
  return readNodeLinks({
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
    profile,
    kind,
    id,
  });
}

function listProjectsForCurrentProfile() {
  return listProjectIndex({
    repoRoot: REPO_ROOT,
    profile: getCurrentProfile(),
  }).projects.map((project) => ({ ...project, profile: getCurrentProfile() }));
}

type MemoryWorkItem = ConversationMemoryWorkItem;

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

type ProjectDetailWithProfile = ProjectDetail & {
  profile: string;
  links: NodeLinks;
  project: ProjectDetail['project'] & {
    profile: string;
  };
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

interface ConversationMemoryDistillRunState {
  conversationId: string;
  running: boolean;
  runId: string | null;
  status: string | null;
}

function isConversationMemoryDistillRun(run: Awaited<ReturnType<typeof listDurableRuns>>['runs'][number], conversationId: string): boolean {
  return run.manifest?.kind === 'background-run'
    && isConversationNodeDistillRunSourceType(run.manifest.source?.type)
    && run.manifest.source?.id === conversationId;
}

export async function readConversationMemoryDistillRunState(conversationId: string): Promise<ConversationMemoryDistillRunState> {
  const runs = (await listDurableRuns()).runs
    .filter((run) => isConversationMemoryDistillRun(run, conversationId))
    .sort((left, right) => {
      const leftCreatedAt = left.manifest?.createdAt ?? '';
      const rightCreatedAt = right.manifest?.createdAt ?? '';
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });

  const latest = runs[0];
  const status = latest?.status?.status ?? null;

  return {
    conversationId,
    running: Boolean(status && CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES.has(status)),
    runId: latest?.runId ?? null,
    status,
  };
}

interface ConversationMemoryDistillRunInput {
  conversationId: string;
  profile: string;
  checkpointId: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  title?: string;
  summary?: string;
  emitActivity?: boolean;
}

interface ResolvedConversationMemoryDistillRunInput {
  conversationId: string;
  checkpointId: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  title?: string;
  summary?: string;
  emitActivity: boolean;
}

const MEMORY_DISTILL_RECOVERY_CUSTOM_TYPE = 'memory_distill_recovery';

function readOptionalRecordString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalRecordBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readConversationMemoryDistillRunInputFromRun(
  run: Awaited<ReturnType<typeof listDurableRuns>>['runs'][number],
  profile: string,
): ResolvedConversationMemoryDistillRunInput | null {
  const source = run.manifest?.source;
  if (run.manifest?.kind !== 'background-run' || !isConversationNodeDistillRunSourceType(source?.type)) {
    return null;
  }

  const conversationId = typeof source?.id === 'string' ? source.id.trim() : '';
  if (!conversationId) {
    return null;
  }

  const payload = isRecord(run.checkpoint?.payload) ? run.checkpoint.payload : {};
  const maintenanceState = readConversationMemoryMaintenanceState({ profile, conversationId });
  const checkpointId = readOptionalRecordString(payload, 'checkpointId')
    ?? maintenanceState?.runningCheckpointId
    ?? maintenanceState?.latestCheckpointId;

  if (!checkpointId) {
    return null;
  }

  const modeValue = readOptionalRecordString(payload, 'mode');
  const mode: ConversationMemoryMaintenanceMode = modeValue === 'manual'
    ? 'manual'
    : modeValue === 'auto'
      ? 'auto'
      : maintenanceState?.latestMode ?? 'auto';
  const triggerValue = readOptionalRecordString(payload, 'trigger');
  const trigger: ConversationMemoryMaintenanceTrigger = triggerValue === 'manual' || triggerValue === 'auto_compaction_end' || triggerValue === 'turn_end'
    ? triggerValue
    : maintenanceState?.latestTrigger ?? 'turn_end';

  return {
    conversationId,
    checkpointId,
    mode,
    trigger,
    title: readOptionalRecordString(payload, 'title'),
    summary: readOptionalRecordString(payload, 'summary'),
    emitActivity: readOptionalRecordBoolean(payload, 'emitActivity') ?? false,
  };
}

export function formatConversationMemoryCheckpointAnchor(snapshot: Awaited<ReturnType<typeof readConversationCheckpointSnapshotFromState>> | null): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  return `${snapshot.anchor.role} at ${new Date(snapshot.anchor.timestamp).toLocaleString()} — ${snapshot.anchor.preview}`;
}

export function buildConversationMemoryDistillRecoveryVisibleMessage(input: {
  runId: string;
  status: string;
  sourceConversationId: string;
  sourceConversationTitle?: string;
  checkpointId: string;
  anchorLabel?: string;
  error?: string;
}): string {
  return [
    `Run ${input.runId} did not finish its node distillation.`,
    `Status: ${input.status}`,
    `Source conversation: ${input.sourceConversationTitle ?? input.sourceConversationId}`,
    `Checkpoint: ${input.checkpointId}`,
    input.anchorLabel ? `Anchor: ${input.anchorLabel}` : undefined,
    input.error ? `Last error: ${input.error}` : undefined,
    '',
    'Use this branch to inspect the failure and steer a retry or manual fix.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

export function buildConversationMemoryDistillRecoveryHiddenContext(input: {
  runId: string;
  status: string;
  sourceConversationId: string;
  sourceConversationTitle?: string;
  checkpointId: string;
  anchorLabel?: string;
  title?: string;
  summary?: string;
  error?: string;
}): string {
  return [
    'You are helping recover a conversation node distillation that did not complete cleanly.',
    '',
    'This conversation is a fork of the source conversation, so the relevant transcript history is already available above.',
    '',
    'Recovery target:',
    `- runId: ${input.runId}`,
    `- status: ${input.status}`,
    `- source conversation: ${input.sourceConversationTitle ?? input.sourceConversationId}`,
    `- checkpointId: ${input.checkpointId}`,
    input.anchorLabel ? `- anchor: ${input.anchorLabel}` : undefined,
    input.title ? `- requested title: ${input.title}` : undefined,
    input.summary ? `- requested summary: ${input.summary}` : undefined,
    input.error ? `- last error: ${input.error}` : undefined,
    '',
    'Help the user inspect the failure, decide whether to retry the distillation, and if needed manually finish the durable note-node update.',
    `If you need the raw log, inspect durable run ${input.runId}.`,
    'Prefer targeted fixes over broad rewrites.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function resolveConversationMemoryDistillRunnerPath(): string {
  return fileURLToPath(new URL('./automation/distillConversationMemoryRun.js', import.meta.url));
}

function resolveConversationMemoryDistillBatchRecoveryRunnerPath(): string {
  return fileURLToPath(new URL('./automation/recoverConversationMemoryDistillRuns.js', import.meta.url));
}

export async function startConversationMemoryDistillRun(input: ConversationMemoryDistillRunInput) {
  await ensureDaemonAvailable();

  const runnerPath = resolveConversationMemoryDistillRunnerPath();
  if (!existsSync(runnerPath)) {
    return {
      accepted: false,
      reason: `Distillation runner not found: ${runnerPath}`,
      runId: undefined,
      logPath: undefined,
    };
  }

  const payload = Buffer.from(JSON.stringify({
    conversationId: input.conversationId,
    checkpointId: input.checkpointId,
    title: input.title,
    summary: input.summary,
    mode: input.mode,
    trigger: input.trigger,
    emitActivity: input.emitActivity ?? false,
  }), 'utf-8').toString('base64url');

  return startBackgroundRun({
    taskSlug: `distill-node-${input.conversationId}`,
    cwd: REPO_ROOT,
    argv: [
      process.execPath,
      runnerPath,
      '--port',
      String(PORT),
      '--profile',
      input.profile,
      '--payload',
      payload,
    ],
    source: {
      type: CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE,
      id: input.conversationId,
    },
    checkpointPayload: {
      conversationId: input.conversationId,
      checkpointId: input.checkpointId,
      mode: input.mode,
      trigger: input.trigger,
      ...(input.title ? { title: input.title } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
      emitActivity: input.emitActivity ?? false,
    },
  });
}

export async function startConversationMemoryDistillBatchRecoveryRun(input: { profile: string; runIds: string[] }) {
  await ensureDaemonAvailable();

  const runnerPath = resolveConversationMemoryDistillBatchRecoveryRunnerPath();
  if (!existsSync(runnerPath)) {
    return {
      accepted: false,
      reason: `Distillation recovery runner not found: ${runnerPath}`,
      runId: undefined,
      logPath: undefined,
    };
  }

  const runIds = [...new Set(input.runIds.map((runId) => runId.trim()).filter((runId) => runId.length > 0))];
  if (runIds.length === 0) {
    return {
      accepted: false,
      reason: 'At least one failed distillation run is required for batch recovery.',
      runId: undefined,
      logPath: undefined,
    };
  }

  return startBackgroundRun({
    taskSlug: `recover-node-distills-${input.profile}`,
    cwd: REPO_ROOT,
    argv: [
      process.execPath,
      runnerPath,
      '--port',
      String(PORT),
      '--profile',
      input.profile,
      ...runIds.flatMap((runId) => ['--run-id', runId]),
    ],
    source: {
      type: CONVERSATION_NODE_DISTILL_BATCH_RECOVERY_RUN_SOURCE_TYPE,
      id: input.profile,
    },
    checkpointPayload: {
      profile: input.profile,
      runIds,
      totalRuns: runIds.length,
    },
  });
}

export async function listMemoryWorkItems(): Promise<MemoryWorkItem[]> {
  const sessionsById = new Map(listConversationSessionsSnapshot().map((session) => [session.id, session]));
  const maintenanceStates = listConversationMemoryMaintenanceStates({ profile: getCurrentProfile() });
  const maintenanceStateByConversationId = new Map(maintenanceStates.map((state) => [state.conversationId, state]));
  const runs = (await listDurableRuns()).runs
    .filter((run) => run.manifest?.kind === 'background-run' && isConversationNodeDistillRunSourceType(run.manifest.source?.type))
    .sort((left, right) => {
      const leftCreatedAt = left.manifest?.createdAt ?? '';
      const rightCreatedAt = right.manifest?.createdAt ?? '';
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });

  const visibleStatuses = new Set([...CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES, 'failed', 'interrupted']);
  const latestRunByConversationId = new Map<string, (typeof runs)[number]>();
  for (const run of runs) {
    const conversationId = typeof run.manifest?.source?.id === 'string' ? run.manifest.source.id.trim() : '';
    if (!conversationId || latestRunByConversationId.has(conversationId)) {
      continue;
    }

    latestRunByConversationId.set(conversationId, run);
  }

  const items: MemoryWorkItem[] = [];
  for (const [conversationId, run] of latestRunByConversationId) {
    const session = sessionsById.get(conversationId);
    const maintenanceState = maintenanceStateByConversationId.get(conversationId);
    const conversationTitle = normalizeConversationMemoryDistillRecoveryTitle(
      session?.title ?? maintenanceState?.latestConversationTitle ?? conversationId,
    ) ?? conversationId;
    if (isConversationMemoryDistillRecoveryTitle(conversationTitle)) {
      continue;
    }

    const status = run.status?.status ?? '';
    if (!visibleStatuses.has(status)) {
      continue;
    }

    const createdAt = run.manifest?.createdAt ?? run.status?.createdAt ?? new Date().toISOString();
    const updatedAt = run.status?.updatedAt ?? createdAt;

    items.push({
      conversationId,
      conversationTitle,
      runId: run.runId,
      status,
      createdAt,
      updatedAt,
      ...(run.status?.lastError ? { lastError: run.status.lastError } : {}),
    });
  }

  const pendingStates = buildConversationMemoryWorkItemsFromStates(
    maintenanceStates
      .filter((state) => {
        const latestRun = latestRunByConversationId.get(state.conversationId);
        if (!latestRun) {
          return true;
        }

        const latestRunStatus = latestRun.status?.status ?? '';
        if (visibleStatuses.has(latestRunStatus)) {
          return false;
        }

        const latestRunUpdatedAt = latestRun.status?.updatedAt ?? latestRun.manifest?.createdAt ?? '';
        return state.updatedAt >= latestRunUpdatedAt;
      })
      .filter((state) => !isConversationMemoryDistillRecoveryTitle(
        sessionsById.get(state.conversationId)?.title ?? state.latestConversationTitle,
      )),
  ).map((item) => ({
    ...item,
    conversationTitle: normalizeConversationMemoryDistillRecoveryTitle(
      sessionsById.get(item.conversationId)?.title ?? item.conversationTitle,
    ) ?? item.conversationTitle,
  }));

  return [...items, ...pendingStates].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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

interface ParsedSessionJsonLine {
  raw: string;
  value: Record<string, unknown>;
}

interface SessionJsonMessageLine {
  id: string;
  timestamp: string;
  role: string;
  content: unknown;
}

interface CheckpointSnapshotBuildResult {
  snapshotContent: string;
  snapshotLineCount: number;
  snapshotMessageCount: number;
  anchor: {
    messageId: string;
    role: string;
    timestamp: string;
    preview: string;
  };
}

interface SaveDistilledConversationMemoryOptions {
  title?: string;
  summary?: string;
  sourceConversationTitle?: string;
  sourceCwd?: string;
  sourceProfile?: string;
  relatedProjectIds: string[];
  snapshot: CheckpointSnapshotBuildResult;
}

function parseSessionJsonLines(sessionFile: string): ParsedSessionJsonLine[] {
  const raw = readFileSync(sessionFile, 'utf-8');

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        return [{ raw: line, value } satisfies ParsedSessionJsonLine];
      } catch {
        return [];
      }
    });
}

function parseSessionMessageLine(value: Record<string, unknown>): SessionJsonMessageLine | null {
  if (value.type !== 'message') {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const timestamp = typeof value.timestamp === 'string' ? value.timestamp.trim() : '';
  const message = value.message && typeof value.message === 'object'
    ? value.message as Record<string, unknown>
    : null;

  if (!id || !timestamp || !message) {
    return null;
  }

  const role = typeof message.role === 'string' ? message.role.trim() : '';
  if (!role) {
    return null;
  }

  return {
    id,
    timestamp,
    role,
    content: message.content,
  };
}

function normalizeMessageContentBlocks(content: unknown): Array<{ type?: string; text?: string }> {
  if (Array.isArray(content)) {
    return content
      .filter((part): part is { type?: string; text?: string } => Boolean(part) && typeof part === 'object')
      .map((part) => ({
        type: typeof part.type === 'string' ? part.type : undefined,
        text: typeof part.text === 'string' ? part.text : undefined,
      }));
  }

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return [];
}

function buildCheckpointAnchorPreview(content: unknown): string {
  const blocks = normalizeMessageContentBlocks(content);

  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > 0) {
    return text.length > 120 ? `${text.slice(0, 119).trimEnd()}…` : text;
  }

  const imageCount = blocks.filter((block) => block.type === 'image').length;
  if (imageCount > 0) {
    return imageCount === 1 ? '(image attachment)' : `(${imageCount} image attachments)`;
  }

  return 'Checkpoint anchor';
}

function resolveAnchorMessageId(messageIds: string[], requestedAnchorMessageId?: string): string | undefined {
  if (messageIds.length === 0) {
    return undefined;
  }

  const idSet = new Set(messageIds);

  if (!requestedAnchorMessageId || requestedAnchorMessageId.trim().length === 0) {
    return messageIds[messageIds.length - 1];
  }

  const initialCandidate = requestedAnchorMessageId.trim();
  if (idSet.has(initialCandidate)) {
    return initialCandidate;
  }

  let candidate = initialCandidate;
  const seen = new Set<string>();

  while (!seen.has(candidate)) {
    seen.add(candidate);

    const trimmedCandidate = candidate.match(/^(.*)-[txcei]\d+$/)?.[1]?.trim();
    if (!trimmedCandidate) {
      break;
    }

    if (idSet.has(trimmedCandidate)) {
      return trimmedCandidate;
    }

    candidate = trimmedCandidate;
  }

  return undefined;
}

function buildCheckpointSnapshotFromSessionFile(sessionFile: string, requestedAnchorMessageId?: string): CheckpointSnapshotBuildResult {
  const lines = parseSessionJsonLines(sessionFile);
  const messageEntries = lines
    .map((line, lineIndex) => {
      const message = parseSessionMessageLine(line.value);
      if (!message) {
        return null;
      }

      return {
        lineIndex,
        message,
      };
    })
    .filter((entry): entry is { lineIndex: number; message: SessionJsonMessageLine } => entry !== null);

  if (messageEntries.length === 0) {
    throw new Error('Cannot distill memory from an empty conversation. Send at least one prompt first.');
  }

  const anchorMessageId = resolveAnchorMessageId(
    messageEntries.map((entry) => entry.message.id),
    requestedAnchorMessageId,
  );

  if (!anchorMessageId) {
    throw new Error('Unable to resolve memory anchor message.');
  }

  const anchorEntry = messageEntries.find((entry) => entry.message.id === anchorMessageId);
  if (!anchorEntry) {
    throw new Error(`Memory anchor message ${anchorMessageId} not found.`);
  }

  const snapshotLines = lines.slice(0, anchorEntry.lineIndex + 1);
  const snapshotMessageCount = snapshotLines
    .map((line) => parseSessionMessageLine(line.value))
    .filter((line): line is SessionJsonMessageLine => line !== null)
    .length;

  return {
    snapshotContent: `${snapshotLines.map((line) => line.raw).join('\n')}\n`,
    snapshotLineCount: snapshotLines.length,
    snapshotMessageCount,
    anchor: {
      messageId: anchorEntry.message.id,
      role: anchorEntry.message.role,
      timestamp: anchorEntry.message.timestamp,
      preview: buildCheckpointAnchorPreview(anchorEntry.message.content),
    },
  };
}

function normalizeDistilledText(value: string, maxLength = 180): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1).trimEnd()}…`
    : normalized;
}

function normalizeOptionalDistilledText(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = normalizeDistilledText(value, 220);
  return normalized.length > 0 ? normalized : undefined;
}

function currentDateYyyyMmDd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function normalizeDistilledTag(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  return normalized.length > 0 ? normalized : null;
}

function buildDefaultDistilledTitle(anchorPreview: string, anchorTimestamp: string): string {
  const normalizedPreview = normalizeDistilledText(anchorPreview, 88);
  if (normalizedPreview.length > 0 && normalizedPreview !== 'Checkpoint anchor' && !normalizedPreview.startsWith('(')) {
    return normalizedPreview;
  }

  const date = new Date(Date.parse(anchorTimestamp));
  if (Number.isFinite(date.getTime())) {
    return `Conversation memory ${date.toISOString().slice(0, 16).replace('T', ' ')}`;
  }

  return 'Conversation memory';
}

function parseSnapshotMessages(snapshotContent: string): SessionJsonMessageLine[] {
  return snapshotContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        const message = parseSessionMessageLine(parsed);
        return message ? [message] : [];
      } catch {
        return [];
      }
    });
}

function deriveDistilledConversationMemoryDraft(options: SaveDistilledConversationMemoryOptions): DistilledConversationMemoryDraft {
  const snapshotMessages = parseSnapshotMessages(options.snapshot.snapshotContent);

  const userMessages = snapshotMessages
    .filter((message) => message.role === 'user')
    .map((message) => normalizeDistilledText(buildCheckpointAnchorPreview(message.content), 200))
    .filter((message) => message.length > 0);

  const assistantMessages = snapshotMessages
    .filter((message) => message.role === 'assistant')
    .map((message) => normalizeDistilledText(buildCheckpointAnchorPreview(message.content), 200))
    .filter((message) => message.length > 0 && message !== 'Checkpoint anchor');

  const userIntentCandidate = userMessages[userMessages.length - 1]
    ?? userMessages[0]
    ?? normalizeDistilledText(options.snapshot.anchor.preview, 200);
  const userIntent = userIntentCandidate.length > 0
    ? userIntentCandidate
    : 'Continue the same work with the same intent.';

  const learnedPoints = [...new Set([
    ...assistantMessages.slice(-2),
    options.snapshot.anchor.role === 'assistant' ? normalizeDistilledText(options.snapshot.anchor.preview, 200) : '',
  ].filter((value) => value.length > 0))].slice(0, 3);

  const carryForwardPoints = [
    options.relatedProjectIds.length > 0 ? `Related projects: ${options.relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')}` : '',
    options.sourceCwd ? `Working directory at distillation: ${options.sourceCwd}` : '',
    `Anchor: ${options.snapshot.anchor.role} at ${new Date(options.snapshot.anchor.timestamp).toLocaleString()} — ${normalizeDistilledText(options.snapshot.anchor.preview, 160)}`,
  ].filter((value) => value.length > 0);

  const title = normalizeOptionalDistilledText(options.title) ?? buildDefaultDistilledTitle(options.snapshot.anchor.preview, options.snapshot.anchor.timestamp);

  const derivedSummary = normalizeDistilledText(
    options.summary
      ?? `User intent: ${userIntent}`,
    180,
  ) || 'Distilled memory from a conversation checkpoint.';

  const bodyLines = [
    `# ${title}`,
    '',
    derivedSummary,
    '',
    `At this checkpoint, the user intent was: ${userIntent}`,
  ];

  if (learnedPoints.length > 0) {
    bodyLines.push('', 'What the agent had learned by this point:');
    for (const point of learnedPoints) {
      bodyLines.push(`- ${point}`);
    }
  }

  if (carryForwardPoints.length > 0) {
    bodyLines.push('', 'Key carry-forward points:');
    for (const point of carryForwardPoints) {
      bodyLines.push(`- ${point}`);
    }
  }

  const sourceLabel = options.sourceConversationTitle
    ? `conversation "${options.sourceConversationTitle}"`
    : 'conversation context';

  bodyLines.push('', `_Distilled from ${sourceLabel} on ${new Date(options.snapshot.anchor.timestamp).toLocaleString()}._`);

  return {
    title,
    summary: derivedSummary,
    body: `${bodyLines.join('\n')}\n`,
    userIntent,
    learnedPoints,
    carryForwardPoints,
  };
}

function saveDistilledConversationMemory(options: SaveDistilledConversationMemoryOptions): MemoryDocItem & {
  disposition: 'updated-existing' | 'created-reference';
  reference: {
    path: string;
    relativePath: string;
    title: string;
    summary: string;
    updated: string;
  };
} {
  const memoryDir = ensureMemoryDocsDir();
  const draft = deriveDistilledConversationMemoryDraft(options);
  const updated = currentDateYyyyMmDd();
  const distilledAt = new Date().toISOString();
  const area = options.relatedProjectIds.length === 1
    ? normalizeDistilledTag(options.relatedProjectIds[0] ?? '') ?? undefined
    : undefined;
  const loaded = loadMemoryDocs({ profilesRoot: getProfilesRoot() });
  const saved = saveCuratedDistilledConversationMemory({
    memoryDir,
    existingDocs: loaded.docs,
    draft,
    updated,
    distilledAt,
    area,
    sourceConversationTitle: options.sourceConversationTitle,
    sourceCwd: options.sourceCwd,
    sourceProfile: options.sourceProfile,
    relatedProjectIds: options.relatedProjectIds,
    anchorPreview: normalizeDistilledText(options.snapshot.anchor.preview, 180),
  });

  return {
    ...saved.memory,
    disposition: saved.disposition,
    reference: saved.reference,
    recentSessionCount: 0,
    lastUsedAt: null,
    usedInLastSession: false,
  } satisfies MemoryDocItem & {
    disposition: 'updated-existing' | 'created-reference';
    reference: {
      path: string;
      relativePath: string;
      title: string;
      summary: string;
      updated: string;
    };
  };
}

type SavedConversationMemoryRecord = ReturnType<typeof saveDistilledConversationMemory>;

interface DistillConversationMemoryNowInput {
  conversationId: string;
  profile: string;
  title?: string;
  summary?: string;
  anchorMessageId?: string;
  checkpointId?: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  emitActivity: boolean;
}

interface DistillConversationMemoryNowResult {
  conversationId: string;
  memory: SavedConversationMemoryRecord;
  disposition: SavedConversationMemoryRecord['disposition'];
  reference: SavedConversationMemoryRecord['reference'];
  activityId?: string;
}

export async function distillConversationMemoryNow(input: DistillConversationMemoryNowInput): Promise<DistillConversationMemoryNowResult> {
  const normalizedCheckpointId = typeof input.checkpointId === 'string' && input.checkpointId.trim().length > 0
    ? input.checkpointId.trim()
    : undefined;

  if (!normalizedCheckpointId && liveRegistry.get(input.conversationId)?.session.isStreaming) {
    throw new Error('Stop the current response before distilling a note node.');
  }

  const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === input.conversationId);
  const maintenanceState = readConversationMemoryMaintenanceState({
    profile: input.profile,
    conversationId: input.conversationId,
  });
  const relatedProjectIds = getConversationProjectLink({
    profile: input.profile,
    conversationId: input.conversationId,
  })?.relatedProjectIds ?? [];

  const snapshot = normalizedCheckpointId
    ? readConversationCheckpointSnapshotFromState({
        profile: input.profile,
        conversationId: input.conversationId,
        checkpointId: normalizedCheckpointId,
      })
    : (() => {
        const sessionFile = resolveConversationSessionFile(input.conversationId);
        if (!sessionFile || !existsSync(sessionFile)) {
          throw new Error('Conversation not found.');
        }
        return buildCheckpointSnapshotFromSessionFile(sessionFile, input.anchorMessageId);
      })();

  const memory = saveDistilledConversationMemory({
    title: input.title,
    summary: input.summary,
    sourceConversationTitle: sourceSession?.title ?? maintenanceState?.latestConversationTitle,
    sourceCwd: sourceSession?.cwd ?? maintenanceState?.latestCwd,
    sourceProfile: input.profile,
    relatedProjectIds,
    snapshot,
  });

  const activitySummary = memory.disposition === 'updated-existing'
    ? `Updated note reference in @${memory.id}`
    : `Created note reference in @${memory.id}`;
  const activityDetails = [
    memory.disposition === 'updated-existing'
      ? `Updated an existing reference inside durable note node @${memory.id} from this conversation.`
      : `Created a new reference inside durable note node @${memory.id} from this conversation.`,
    `Hub title: ${memory.title}`,
    memory.summary ? `Hub summary: ${memory.summary}` : undefined,
    `Reference: ${memory.reference.title}`,
    `Reference path: ${memory.reference.relativePath}`,
  ].filter((line): line is string => Boolean(line)).join('\n');

  const activityId = input.emitActivity
    ? writeConversationMemoryDistillActivity({
        profile: input.profile,
        conversationId: input.conversationId,
        kind: 'conversation-node-distilled',
        summary: activitySummary,
        details: activityDetails,
        relatedProjectIds,
      })
    : undefined;

  if (normalizedCheckpointId) {
    markConversationMemoryMaintenanceRunCompleted({
      profile: input.profile,
      conversationId: input.conversationId,
      checkpointId: normalizedCheckpointId,
      memoryId: memory.id,
      referencePath: memory.reference.relativePath,
    });
  }

  return {
    conversationId: input.conversationId,
    memory,
    disposition: memory.disposition,
    reference: memory.reference,
    ...(activityId ? { activityId } : {}),
  };
}

function summarizeProjectConversationSnippet(conversationId: string): string | undefined {
  const detail = readSessionBlocks(conversationId);
  const blocks = detail?.blocks ?? [];

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (!block) {
      continue;
    }

    if ((block.type === 'user' || block.type === 'text' || block.type === 'thinking' || block.type === 'error') && 'text' in block) {
      const text = block.text.replace(/\s+/g, ' ').trim();
      if (text.length > 0) {
        return text.length > 180 ? `${text.slice(0, 179).trimEnd()}…` : text;
      }
    }
  }

  return undefined;
}

function listLinkedProjectConversations(projectId: string, profile = getCurrentProfile()): ProjectLinkedConversation[] {
  const sessionById = new Map(listConversationSessionsSnapshot().map((session) => [session.id, session]));

  return listConversationProjectLinks({ profile })
    .filter((document) => document.relatedProjectIds.includes(projectId))
    .map((document) => {
      const session = sessionById.get(document.conversationId);
      return {
        conversationId: document.conversationId,
        title: session?.title ?? document.conversationId,
        file: session?.file,
        cwd: session?.cwd,
        lastActivityAt: session?.lastActivityAt ?? session?.timestamp ?? document.updatedAt,
        isRunning: Boolean(session?.isRunning),
        needsAttention: Boolean(session?.needsAttention),
        snippet: summarizeProjectConversationSnippet(document.conversationId),
      } satisfies ProjectLinkedConversation;
    })
    .sort((left, right) => (right.lastActivityAt ?? '').localeCompare(left.lastActivityAt ?? ''));
}

function buildProjectTimeline(detail: ProjectDetail, profile = getCurrentProfile()): ProjectTimelineEntry[] {
  const activityEntries = listActivityForProfile(profile)
    .filter((entry) => (entry.relatedProjectIds ?? []).includes(detail.project.id));

  const timeline: ProjectTimelineEntry[] = [
    {
      id: `project:${detail.project.id}`,
      kind: 'project',
      createdAt: detail.project.createdAt,
      title: 'Project created',
      href: '#top',
    },
  ];

  if (detail.document) {
    timeline.push({
      id: `document:${detail.project.id}`,
      kind: 'document',
      createdAt: detail.document.updatedAt,
      title: 'Project doc updated',
      href: '#project-document',
    });
  }

  for (const note of detail.notes) {
    timeline.push({
      id: `note:${note.id}`,
      kind: 'note',
      createdAt: note.updatedAt,
      title: note.title,
      href: `#project-note-${note.id}`,
    });
  }

  for (const file of detail.files) {
    timeline.push({
      id: `file:${file.id}`,
      kind: 'file',
      createdAt: file.updatedAt,
      title: file.title,
      href: file.downloadPath,
    });
  }

  for (const conversation of detail.linkedConversations) {
    timeline.push({
      id: `conversation:${conversation.conversationId}`,
      kind: 'conversation',
      createdAt: conversation.lastActivityAt ?? '',
      title: conversation.title,
      href: `/conversations/${encodeURIComponent(conversation.conversationId)}`,
    });
  }

  for (const activity of activityEntries) {
    timeline.push({
      id: `activity:${activity.id}`,
      kind: 'activity',
      createdAt: activity.createdAt,
      title: activity.summary,
      href: '/inbox',
    });
  }

  return timeline
    .filter((entry) => entry.createdAt.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12);
}

function applyProjectProfile<T extends { downloadPath: string }>(items: T[], profile: string): T[] {
  return items.map((item) => ({
    ...item,
    downloadPath: `${item.downloadPath}?${VIEW_PROFILE_QUERY_PARAM}=${encodeURIComponent(profile)}`,
  }));
}

function annotateProjectRecord(project: ProjectDetail['project'], profile: string): ProjectDetailWithProfile['project'] {
  return {
    ...project,
    profile,
  };
}

function readProjectDetailForProfile(projectId: string, profile = getCurrentProfile()): ProjectDetailWithProfile {
  const detail = readProjectDetailFromProject({
    repoRoot: REPO_ROOT,
    profile,
    projectId,
  });
  const linkedConversations = listLinkedProjectConversations(projectId, profile);
  const appliedFiles = applyProjectProfile(detail.files, profile);
  const appliedAttachments = applyProjectProfile(detail.attachments, profile);
  const appliedArtifacts = applyProjectProfile(detail.artifacts, profile);
  const enriched: ProjectDetailWithProfile = {
    ...detail,
    profile,
    links: readNodeLinksForProfile('project', detail.project.id, profile),
    project: annotateProjectRecord(detail.project, profile),
    files: appliedFiles,
    attachments: appliedAttachments,
    artifacts: appliedArtifacts,
    linkedConversations,
    timeline: [],
  };
  enriched.timeline = buildProjectTimeline(enriched, profile);
  return enriched;
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
  getDefaultWebCwd,
  resolveRequestedCwd,
  buildLiveSessionResourceOptions,
  buildLiveSessionExtensionFactories,
  flushLiveDeferredResumes,
  getSavedWebUiPreferences: () => readSavedWebUiPreferences(SETTINGS_FILE),
  listActivityForCurrentProfile,
  listProjectsForCurrentProfile,
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
