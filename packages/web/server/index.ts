import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { listSessions, readSessionBlock, readSessionBlocks, readSessionBlocksWithTelemetry, readSessionImageAsset, readSessionSearchText, readSessionTree, renameStoredSession, type SessionDetailReadTelemetry } from './sessions.js';
import { invalidateAppTopics, startAppEventMonitor, subscribeAppEvents, type AppEventTopic } from './appEvents.js';
import { streamSnapshotEvents } from './snapshotEventStreaming.js';
import { notifyConversationAutomationChanged, subscribeConversationAutomation } from './conversationAutomationEvents.js';
import { resolveConversationCwd, resolveRequestedCwd } from './conversationCwd.js';
import { pickFolder } from './folderPicker.js';
import { readGitStatusSummaryWithTelemetry, type GitStatusReadTelemetry } from './gitStatus.js';
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
} from './workspaceBrowser.js';
import {
  installDaemonServiceAndReadState,
  readDaemonState,
  restartDaemonServiceAndReadState,
  startDaemonServiceAndReadState,
  stopDaemonServiceAndReadState,
  uninstallDaemonServiceAndReadState,
} from './daemon.js';
import {
  parseSyncSetupInput,
  readSyncState,
  requestSyncRunAndReadState,
  setupSyncAndReadState,
} from './sync.js';
import {
  installWebUiServiceAndReadState,
  markBadWebUiReleaseAndReadState,
  readWebUiState,
  readWebUiConfig,
  rollbackWebUiServiceAndReadState,
  startWebUiServiceAndReadState,
  stopWebUiServiceAndReadState,
  syncConfiguredWebUiTailscaleServe,
  uninstallWebUiServiceAndReadState,
  writeWebUiConfig,
} from './webUi.js';
import { requestApplicationRestart, requestApplicationUpdate, requestWebUiServiceRestart } from './applicationRestart.js';
import { shouldServeCompanionIndex } from './companionSpaIndex.js';
import { buildContentDispositionHeader } from './httpHeaders.js';
import { readSavedDefaultCwdPreferences, writeSavedDefaultCwdPreference } from './defaultCwdPreferences.js';
import { readSavedModelPreferences, writeSavedModelPreferences } from './modelPreferences.js';
import {
  cancelProviderOAuthLogin,
  getProviderOAuthLoginState,
  readProviderAuthState,
  removeProviderCredential,
  setProviderApiKey,
  startProviderOAuthLogin,
  submitProviderOAuthLoginInput,
  subscribeProviderOAuthLogin,
  subscribeProviderOAuthLogins,
} from './providerAuth.js';
import { readCodexPlanUsage } from './codexUsage.js';
import { readSavedConversationTitlePreferences, writeSavedConversationTitlePreferences } from './conversationTitlePreferences.js';
import { logError, logInfo, logWarn, installProcessLogging, webRequestLoggingMiddleware } from './logging.js';
import {
  createCompanionPairingCode,
  exchangeCompanionPairingCode,
  readCompanionAuthAdminState,
  readCompanionSession,
  revokeCompanionSession,
  revokeCompanionSessionByToken,
} from './companionAuth.js';
import {
  applyWebSecurityHeaders,
  createInMemoryRateLimit,
  enforceSameOriginUnsafeRequests,
  resolveRequestOrigin,
} from './webSecurity.js';
import {
  createServiceAttentionMonitor,
  suppressMonitoredServiceAttention,
  writeInternalAttentionEntry,
} from './internalAttention.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from './webUiPreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE, persistSettingsWrite } from './settingsPersistence.js';
import { draftWorkspaceCommitMessage } from './workspaceCommitDraft.js';
import {
  getProfileConfigFilePath,
  readSavedProfilePreferences,
  resolveActiveProfile,
  writeSavedProfilePreferences,
} from './profilePreferences.js';
import { syncDaemonTaskScopeToProfile } from './daemonProfileSync.js';
import {
  buildScheduledTaskMarkdown,
  getScheduledTaskStateFilePath,
  loadScheduledTasksForProfile,
  readScheduledTaskFileMetadata,
  resolveScheduledTaskForProfile,
  taskDirForProfile,
  validateScheduledTaskDefinition,
  type TaskRuntimeEntry,
} from './scheduledTasks.js';
import { createProjectAgentExtension } from './projectAgentExtension.js';
import { createArtifactAgentExtension } from './artifactAgentExtension.js';
import { createDeferredResumeAgentExtension } from './deferredResumeAgentExtension.js';
import { createReminderAgentExtension } from './reminderAgentExtension.js';
import { createScheduledTaskAgentExtension } from './scheduledTaskAgentExtension.js';
import { createActivityAgentExtension } from './activityAgentExtension.js';
import { createConversationTodoAgentExtension } from './conversationTodoAgentExtension.js';
import { createConversationAutomationPromptExtension } from './conversationAutomationPromptExtension.js';
import { createWaitForUserAgentExtension } from './waitForUserAgentExtension.js';
import { createAskUserQuestionAgentExtension } from './askUserQuestionAgentExtension.js';
import { createRunAgentExtension } from './runAgentExtension.js';
import { createMemoryAgentExtension } from './memoryAgentExtension.js';
import {
  saveCuratedDistilledConversationMemory,
  type DistilledConversationMemoryDraft,
} from './conversationMemoryCuration.js';
import {
  writeConversationMemoryDistillActivity,
  writeConversationMemoryDistillFailureActivity,
} from './conversationMemoryActivity.js';
import {
  buildConversationMemoryWorkItemsFromStates,
  CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX,
  isConversationMemoryDistillRecoveryTitle,
  normalizeConversationMemoryDistillRecoveryTitle,
  listConversationMemoryMaintenanceStates,
  markConversationMemoryMaintenanceRunCompleted,
  markConversationMemoryMaintenanceRunFailed,
  markConversationMemoryMaintenanceRunStarted,
  prepareConversationMemoryMaintenance,
  readConversationCheckpointSnapshotFromState,
  readConversationMemoryMaintenanceState,
  type ConversationMemoryMaintenanceMode,
  type ConversationMemoryMaintenanceTrigger,
} from './conversationMemoryMaintenance.js';
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
  appendVisibleCustomMessage,
  kickConversationAutomation,
  compactSession,
  reloadSessionResources,
  reloadAllLiveSessionAuth,
  exportSessionHtml,
  renameSession,
  abortSession as abortLocalSession,
  destroySession,
  branchSession,
  forkSession,
  registerLiveSessionLifecycleHandler,
  LiveSessionControlError,
  ensureSessionSurfaceCanControl,
  takeOverSessionControl,
  registry as liveRegistry,
} from './liveSessions.js';
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
} from './remoteLiveSessions.js';
import { recoverDurableLiveConversations } from './conversationRecovery.js';
import {
  loadConversationAutomationState,
  readSavedConversationAutomationPreferences,
  replaceConversationAutomationItems,
  resetConversationAutomationFromItem,
  resolveConversationAutomationPath,
  resumeConversationAutomationAfterUserMessage,
  setConversationAutomationItemPending,
  updateConversationAutomationEnabled,
  updateConversationAutomationItemStatus,
  writeSavedConversationAutomationPreferences,
  writeConversationAutomationState,
  readSavedConversationAutomationWorkflowPresets,
  writeSavedConversationAutomationWorkflowPresets,
} from './conversationAutomation.js';
import {
  clearLocalConversationAutomationSettings,
  migrateLocalConversationAutomationSettingsToProfile,
} from './conversationAutomationProfileSettings.js';
import { createWebLiveConversationRunId, syncWebLiveConversationRun } from './conversationRuns.js';
import { cancelDurableRun, clearDurableRunsListCache, getDurableRun, getDurableRunLog, getDurableRunSnapshot, listDurableRuns, listDurableRunsWithTelemetry, type DurableRunsListTelemetry } from './durableRuns.js';
import { getDurableRunAttentionSignature } from './durableRunAttention.js';
import {
  buildConversationExecutionState,
  buildExecutionTargetsState,
  buildRemoteExecutionTranscriptResponse,
  importRemoteExecutionRun,
  readRemoteExecutionRunConversationId,
  resolveRemoteExecutionCwd,
  submitRemoteExecutionRun,
  type ConversationExecutionState,
} from './remoteExecution.js';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedProfilesContext,
  buildReferencedSkillsContext,
  buildReferencedTasksContext,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
} from './promptReferences.js';
import {
  INBOX_RETENTION_MS,
  listArchivedAttentionSessions,
  listExpiredActivityRecords,
  listExpiredAttentionSessions,
  listStandaloneActivityRecords,
} from './inbox.js';
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
  getStateRoot,
  createMemoryDoc,
  loadMemoryDocs,
  loadMemoryPackageReferences,
  listConversationProjectLinks,
  listConversationArtifacts,
  listConversationAttachments,
  inspectCliBinary,
  inspectMcpServer,
  inspectMcpTool,
  listProfileActivityEntries,
  listAllProjectIds,
  listProjectIds,
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
  listProfiles,
  materializeProfileToAgentDir,
  readPackageSourceTargetState,
  resolveProfileSettingsFilePath,
  resolveResourceProfile,
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
} from './projects.js';
import {
  createProjectNoteRecord,
  deleteProjectFileRecord,
  deleteProjectNoteRecord,
  readProjectFileDownload,
  saveProjectBrief,
  updateProjectNoteRecord,
  uploadProjectFile,
} from './projectResources.js';
import {
  buildProjectSharePackageFileName,
  exportProjectSharePackage,
} from './projectPackages.js';
import { readNodeLinks, type NodeLinkKind } from './nodeLinks.js';
import { generateProjectBrief } from './projectBriefs.js';
import {
  acknowledgeAlertForProfile,
  dismissAlertForProfile,
  getAlertForProfile,
  getAlertSnapshotForProfile,
  snoozeAlertForProfile,
} from './alerts.js';
import {
  activateDueDeferredResumesForSessionFile,
  cancelDeferredResumeForSessionFile,
  completeDeferredResumeForSessionFile,
  fireDeferredResumeNowForSessionFile,
  listDeferredResumesForSessionFile,
  retryDeferredResumeForSessionFile,
  scheduleDeferredResumeForSessionFile,
  type DeferredResumeSummary,
} from './deferredResumes.js';

const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const COMPANION_DISABLED = process.env.PA_WEB_DISABLE_COMPANION === '1';
const COMPANION_PORT = COMPANION_DISABLED
  ? 0
  : parseInt(process.env.PA_WEB_COMPANION_PORT ?? String(readWebUiConfig().companionPort), 10);
const LOOPBACK_HOST = '127.0.0.1';
const DESKTOP_SESSION_COOKIE = 'pa_web';
const COMPANION_SESSION_COOKIE = 'pa_companion';
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
const CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE = 'conversation-node-distill';
const LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE = 'conversation-memory-distill';
const CONVERSATION_NODE_DISTILL_BATCH_RECOVERY_RUN_SOURCE_TYPE = 'conversation-node-distill-recovery-batch';
const CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting']);

function isConversationNodeDistillRunSourceType(value: string | undefined): boolean {
  return value === CONVERSATION_NODE_DISTILL_RUN_SOURCE_TYPE
    || value === LEGACY_CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE;
}

function isLiveSession(sessionId: string): boolean {
  return isLocalLive(sessionId) || isRemoteLiveSession(sessionId);
}

function listAllLiveSessions() {
  const local = getLocalLiveSessions();
  const localIds = new Set(local.map((session) => session.id));
  const remote = listRemoteLiveSessions().filter((session) => !localIds.has(session.id));
  return [...local, ...remote];
}

function subscribeLiveSession(
  sessionId: string,
  listener: (event: unknown) => void,
  options?: {
    tailBlocks?: number;
    surface?: {
      surfaceId: string;
      surfaceType: 'desktop_web' | 'mobile_web';
    };
  },
): (() => void) | null {
  return subscribeLocal(sessionId, listener, options)
    ?? subscribeRemoteLiveSession(sessionId, listener, options ? { tailBlocks: options.tailBlocks } : undefined);
}

async function abortLiveSession(sessionId: string): Promise<void> {
  if (isRemoteLiveSession(sessionId)) {
    await abortRemoteLiveSession(sessionId);
    return;
  }

  await abortLocalSession(sessionId);
}

function readRequestSurfaceId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  const value = (body as { surfaceId?: unknown }).surfaceId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function ensureRequestControlsLocalLiveConversation(conversationId: string, body: unknown): string | undefined {
  const surfaceId = readRequestSurfaceId(body);
  if (!isLocalLive(conversationId)) {
    return surfaceId;
  }

  if (!surfaceId) {
    throw new Error('surfaceId is required for local live conversation control.');
  }

  ensureSessionSurfaceCanControl(conversationId, surfaceId);
  return surfaceId;
}

function writeLiveConversationControlError(res: express.Response, error: unknown): boolean {
  if (error instanceof LiveSessionControlError) {
    res.status(409).json({ error: error.message });
    return true;
  }

  if (error instanceof Error && error.message === 'surfaceId is required for local live conversation control.') {
    res.status(400).json({ error: error.message });
    return true;
  }

  return false;
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function getDefaultWebCwd(): string {
  return readSavedDefaultCwdPreferences(SETTINGS_FILE, PROCESS_CWD).effectiveCwd;
}

installProcessLogging();

const VIEW_PROFILE_QUERY_PARAM = 'viewProfile';

function listAvailableProfiles(): string[] {
  return listProfiles({
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
}

function resolveRequestedProfileFromQuery(
  req: express.Request,
  options: { allowAll?: boolean } = {},
): string | 'all' {
  const requestedProfile = typeof req.query[VIEW_PROFILE_QUERY_PARAM] === 'string'
    ? req.query[VIEW_PROFILE_QUERY_PARAM].trim()
    : '';

  if (!requestedProfile) {
    return getCurrentProfile();
  }

  if (options.allowAll && requestedProfile === 'all') {
    return 'all';
  }

  if (!listAvailableProfiles().includes(requestedProfile)) {
    throw new Error(`Unknown profile: ${requestedProfile}`);
  }

  return requestedProfile;
}

function applyProfileEnvironment(profile: string): void {
  process.env.PERSONAL_AGENT_ACTIVE_PROFILE = profile;
  process.env.PERSONAL_AGENT_PROFILE = profile;
  process.env.PERSONAL_AGENT_REPO_ROOT = REPO_ROOT;
}

function materializeWebProfile(profile: string): void {
  applyProfileEnvironment(profile);
  const resolved = resolveResourceProfile(profile, {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
  materializeProfileToAgentDir(resolved, AGENT_DIR);
}

let currentProfile = resolveActiveProfile({
  explicitProfile: process.env.PERSONAL_AGENT_ACTIVE_PROFILE,
  savedProfile: readSavedProfilePreferences(PROFILE_CONFIG_FILE).defaultProfile,
  availableProfiles: listAvailableProfiles(),
});

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

try {
  if (migrateConversationAutomationSettingsForProfile(currentProfile)) {
    logInfo('migrated local conversation automation settings to active profile', {
      profile: currentProfile,
    });
  }
  materializeWebProfile(currentProfile);
} catch (error) {
  logWarn('failed to materialize initial profile', {
    profile: currentProfile,
    message: (error as Error).message,
  });
}

void syncDaemonTaskScopeForProfile(currentProfile);

registerLiveSessionLifecycleHandler((event) => {
  if (!event.sessionFile || !existsSync(event.sessionFile)) {
    return;
  }

  return maybeStartAutomaticConversationMemoryDistill({
    conversationId: event.conversationId,
    sessionFile: event.sessionFile,
    title: event.title,
    cwd: event.cwd,
    trigger: event.trigger,
  });
});

function getCurrentProfile(): string {
  return currentProfile;
}

function getCurrentProfileSettingsFile(): string {
  return resolveProfileSettingsFilePath(getCurrentProfile(), {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
}

function migrateConversationAutomationSettingsForProfile(profile: string): boolean {
  const migration = migrateLocalConversationAutomationSettingsToProfile(profile, {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
  return migration.migrated;
}

function clearLocalConversationAutomationSettingsOverride(): boolean {
  const result = clearLocalConversationAutomationSettings({
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
  return result.changed;
}

async function setCurrentProfile(profile: string): Promise<string> {
  const availableProfiles = listAvailableProfiles();
  if (!availableProfiles.includes(profile)) {
    throw new Error(`Unknown profile: ${profile}`);
  }

  if (profile === currentProfile) {
    return currentProfile;
  }

  const migratedAutomationSettings = migrateConversationAutomationSettingsForProfile(profile);
  materializeWebProfile(profile);
  currentProfile = profile;
  if (migratedAutomationSettings) {
    logInfo('migrated local conversation automation settings to selected profile', {
      profile,
    });
  }
  writeSavedProfilePreferences(profile, PROFILE_CONFIG_FILE);
  await syncDaemonTaskScopeForProfile(profile);
  invalidateAppTopics(
    'activity',
    'alerts',
    'projects',
    'sessions',
    'tasks',
    'runs',
    'automation',
    'daemon',
    'sync',
    'webUi',
    'executionTargets',
  );
  return currentProfile;
}

function buildLiveSessionExtensionFactories() {
  return [
    createProjectAgentExtension({
      repoRoot: REPO_ROOT,
      stateRoot: getStateRoot(),
      getCurrentProfile,
    }),
    createScheduledTaskAgentExtension({
      getCurrentProfile,
    }),
    createActivityAgentExtension({
      stateRoot: getStateRoot(),
      getCurrentProfile,
    }),
    createConversationTodoAgentExtension({
      stateRoot: getStateRoot(),
      getCurrentProfile,
    }),
    createConversationAutomationPromptExtension({
      stateRoot: getStateRoot(),
      settingsFile: SETTINGS_FILE,
      getCurrentProfile,
    }),
    createWaitForUserAgentExtension({
      stateRoot: getStateRoot(),
      getCurrentProfile,
    }),
    createAskUserQuestionAgentExtension(),
    createRunAgentExtension(),
    createMemoryAgentExtension(),
    createArtifactAgentExtension({
      stateRoot: getStateRoot(),
      getCurrentProfile,
    }),
    createDeferredResumeAgentExtension(),
    createReminderAgentExtension(),
  ];
}

function buildLiveSessionResourceOptions(profile = getCurrentProfile()) {
  const resolved = resolveResourceProfile(profile, {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });

  return {
    additionalExtensionPaths: resolved.extensionEntries,
    additionalSkillPaths: resolved.skillDirs,
    additionalPromptTemplatePaths: resolved.promptEntries,
    additionalThemePaths: resolved.themeEntries,
  };
}

function withTemporaryProfileAgentDir<T>(profile: string, run: (agentDir: string) => Promise<T>): Promise<T> {
  const resolved = resolveResourceProfile(profile, {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
  const agentDir = mkdtempSync(join(tmpdir(), 'pa-web-profile-inspect-'));
  materializeProfileToAgentDir(resolved, agentDir);

  return run(agentDir).finally(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });
}

function buildPackageInstallState(profile = getCurrentProfile()) {
  const profileTargets = listProfiles({
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  }).map((profileName) => ({
    ...readPackageSourceTargetState('profile', profileName, {
      repoRoot: REPO_ROOT,
      profilesRoot: getProfilesRoot(),
    }),
    profileName,
    current: profileName === profile,
  }));

  return {
    currentProfile: profile,
    profileTargets,
    localTarget: readPackageSourceTargetState('local', { repoRoot: REPO_ROOT }),
  };
}

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

interface ServerTimingMetric {
  name: string;
  durationMs: number;
  description?: string;
}

function formatServerTimingMetric(metric: ServerTimingMetric): string {
  const dur = Number.isFinite(metric.durationMs) ? Math.max(0, metric.durationMs) : 0;
  const parts = [`${metric.name};dur=${dur.toFixed(1)}`];
  if (metric.description) {
    parts.push(`desc="${metric.description.replace(/"/g, '')}"`);
  }
  return parts.join(';');
}

function setServerTimingHeaders(res: express.Response, metrics: ServerTimingMetric[], meta?: Record<string, unknown>): void {
  if (metrics.length > 0) {
    res.setHeader('Server-Timing', metrics.map(formatServerTimingMetric).join(', '));
  }

  if (meta && Object.keys(meta).length > 0) {
    res.setHeader('X-PA-Perf', JSON.stringify(meta));
  }
}

function logSlowConversationPerf(label: string, fields: Record<string, unknown>): void {
  const durationMs = typeof fields.durationMs === 'number' ? fields.durationMs : 0;
  if (durationMs < 150) {
    return;
  }

  logInfo(label, fields);
}

function summarizeUserMessageContent(content: unknown): { text: string; imageCount: number } {
  const blocks = Array.isArray(content)
    ? content as Array<{ type?: string; text?: string }>
    : typeof content === 'string'
      ? [{ type: 'text', text: content }]
      : [];

  const text = blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim();
  const imageCount = blocks.filter((block) => block.type === 'image').length;

  return { text, imageCount };
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

function getActivitySnapshotForCurrentProfile() {
  const entries = listActivityForCurrentProfile();
  return {
    entries,
    unreadCount: entries.filter((entry) => !entry.read).length,
  };
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

async function readConversationMemoryDistillRunState(conversationId: string): Promise<ConversationMemoryDistillRunState> {
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
  tags?: string[];
  emitActivity?: boolean;
}

interface ResolvedConversationMemoryDistillRunInput {
  conversationId: string;
  checkpointId: string;
  mode: ConversationMemoryMaintenanceMode;
  trigger: ConversationMemoryMaintenanceTrigger;
  title?: string;
  summary?: string;
  tags?: string[];
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

function readOptionalRecordStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

function readConversationMemoryDistillRunInputFromRun(
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
    tags: readOptionalRecordStringArray(payload, 'tags'),
    emitActivity: readOptionalRecordBoolean(payload, 'emitActivity') ?? false,
  };
}

function formatConversationMemoryCheckpointAnchor(snapshot: Awaited<ReturnType<typeof readConversationCheckpointSnapshotFromState>> | null): string | undefined {
  if (!snapshot) {
    return undefined;
  }

  return `${snapshot.anchor.role} at ${new Date(snapshot.anchor.timestamp).toLocaleString()} — ${snapshot.anchor.preview}`;
}

function buildConversationMemoryDistillRecoveryVisibleMessage(input: {
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

function buildConversationMemoryDistillRecoveryHiddenContext(input: {
  runId: string;
  status: string;
  sourceConversationId: string;
  sourceConversationTitle?: string;
  checkpointId: string;
  anchorLabel?: string;
  title?: string;
  summary?: string;
  tags?: string[];
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
    input.tags && input.tags.length > 0 ? `- requested tags: ${input.tags.join(', ')}` : undefined,
    input.error ? `- last error: ${input.error}` : undefined,
    '',
    'Help the user inspect the failure, decide whether to retry the distillation, and if needed manually finish the durable note-node update.',
    `If you need the raw log, inspect durable run ${input.runId}.`,
    'Prefer targeted fixes over broad rewrites.',
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function resolveConversationMemoryDistillRunnerPath(): string {
  return join(REPO_ROOT, 'packages/web/dist-server/distillConversationMemoryRun.js');
}

function resolveConversationMemoryDistillBatchRecoveryRunnerPath(): string {
  return join(REPO_ROOT, 'packages/web/dist-server/recoverConversationMemoryDistillRuns.js');
}

async function startConversationMemoryDistillRun(input: ConversationMemoryDistillRunInput) {
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
    tags: input.tags,
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
      ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
      emitActivity: input.emitActivity ?? false,
    },
  });
}

async function startConversationMemoryDistillBatchRecoveryRun(input: { profile: string; runIds: string[] }) {
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

async function maybeStartAutomaticConversationMemoryDistill(input: {
  conversationId: string;
  sessionFile: string;
  title?: string;
  cwd?: string;
  trigger: Exclude<ConversationMemoryMaintenanceTrigger, 'manual'>;
}): Promise<void> {
  if (isConversationMemoryDistillRecoveryTitle(input.title)) {
    return;
  }

  const profile = getCurrentProfile();
  const relatedProjectIds = getConversationMemoryRelatedProjectIds(profile, input.conversationId);
  const prepared = prepareConversationMemoryMaintenance({
    profile,
    conversationId: input.conversationId,
    sessionFile: input.sessionFile,
    conversationTitle: input.title,
    cwd: input.cwd,
    relatedProjectIds,
    trigger: input.trigger,
    mode: 'auto',
  });

  if (!prepared.shouldStartRun) {
    return;
  }

  const existing = await readConversationMemoryDistillRunState(input.conversationId);
  if (existing.running) {
    return;
  }

  const result = await startConversationMemoryDistillRun({
    conversationId: input.conversationId,
    profile,
    checkpointId: prepared.checkpoint.checkpointId,
    mode: 'auto',
    trigger: input.trigger,
    emitActivity: true,
  });

  if (!result.accepted || !result.runId) {
    const error = result.reason ?? 'Could not start conversation node distillation.';
    markConversationMemoryMaintenanceRunFailed({
      profile,
      conversationId: input.conversationId,
      checkpointId: prepared.checkpoint.checkpointId,
      error,
    });
    tryWriteConversationMemoryDistillFailureActivity({
      profile,
      conversationId: input.conversationId,
      error,
      relatedProjectIds,
    });
    return;
  }

  markConversationMemoryMaintenanceRunStarted({
    profile,
    conversationId: input.conversationId,
    checkpointId: prepared.checkpoint.checkpointId,
    runId: result.runId,
  });
}

async function maybeKickConversationMemoryFollowUp(profile: string, conversationId: string): Promise<void> {
  const state = readConversationMemoryMaintenanceState({ profile, conversationId });
  if (!state || state.status !== 'pending' || !state.autoPromotionEligible) {
    return;
  }

  if (isConversationMemoryDistillRecoveryTitle(state.latestConversationTitle)) {
    return;
  }

  const existing = await readConversationMemoryDistillRunState(conversationId);
  if (existing.running) {
    return;
  }

  const result = await startConversationMemoryDistillRun({
    conversationId,
    profile,
    checkpointId: state.latestCheckpointId,
    mode: state.latestMode,
    trigger: state.latestTrigger,
    emitActivity: true,
  });

  if (!result.accepted || !result.runId) {
    const error = result.reason ?? 'Could not start conversation node distillation.';
    markConversationMemoryMaintenanceRunFailed({
      profile,
      conversationId,
      checkpointId: state.latestCheckpointId,
      error,
    });
    tryWriteConversationMemoryDistillFailureActivity({
      profile,
      conversationId,
      error,
    });
    return;
  }

  markConversationMemoryMaintenanceRunStarted({
    profile,
    conversationId,
    checkpointId: state.latestCheckpointId,
    runId: result.runId,
  });
}

async function listMemoryWorkItems(): Promise<MemoryWorkItem[]> {
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

function findCurrentProfileTask(taskId: string) {
  try {
    return resolveScheduledTaskForProfile(getCurrentProfile(), taskId);
  } catch (error) {
    if (error instanceof Error && error.message === `Task not found: ${taskId}`) {
      return undefined;
    }

    throw error;
  }
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

function listConversationSessionsSnapshot() {
  const profile = getCurrentProfile();
  const deferredResumesBySessionFile = listDeferredResumeSummariesBySessionFile();
  const jsonl = decorateSessionsWithAttention(profile, listSessions(), deferredResumesBySessionFile);
  const live = listAllLiveSessions();
  const liveById = new Map(live.map((entry) => [entry.id, entry]));
  const jsonlIds = new Set(jsonl.map((session) => session.id));
  const syntheticLive = live
    .filter((entry) => !jsonlIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      file: entry.sessionFile,
      timestamp: new Date().toISOString(),
      cwd: entry.cwd,
      cwdSlug: entry.cwd.replace(/\//g, '-'),
      model: '',
      title: entry.title || 'New Conversation',
      messageCount: 0,
      isRunning: entry.isStreaming,
      isLive: true,
      lastActivityAt: new Date().toISOString(),
      needsAttention: false,
      attentionUnreadMessageCount: 0,
      attentionUnreadActivityCount: 0,
      attentionActivityIds: [],
      deferredResumes: deferredResumesBySessionFile.get(entry.sessionFile) ?? [],
    }));

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

    if (session.isLive) {
      live.push(session);
      continue;
    }

    if (session.needsAttention) {
      needsReview.push(session);
      continue;
    }

    if (workspaceSessionIdSet.has(session.id)) {
      active.push(session);
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
  tags?: string[];
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

function buildDefaultDistilledTags(input: {
  requestedTags?: string[];
  relatedProjectIds: string[];
}): string[] {
  const tags = [
    'conversation',
    'checkpoint',
    ...input.relatedProjectIds.map((projectId) => normalizeDistilledTag(projectId)).filter((value): value is string => Boolean(value)),
    ...((Array.isArray(input.requestedTags) ? input.requestedTags : [])
      .map((tag) => (typeof tag === 'string' ? normalizeDistilledTag(tag) : null))
      .filter((value): value is string => Boolean(value))),
  ];

  return [...new Set(tags)].slice(0, 12);
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
    tags: buildDefaultDistilledTags({
      requestedTags: options.tags,
      relatedProjectIds: options.relatedProjectIds,
    }),
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
    tags: string[];
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
      tags: string[];
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
  tags?: string[];
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

async function distillConversationMemoryNow(input: DistillConversationMemoryNowInput): Promise<DistillConversationMemoryNowResult> {
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
    tags: input.tags,
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
    const state = markConversationMemoryMaintenanceRunCompleted({
      profile: input.profile,
      conversationId: input.conversationId,
      checkpointId: normalizedCheckpointId,
      memoryId: memory.id,
      referencePath: memory.reference.relativePath,
    });
    if (input.mode === 'auto' && state.status === 'pending') {
      await maybeKickConversationMemoryFollowUp(input.profile, input.conversationId);
    }
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

  const timeline: ProjectTimelineEntry[] = [];

  if (detail.brief) {
    timeline.push({
      id: `brief:${detail.project.id}`,
      kind: 'brief',
      createdAt: detail.brief.updatedAt,
      title: 'Project handoff doc updated',
      description: detail.brief.content.split('\n').find((line) => line.trim().length > 0)?.trim(),
      href: '#project-handoff',
    });
  }

  for (const note of detail.notes) {
    timeline.push({
      id: `note:${note.id}`,
      kind: 'note',
      createdAt: note.updatedAt,
      title: note.title,
      description: note.body.replace(/\s+/g, ' ').trim() || undefined,
      href: `#project-note-${note.id}`,
    });
  }

  for (const file of detail.attachments) {
    timeline.push({
      id: `attachment:${file.id}`,
      kind: 'attachment',
      createdAt: file.updatedAt,
      title: file.title,
      description: file.description ?? file.originalName,
      href: file.downloadPath,
    });
  }

  for (const file of detail.artifacts) {
    timeline.push({
      id: `artifact:${file.id}`,
      kind: 'artifact',
      createdAt: file.updatedAt,
      title: file.title,
      description: file.description ?? file.originalName,
      href: file.downloadPath,
    });
  }

  for (const conversation of detail.linkedConversations) {
    timeline.push({
      id: `conversation:${conversation.conversationId}`,
      kind: 'conversation',
      createdAt: conversation.lastActivityAt ?? '',
      title: conversation.title,
      description: conversation.snippet,
      href: `/conversations/${encodeURIComponent(conversation.conversationId)}`,
    });
  }

  for (const activity of activityEntries) {
    timeline.push({
      id: `activity:${activity.id}`,
      kind: 'activity',
      createdAt: activity.createdAt,
      title: activity.summary,
      description: activity.details,
      href: '/inbox',
    });
  }

  return timeline
    .filter((entry) => entry.createdAt.length > 0)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
  const enriched: ProjectDetailWithProfile = {
    ...detail,
    profile,
    links: readNodeLinksForProfile('project', detail.project.id, profile),
    project: annotateProjectRecord(detail.project, profile),
    attachments: applyProjectProfile(detail.attachments, profile),
    artifacts: applyProjectProfile(detail.artifacts, profile),
    linkedConversations,
    timeline: [],
  };
  enriched.timeline = buildProjectTimeline(enriched, profile);
  return enriched;
}

let processingDeferredResumes = false;

async function flushLiveDeferredResumes(): Promise<void> {
  if (processingDeferredResumes) {
    return;
  }

  processingDeferredResumes = true;

  try {
    // Server-side deferred resume delivery only injects prompts into conversations that are
    // already live. The web client may auto-resume an open saved conversation first, then
    // call back into this same flush path to deliver the due prompts.
    const liveSessions = listAllLiveSessions().filter((session) => session.sessionFile);
    if (liveSessions.length === 0) {
      return;
    }

    const now = new Date();
    const daemonRoot = resolveDaemonRoot();
    let mutated = false;

    for (const session of liveSessions) {
      const activated = activateDueDeferredResumesForSessionFile({
        at: now,
        sessionFile: session.sessionFile,
      });
      if (activated.length > 0) {
        mutated = true;
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
      invalidateAppTopics('sessions');
    }
  } finally {
    processingDeferredResumes = false;
  }
}

function startDeferredResumeLoop(): void {
  void flushLiveDeferredResumes().catch((error) => {
    logWarn(`Deferred resume loop failed: ${(error as Error).message}`);
  });

  setInterval(() => {
    void flushLiveDeferredResumes().catch((error) => {
      logWarn(`Deferred resume loop failed: ${(error as Error).message}`);
    });
  }, DEFERRED_RESUME_POLL_MS);
}

function startConversationRecovery(): void {
  void recoverDurableLiveConversations({
    isLive: isLocalLive,
    resumeSession: resumeLocalSession,
    queuePromptContext,
    promptSession: promptLocalSession,
    loaderOptions: {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    },
    logger: {
      info: (message) => logInfo(message),
      warn: (message) => logWarn(message),
    },
  }).then(async (result) => {
    if (result.recovered.length > 0) {
      logInfo(`Recovered ${String(result.recovered.length)} live conversation runs from durable state.`);
      await flushLiveDeferredResumes();
    }
  }).catch((error) => {
    logWarn(`Conversation recovery failed: ${(error as Error).message}`);
  });
}

startDeferredResumeLoop();
startConversationRecovery();
startInboxCullLoop();

async function buildSnapshotEventsForTopic(topic: AppEventTopic): Promise<unknown[]> {
  switch (topic) {
    case 'activity': {
      const snapshot = getActivitySnapshotForCurrentProfile();
      return [{ type: 'activity_snapshot' as const, entries: snapshot.entries, unreadCount: snapshot.unreadCount }];
    }
    case 'alerts': {
      const snapshot = getAlertSnapshotForProfile(getCurrentProfile());
      return [{ type: 'alerts_snapshot' as const, entries: snapshot.entries, activeCount: snapshot.activeCount }];
    }
    case 'projects':
      return [{ type: 'projects_snapshot' as const, projects: listProjectsForCurrentProfile() }];
    case 'sessions':
      return [{ type: 'sessions_snapshot' as const, sessions: listConversationSessionsSnapshot() }];
    case 'tasks':
      return [{ type: 'tasks_snapshot' as const, tasks: listTasksForCurrentProfile() }];
    case 'runs':
      return [{ type: 'runs_snapshot' as const, result: await listDurableRuns() }];
    case 'daemon':
      return [{ type: 'daemon_snapshot' as const, state: await readDaemonState() }];
    case 'sync':
      return [{ type: 'sync_snapshot' as const, state: await readSyncState() }];
    case 'webUi':
      return [{ type: 'web_ui_snapshot' as const, state: readWebUiState() }];
    default:
      return [];
  }
}

const COMPANION_EVENT_TOPICS = new Set<AppEventTopic>(['activity', 'alerts', 'projects', 'sessions']);

async function emitSnapshotEvents(topics: AppEventTopic[], writeEvent: (event: unknown) => void) {
  await streamSnapshotEvents(topics, {
    buildEvents: buildSnapshotEventsForTopic,
    writeEvent,
  });
}

async function emitCompanionSnapshotEvents(topics: AppEventTopic[], writeEvent: (event: unknown) => void) {
  await streamSnapshotEvents(topics.filter((topic) => COMPANION_EVENT_TOPICS.has(topic)), {
    buildEvents: buildSnapshotEventsForTopic,
    writeEvent,
  });
}

function writeSseHeaders(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function readCookieValue(req: Request, cookieName: string): string {
  const cookieHeader = req.headers.cookie;
  if (typeof cookieHeader !== 'string' || cookieHeader.trim().length === 0) {
    return '';
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...valueParts] = pair.split('=');
    if (rawName?.trim() !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join('=').trim());
  }

  return '';
}

function shouldUseSecureAuthCookie(req: Request): boolean {
  const origin = resolveRequestOrigin({
    host: req.get('host'),
    forwardedHost: req.get('x-forwarded-host'),
    protocol: req.protocol,
    forwardedProto: req.get('x-forwarded-proto'),
  });

  return origin?.startsWith('https://') === true;
}

function normalizeAuthHost(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return '';
  }

  const token = value.split(',')[0]?.trim().toLowerCase() ?? '';
  return token.replace(/^\[/, '').replace(/\]$/, '').replace(/:\d+$/, '');
}

function isTailnetDesktopRequest(req: Request): boolean {
  const host = normalizeAuthHost(req.get('x-forwarded-host') ?? req.get('host') ?? null);
  if (host.endsWith('.ts.net')) {
    return true;
  }

  return ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-app-capabilities']
    .some((headerName) => typeof req.get(headerName) === 'string' && req.get(headerName)!.trim().length > 0);
}

function setDesktopSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(DESKTOP_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearDesktopSessionCookie(req: Request, res: Response): void {
  res.clearCookie(DESKTOP_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
  });
}

function readDesktopSession(req: Request, res: Response): ReturnType<typeof readCompanionSession> {
  const sessionToken = readCookieValue(req, DESKTOP_SESSION_COOKIE);
  const session = readCompanionSession(sessionToken, { surface: 'desktop' });
  if (!session) {
    clearDesktopSessionCookie(req, res);
    return null;
  }

  return session;
}

function ensureDesktopSession(req: Request, res: Response): ReturnType<typeof readCompanionSession> {
  const session = readDesktopSession(req, res);
  if (!session) {
    res.status(401).json({ error: 'Desktop sign-in required.' });
    return null;
  }

  return session;
}

function shouldRequireDesktopSession(req: Request): boolean {
  return isTailnetDesktopRequest(req);
}

function setCompanionSessionCookie(req: Request, res: Response, token: string): void {
  res.cookie(COMPANION_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

function clearCompanionSessionCookie(req: Request, res: Response): void {
  res.clearCookie(COMPANION_SESSION_COOKIE, {
    httpOnly: true,
    sameSite: 'strict',
    secure: shouldUseSecureAuthCookie(req),
    path: '/',
  });
}

function ensureCompanionSession(req: Request, res: Response): ReturnType<typeof readCompanionSession> {
  const sessionToken = readCookieValue(req, COMPANION_SESSION_COOKIE);
  const session = readCompanionSession(sessionToken, { surface: 'companion' });
  if (!session) {
    clearCompanionSessionCookie(req, res);
    res.status(401).json({ error: 'Companion sign-in required.' });
    return null;
  }

  return session;
}

function listCompanionReadableMarkdownPaths(profile: string): Set<string> {
  return new Set([
    ...listSkillsForProfile(profile).map((entry) => normalize(entry.path)),
    ...listMemoryDocs().map((entry) => normalize(entry.path)),
  ]);
}

const DIST_DIR =
  process.env.PA_WEB_DIST ??
  join(dirname(fileURLToPath(import.meta.url)), '../dist');
const COMPANION_DIST_DIR = join(DIST_DIR, 'app');
const DIST_ASSETS_DIR = join(DIST_DIR, 'assets');

const app = express();
const companionApp = express();

for (const serverApp of [app, companionApp]) {
  serverApp.set('etag', false);
  serverApp.set('trust proxy', true);
  serverApp.use(applyWebSecurityHeaders);
  serverApp.use(express.json({ limit: '25mb' }));
  serverApp.use(webRequestLoggingMiddleware);
  serverApp.use(enforceSameOriginUnsafeRequests);
}

companionApp.use('/app/api', (req, _res, next) => {
  req.url = `/api${req.url}`;
  next();
});

const companionAuthExchangeRateLimit = createInMemoryRateLimit({
  windowMs: 60_000,
  maxRequests: 10,
  key: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  message: 'Too many pairing attempts. Try again in a minute.',
});

startAppEventMonitor({
  repoRoot: REPO_ROOT,
  sessionsDir: SESSIONS_DIR,
  taskStateFile: TASK_STATE_FILE,
  profileConfigFile: PROFILE_CONFIG_FILE,
  getCurrentProfile,
});

subscribeProviderOAuthLogins((login) => {
  if (login.status === 'completed') {
    reloadAllLiveSessionAuth();
  }
});

createServiceAttentionMonitor({
  repoRoot: REPO_ROOT,
  stateRoot: resolveDaemonRoot(),
  getCurrentProfile,
  readDaemonState,
  logger: {
    warn: (message, fields) => logWarn(message, fields),
  },
}).start();

app.get('/api/desktop-auth/session', (req, res) => {
  const required = shouldRequireDesktopSession(req);
  if (!required) {
    res.json({ required: false, session: null });
    return;
  }

  const session = readDesktopSession(req, res);
  res.json({ required: true, session });
});

app.post('/api/desktop-auth/exchange', companionAuthExchangeRateLimit, (req, res) => {
  try {
    const { code, deviceLabel } = req.body as { code?: unknown; deviceLabel?: unknown };
    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Pairing code required.' });
      return;
    }

    const exchanged = exchangeCompanionPairingCode(code, {
      ...(typeof deviceLabel === 'string' ? { deviceLabel } : {}),
      surface: 'desktop',
    });
    setDesktopSessionCookie(req, res, exchanged.sessionToken);
    res.status(201).json({ required: true, session: exchanged.session });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('invalid or expired') ? 400 : 500).json({ error: message });
  }
});

app.post('/api/desktop-auth/logout', (req, res) => {
  revokeCompanionSessionByToken(readCookieValue(req, DESKTOP_SESSION_COOKIE));
  clearDesktopSessionCookie(req, res);
  res.json({ ok: true });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/desktop-auth/session' || req.path === '/desktop-auth/exchange' || req.path === '/desktop-auth/logout') {
    next();
    return;
  }

  if (!shouldRequireDesktopSession(req)) {
    next();
    return;
  }

  if (!ensureDesktopSession(req, res)) {
    return;
  }

  next();
});

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  let closed = false;
  let writeQueue = Promise.resolve();

  const writeEvent = (event: unknown) => {
    if (closed) {
      return;
    }

    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const enqueueWrite = (task: () => Promise<void> | void) => {
    writeQueue = writeQueue
      .then(async () => {
        if (closed) {
          return;
        }

        await task();
      })
      .catch((error) => {
        logWarn('app event stream write failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const writeSnapshotEvents = async (topics: AppEventTopic[]) => {
    await emitSnapshotEvents(topics, writeEvent);
  };

  writeEvent({ type: 'connected' });
  enqueueWrite(async () => {
    await writeSnapshotEvents(['sessions', 'activity', 'projects', 'tasks', 'daemon', 'sync', 'webUi', 'runs']);
  });

  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(': heartbeat\n\n');
    }
  }, 15_000);
  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === 'invalidate') {
      enqueueWrite(async () => {
        await writeSnapshotEvents(event.topics);
        writeEvent(event);
      });
      return;
    }

    writeEvent(event);
  });

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

// ── Profiles ────────────────────────────────────────────────────────────────

app.get('/api/profiles', (_req, res) => {
  try {
    res.json({
      currentProfile: getCurrentProfile(),
      profiles: listAvailableProfiles(),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/profiles/current', async (req, res) => {
  try {
    const { profile } = req.body as { profile?: string };
    if (!profile) { res.status(400).json({ error: 'profile required' }); return; }
    res.json({ ok: true, currentProfile: await setCurrentProfile(profile) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unknown profile:') ? 400 : 500;
    res.status(status).json({ error: message });
  }
});

// ── Status ──────────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const activities = listActivityForProfile(profile);
    const projectIds = listProjectIds({ repoRoot: REPO_ROOT, profile });
    res.json({
      profile,
      repoRoot: REPO_ROOT,
      activityCount: activities.length,
      projectCount: projectIds.length,
      webUiSlot: process.env.PERSONAL_AGENT_WEB_SLOT,
      webUiRevision: process.env.PERSONAL_AGENT_WEB_REVISION,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/application/restart', (_req, res) => {
  try {
    res.status(202).json(requestApplicationRestart({ repoRoot: REPO_ROOT, profile: getCurrentProfile() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Application restart already in progress') || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/application/update', (_req, res) => {
  try {
    res.status(202).json(requestApplicationUpdate({ repoRoot: REPO_ROOT, profile: getCurrentProfile() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Application restart already in progress') || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

// ── Daemon ───────────────────────────────────────────────────────────────────

app.get('/api/daemon', async (_req, res) => {
  try {
    res.json(await readDaemonState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/install', async (_req, res) => {
  try {
    suppressMonitoredServiceAttention('daemon');
    const state = await installDaemonServiceAndReadState();
    invalidateAppTopics('daemon', 'sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/start', async (_req, res) => {
  try {
    suppressMonitoredServiceAttention('daemon');
    const state = await startDaemonServiceAndReadState();
    invalidateAppTopics('daemon', 'sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/restart', async (_req, res) => {
  try {
    suppressMonitoredServiceAttention('daemon');
    const state = await restartDaemonServiceAndReadState();
    invalidateAppTopics('daemon', 'sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/stop', async (_req, res) => {
  try {
    suppressMonitoredServiceAttention('daemon');
    const state = await stopDaemonServiceAndReadState();
    invalidateAppTopics('daemon', 'sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/uninstall', async (_req, res) => {
  try {
    suppressMonitoredServiceAttention('daemon');
    const state = await uninstallDaemonServiceAndReadState();
    invalidateAppTopics('daemon', 'sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Sync ─────────────────────────────────────────────────────────────────────

app.get('/api/sync', async (_req, res) => {
  try {
    res.json(await readSyncState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/sync/run', async (_req, res) => {
  try {
    const state = await requestSyncRunAndReadState();
    invalidateAppTopics('sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/sync/setup', async (req, res) => {
  let input: ReturnType<typeof parseSyncSetupInput>;

  try {
    input = parseSyncSetupInput(req.body);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }

  try {
    const state = await setupSyncAndReadState(input);
    invalidateAppTopics('sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Web UI ───────────────────────────────────────────────────────────────────

app.get('/api/web-ui/state', (_req, res) => {
  try {
    res.json(readWebUiState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/install', (_req, res) => {
  try {
    const state = installWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/start', (_req, res) => {
  try {
    const state = startWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/restart', (_req, res) => {
  try {
    res.status(202).json(requestWebUiServiceRestart({ repoRoot: REPO_ROOT }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Managed web UI restart already in progress')
      || message.startsWith('Application restart already in progress')
      || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/web-ui/service/rollback', (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const snapshot = rollbackWebUiServiceAndReadState({ reason });
    invalidateAppTopics('webUi');
    try {
      writeInternalAttentionEntry({
        repoRoot: REPO_ROOT,
        stateRoot: resolveDaemonRoot(),
        profile: getCurrentProfile(),
        kind: 'deployment',
        summary: 'Web UI rollback complete.',
        details: [
          `Completed: ${new Date().toISOString()}`,
          snapshot.service.deployment?.activeSlot ? `Active slot: ${snapshot.service.deployment.activeSlot}` : undefined,
          snapshot.service.deployment?.activeRelease?.revision ? `Active release: ${snapshot.service.deployment.activeRelease.revision}` : undefined,
          reason ? `Reason: ${reason}` : undefined,
        ].filter((line): line is string => typeof line === 'string').join('\n'),
        idPrefix: 'web-ui-rollback',
      });
    } catch (activityError) {
      logWarn('failed to write web ui rollback activity', {
        message: activityError instanceof Error ? activityError.message : String(activityError),
      });
    }
    res.json(snapshot);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/mark-bad', (req, res) => {
  try {
    const slot = req.body?.slot === 'blue' || req.body?.slot === 'green'
      ? req.body.slot
      : undefined;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const snapshot = markBadWebUiReleaseAndReadState({ slot, reason });
    invalidateAppTopics('webUi');
    try {
      writeInternalAttentionEntry({
        repoRoot: REPO_ROOT,
        stateRoot: resolveDaemonRoot(),
        profile: getCurrentProfile(),
        kind: 'deployment',
        summary: 'Web UI release marked bad.',
        details: [
          `Completed: ${new Date().toISOString()}`,
          slot ? `Slot: ${slot}` : undefined,
          snapshot.service.deployment?.activeRelease?.revision ? `Active release: ${snapshot.service.deployment.activeRelease.revision}` : undefined,
          reason ? `Reason: ${reason}` : undefined,
        ].filter((line): line is string => typeof line === 'string').join('\n'),
        idPrefix: 'web-ui-mark-bad',
      });
    } catch (activityError) {
      logWarn('failed to write web ui mark-bad activity', {
        message: activityError instanceof Error ? activityError.message : String(activityError),
      });
    }
    res.json(snapshot);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/stop', (_req, res) => {
  try {
    const state = stopWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/uninstall', (_req, res) => {
  try {
    const state = uninstallWebUiServiceAndReadState();
    invalidateAppTopics('webUi');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Alerts / Activity / Inbox ───────────────────────────────────────────────

app.get('/api/alerts', (_req, res) => {
  try {
    res.json(getAlertSnapshotForProfile(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/alerts/:id', (req, res) => {
  try {
    const alert = getAlertForProfile(getCurrentProfile(), req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(alert);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/alerts/:id/ack', (req, res) => {
  try {
    const alert = acknowledgeAlertForProfile(getCurrentProfile(), req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('alerts');
    res.json({ ok: true, alert });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/alerts/:id/dismiss', (req, res) => {
  try {
    const alert = dismissAlertForProfile(getCurrentProfile(), req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('alerts');
    res.json({ ok: true, alert });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/alerts/:id/snooze', async (req, res) => {
  try {
    const { delay, at } = req.body as { delay?: string; at?: string };
    const result = await snoozeAlertForProfile(getCurrentProfile(), req.params.id, { delay, at });
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('alerts', 'sessions', 'runs');
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

app.post('/api/inbox/clear', (_req, res) => {
  try {
    const result = clearInboxForCurrentProfile();
    res.json({
      ok: true,
      deletedActivityIds: result.deletedActivityIds,
      clearedConversationIds: result.clearedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/activity', (_req, res) => {
  try {
    res.json(listActivityForCurrentProfile());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/activity/count', (_req, res) => {
  try {
    res.json({ count: getActivitySnapshotForCurrentProfile().unreadCount });
  } catch {
    res.json({ count: 0 });
  }
});

app.get('/api/activity/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const match = findActivityRecord(profile, req.params.id);
    if (!match) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({ ...match.entry, read: match.read });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/activity/:id/start', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const match = findActivityRecord(profile, req.params.id);

    if (!match) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const entry = match.entry;
    const requestedRelatedProjectIds = Array.isArray(entry.relatedProjectIds)
      ? entry.relatedProjectIds.filter((projectId): projectId is string => typeof projectId === 'string' && projectId.trim().length > 0)
      : [];
    const availableProjectIds = new Set(listReferenceableProjectIds());
    const relatedProjectIds = requestedRelatedProjectIds.filter((projectId) => availableProjectIds.has(projectId));
    const cwd = resolveConversationCwd({
      repoRoot: REPO_ROOT,
      profile,
      defaultCwd: getDefaultWebCwd(),
      referencedProjectIds: relatedProjectIds,
    });
    const result = await createLocalSession(cwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });

    if (relatedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds,
      });
    }

    const relatedConversationIds = [...new Set([...(entry.relatedConversationIds ?? []), result.id])];
    setActivityConversationLinks({
      stateRoot: match.stateRoot,
      profile,
      activityId: entry.id,
      relatedConversationIds,
    });

    await queuePromptContext(result.id, 'referenced_context', buildInboxActivityConversationContext({
      ...entry,
      relatedProjectIds,
      relatedConversationIds,
    }));

    invalidateAppTopics('activity', 'projects', 'sessions');
    res.json({
      activityId: entry.id,
      id: result.id,
      sessionFile: result.sessionFile,
      cwd,
      relatedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

/** Mark an activity item as read */
app.patch('/api/activity/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const { id } = req.params;
    const { read } = req.body as { read?: boolean };
    const changed = markActivityReadState(profile, id, read !== false);
    if (!changed) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    invalidateAppTopics('activity');
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Models ────────────────────────────────────────────────────────────────────

const BUILT_IN_MODELS = [
  // Anthropic
  { id: 'claude-opus-4-6',    provider: 'anthropic',    name: 'Claude Opus 4.6',     context: 200_000 },
  { id: 'claude-sonnet-4-6',  provider: 'anthropic',    name: 'Claude Sonnet 4.6',   context: 200_000 },
  { id: 'claude-haiku-4-6',   provider: 'anthropic',    name: 'Claude Haiku 4.6',    context: 200_000 },
  // OpenAI / Codex
  { id: 'gpt-5.4',            provider: 'openai-codex', name: 'GPT-5.4',             context: 128_000 },
  { id: 'gpt-5.2',            provider: 'openai-codex', name: 'GPT-5.2',             context: 128_000 },
  { id: 'gpt-5.1-codex-mini', provider: 'openai-codex', name: 'GPT-5.1 Codex Mini',  context: 128_000 },
  { id: 'gpt-4o',             provider: 'openai',       name: 'GPT-4o',              context: 128_000 },
  // Google
  { id: 'gemini-2.5-pro',     provider: 'google',       name: 'Gemini 2.5 Pro',      context: 1_000_000 },
  { id: 'gemini-3.1-pro-high',provider: 'google',       name: 'Gemini 3.1 Pro High', context: 1_000_000 },
];

function listAvailableModelDefinitions() {
  let models = BUILT_IN_MODELS;

  try {
    const live = getAvailableModels();
    if (live.length > 0) {
      models = live;
    }
  } catch {
    // Fall back to the built-in list when the registry is unavailable.
  }

  return models;
}

async function buildConversationAutomationResponse(conversationId: string) {
  const profile = getCurrentProfile();
  const loaded = loadConversationAutomationState({
    profile,
    conversationId,
    settingsFile: SETTINGS_FILE,
  });
  const automation = loaded.document;
  const skills = listSkillsForCurrentProfile().map((skill) => ({
    name: skill.name,
    description: skill.description,
    source: skill.source,
  }));

  return {
    conversationId,
    live: liveRegistry.has(conversationId),
    inheritedPresetIds: loaded.inheritedPresetIds,
    automation: {
      conversationId: automation.conversationId,
      enabled: automation.enabled,
      activeItemId: automation.activeItemId ?? null,
      updatedAt: automation.updatedAt,
      ...(automation.waitingForUser ? {
        waitingForUser: {
          createdAt: automation.waitingForUser.createdAt,
          updatedAt: automation.waitingForUser.updatedAt,
          ...(automation.waitingForUser.reason ? { reason: automation.waitingForUser.reason } : {}),
        },
      } : {}),
      items: automation.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        ...('text' in item
          ? {
            text: item.text,
          }
          : {
            skillName: item.skillName,
            ...(item.skillArgs ? { skillArgs: item.skillArgs } : {}),
          }),
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(item.startedAt ? { startedAt: item.startedAt } : {}),
        ...(item.completedAt ? { completedAt: item.completedAt } : {}),
        ...(item.resultReason ? { resultReason: item.resultReason } : {}),
      })),
      ...(automation.review ? {
        review: {
          status: automation.review.status,
          round: automation.review.round,
          createdAt: automation.review.createdAt,
          updatedAt: automation.review.updatedAt,
          ...(automation.review.startedAt ? { startedAt: automation.review.startedAt } : {}),
          ...(automation.review.completedAt ? { completedAt: automation.review.completedAt } : {}),
          ...(automation.review.resultReason ? { resultReason: automation.review.resultReason } : {}),
        },
      } : {}),
    },
    presetLibrary: loaded.presetLibrary,
    skills,
  };
}

function saveConversationAutomationDocument(document: Parameters<typeof writeConversationAutomationState>[0]['document']) {
  const saved = writeConversationAutomationState({
    profile: getCurrentProfile(),
    document,
  });
  notifyConversationAutomationChanged(document.conversationId);
  return saved;
}

function migrateDraftConversationPlan(profile: string, conversationId: string): void {
  const draftConversationId = 'new';
  const draftPath = resolveConversationAutomationPath({ profile, conversationId: draftConversationId });
  const loaded = loadConversationAutomationState({
    profile,
    conversationId: draftConversationId,
    settingsFile: SETTINGS_FILE,
  });

  if (loaded.document.items.length > 0) {
    writeConversationAutomationState({
      profile,
      document: {
        ...loaded.document,
        conversationId,
        updatedAt: new Date().toISOString(),
        enabled: true,
        activeItemId: undefined,
        review: undefined,
      },
    });
  }

  if (existsSync(draftPath)) {
    rmSync(draftPath, { force: true });
  }

  notifyConversationAutomationChanged(conversationId);
}

function validateConversationAutomationTemplateItems(items: unknown, availableSkillNames: Set<string>): asserts items is Array<{
  id: string;
  label?: string;
  kind?: 'skill' | 'instruction';
  skillName?: string;
  skillArgs?: string;
  text?: string;
}> {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Each item must be an object.');
    }

    const explicitKind = typeof (item as { kind?: unknown }).kind === 'string'
      ? (item as { kind: string }).kind.trim()
      : '';
    if (explicitKind && explicitKind !== 'skill' && explicitKind !== 'instruction') {
      throw new Error('Each item kind must be skill or instruction.');
    }

    const text = typeof (item as { text?: unknown }).text === 'string'
      ? (item as { text: string }).text.trim()
      : '';
    const skillName = typeof (item as { skillName?: unknown }).skillName === 'string'
      ? (item as { skillName: string }).skillName.trim()
      : '';
    const kind = explicitKind === 'instruction' || (!explicitKind && text && !skillName)
      ? 'instruction'
      : 'skill';

    if (kind === 'instruction') {
      if (!text) {
        throw new Error('Each instruction item requires text.');
      }
      continue;
    }

    if (!skillName) {
      throw new Error('Each skill item requires a skillName.');
    }
    if (!availableSkillNames.has(skillName)) {
      throw new Error(`Unknown skill: ${skillName}`);
    }
  }
}

function validateConversationAutomationWorkflowPresets(
  presets: unknown,
  defaultPresetIds: unknown,
  availableSkillNames: Set<string>,
): asserts presets is Array<{
  id: string;
  name: string;
  items: Array<{
    id: string;
    label?: string;
    kind?: 'skill' | 'instruction';
    skillName?: string;
    skillArgs?: string;
    text?: string;
  }>;
}> {
  if (!Array.isArray(presets)) {
    throw new Error('presets must be an array');
  }

  const presetIds = new Set<string>();
  for (const preset of presets) {
    if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
      throw new Error('Each preset must be an object.');
    }

    const id = typeof (preset as { id?: unknown }).id === 'string'
      ? (preset as { id: string }).id.trim()
      : '';
    if (!id) {
      throw new Error('Each preset requires an id.');
    }
    if (presetIds.has(id)) {
      throw new Error(`Duplicate preset id: ${id}`);
    }
    presetIds.add(id);

    const name = typeof (preset as { name?: unknown }).name === 'string'
      ? (preset as { name: string }).name.trim()
      : '';
    if (!name) {
      throw new Error('Each preset requires a name.');
    }

    const items = (preset as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('Each preset requires at least one item.');
    }
    validateConversationAutomationTemplateItems(items, availableSkillNames);
  }

  if (defaultPresetIds !== null && defaultPresetIds !== undefined) {
    if (!Array.isArray(defaultPresetIds)) {
      throw new Error('defaultPresetIds must be an array');
    }

    const seenDefaultPresetIds = new Set<string>();
    for (const presetId of defaultPresetIds) {
      const normalizedPresetId = typeof presetId === 'string' ? presetId.trim() : '';
      if (!normalizedPresetId) {
        throw new Error('Each default preset id must be a non-empty string.');
      }
      if (!presetIds.has(normalizedPresetId)) {
        throw new Error(`Default preset not found: ${normalizedPresetId}`);
      }
      if (seenDefaultPresetIds.has(normalizedPresetId)) {
        throw new Error(`Duplicate default preset id: ${normalizedPresetId}`);
      }
      seenDefaultPresetIds.add(normalizedPresetId);
    }
  }
}

app.get('/api/models', (_req, res) => {
  try {
    const saved = readSavedModelPreferences(SETTINGS_FILE);
    const models = listAvailableModelDefinitions();
    const currentModel = saved.currentModel || models[0]?.id || '';
    res.json({
      currentModel,
      currentThinkingLevel: saved.currentThinkingLevel,
      models,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/models/current', (req, res) => {
  try {
    const { model, thinkingLevel } = req.body as { model?: string; thinkingLevel?: string };
    if (typeof model !== 'string' && typeof thinkingLevel !== 'string') {
      res.status(400).json({ error: 'model or thinkingLevel required' });
      return;
    }

    const availableModels = listAvailableModelDefinitions();
    persistSettingsWrite((settingsFile) => {
      writeSavedModelPreferences({ model, thinkingLevel }, settingsFile, availableModels);
    }, {
      runtimeSettingsFile: SETTINGS_FILE,
    });

    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/default-cwd', (_req, res) => {
  try {
    res.json(readSavedDefaultCwdPreferences(SETTINGS_FILE, PROCESS_CWD));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/default-cwd', (req, res) => {
  try {
    const { cwd } = req.body as { cwd?: string | null };
    if (cwd !== null && typeof cwd !== 'string') {
      res.status(400).json({ error: 'cwd must be a string or null' });
      return;
    }

    const saved = persistSettingsWrite(
      (settingsFile) => writeSavedDefaultCwdPreference({ cwd }, settingsFile, {
        baseDir: PROCESS_CWD,
        validate: true,
      }),
      {
        runtimeSettingsFile: SETTINGS_FILE,
      },
    );

    res.json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'cwd required' || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/provider-auth', (_req, res) => {
  try {
    res.json(readProviderAuthState(AUTH_FILE));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/provider-auth/openai-codex/usage', async (_req, res) => {
  try {
    res.json(await readCodexPlanUsage(AUTH_FILE));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({
      available: true,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

app.patch('/api/provider-auth/:provider/api-key', (req, res) => {
  try {
    const { provider } = req.params;
    const { apiKey } = req.body as { apiKey?: string };

    if (!provider || provider.trim().length === 0) {
      res.status(400).json({ error: 'provider required' });
      return;
    }

    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      res.status(400).json({ error: 'apiKey required' });
      return;
    }

    const state = setProviderApiKey(AUTH_FILE, provider, apiKey);
    reloadAllLiveSessionAuth();
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/provider-auth/:provider', (req, res) => {
  try {
    const { provider } = req.params;
    if (!provider || provider.trim().length === 0) {
      res.status(400).json({ error: 'provider required' });
      return;
    }

    const state = removeProviderCredential(AUTH_FILE, provider);
    reloadAllLiveSessionAuth();
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/provider-auth/:provider/oauth/start', (req, res) => {
  try {
    const { provider } = req.params;
    if (!provider || provider.trim().length === 0) {
      res.status(400).json({ error: 'provider required' });
      return;
    }

    const login = startProviderOAuthLogin(AUTH_FILE, provider);
    res.json(login);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/provider-auth/oauth/:loginId', (req, res) => {
  try {
    const { loginId } = req.params;
    if (!loginId || loginId.trim().length === 0) {
      res.status(400).json({ error: 'loginId required' });
      return;
    }

    const login = getProviderOAuthLoginState(loginId);
    if (!login) {
      res.status(404).json({ error: `OAuth login not found: ${loginId}` });
      return;
    }

    res.json(login);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/provider-auth/oauth/:loginId/events', (req, res) => {
  const loginId = req.params.loginId?.trim();
  if (!loginId) {
    res.status(400).json({ error: 'loginId required' });
    return;
  }

  const initial = getProviderOAuthLoginState(loginId);
  if (!initial) {
    res.status(404).json({ error: `OAuth login not found: ${loginId}` });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 1000\n\n');

  const writeEvent = (event: { type: 'snapshot'; data: typeof initial }) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  writeEvent({ type: 'snapshot', data: initial });

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15_000);
  const unsubscribe = subscribeProviderOAuthLogin(loginId, (login) => {
    writeEvent({ type: 'snapshot', data: login });
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.post('/api/provider-auth/oauth/:loginId/input', (req, res) => {
  try {
    const { loginId } = req.params;
    const { value } = req.body as { value?: string };

    if (!loginId || loginId.trim().length === 0) {
      res.status(400).json({ error: 'loginId required' });
      return;
    }

    if (typeof value !== 'string') {
      res.status(400).json({ error: 'value must be a string' });
      return;
    }

    const login = submitProviderOAuthLoginInput(loginId, value);
    res.json(login);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/provider-auth/oauth/:loginId/cancel', (req, res) => {
  try {
    const { loginId } = req.params;

    if (!loginId || loginId.trim().length === 0) {
      res.status(400).json({ error: 'loginId required' });
      return;
    }

    const login = cancelProviderOAuthLogin(loginId);
    res.json(login);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversation-titles/settings', (_req, res) => {
  try {
    res.json(readSavedConversationTitlePreferences(SETTINGS_FILE));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/conversation-titles/settings', (req, res) => {
  try {
    const { enabled, model } = req.body as { enabled?: boolean; model?: string | null };
    if (typeof enabled !== 'boolean' && typeof model !== 'string' && model !== null) {
      res.status(400).json({ error: 'enabled or model required' });
      return;
    }

    const saved = persistSettingsWrite(
      (settingsFile) => writeSavedConversationTitlePreferences({ enabled, model }, settingsFile),
      { runtimeSettingsFile: SETTINGS_FILE },
    );

    res.json(saved);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversation-plans/defaults', (_req, res) => {
  try {
    res.json(readSavedConversationAutomationPreferences(SETTINGS_FILE));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/conversation-plans/defaults', (req, res) => {
  try {
    const { defaultEnabled } = req.body as { defaultEnabled?: unknown };
    if (typeof defaultEnabled !== 'boolean') {
      res.status(400).json({ error: 'defaultEnabled must be a boolean' });
      return;
    }

    writeSavedConversationAutomationPreferences({ defaultEnabled }, getCurrentProfileSettingsFile());
    clearLocalConversationAutomationSettingsOverride();
    materializeWebProfile(getCurrentProfile());
    invalidateAppTopics('automation');

    res.json(readSavedConversationAutomationPreferences(SETTINGS_FILE));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversation-plans/workspace', async (_req, res) => {
  try {
    res.json({
      presetLibrary: readSavedConversationAutomationWorkflowPresets(SETTINGS_FILE),
      skills: listSkillsForCurrentProfile().map((skill) => ({
        name: skill.name,
        description: skill.description,
        source: skill.source,
      })),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversation-plans/library', (_req, res) => {
  try {
    res.json(readSavedConversationAutomationWorkflowPresets(SETTINGS_FILE));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/conversation-plans/library', async (req, res) => {
  try {
    const { presets, defaultPresetIds } = req.body as {
      presets?: unknown;
      defaultPresetIds?: unknown;
    };
    const skillNames = new Set(listSkillsForCurrentProfile().map((skill) => skill.name));
    validateConversationAutomationWorkflowPresets(presets, defaultPresetIds, skillNames);

    writeSavedConversationAutomationWorkflowPresets({
      presets: presets as Parameters<typeof writeSavedConversationAutomationWorkflowPresets>[0]['presets'],
      defaultPresetIds: (Array.isArray(defaultPresetIds) ? defaultPresetIds.filter((presetId): presetId is string => typeof presetId === 'string') : []) as Parameters<typeof writeSavedConversationAutomationWorkflowPresets>[0]['defaultPresetIds'],
    }, getCurrentProfileSettingsFile());
    clearLocalConversationAutomationSettingsOverride();
    materializeWebProfile(getCurrentProfile());
    invalidateAppTopics('automation');

    res.json(readSavedConversationAutomationWorkflowPresets(SETTINGS_FILE));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unknown skill:')
      || message.includes('items must be an array')
      || message.includes('Each item')
      || message.includes('Each skill item')
      || message.includes('Each instruction item')
      || message.includes('presets must be an array')
      || message.includes('Each preset')
      || message.includes('Duplicate preset id:')
      || message.includes('defaultPresetIds must be an array')
      || message.includes('Each default preset id must be a non-empty string.')
      || message.includes('Duplicate default preset id:')
      || message.includes('Default preset not found:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/tools', async (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const details = await withTemporaryProfileAgentDir(profile, async (agentDir) => inspectAvailableTools(REPO_ROOT, {
      ...buildLiveSessionResourceOptions(profile),
      agentDir,
      extensionFactories: buildLiveSessionExtensionFactories(),
    }));
    const mcpConfig = readMcpConfig({ cwd: REPO_ROOT });
    const onePasswordCommand = process.env.PERSONAL_AGENT_OP_BIN?.trim() || 'op';
    const dependentCliTools = [
      {
        id: '1password-cli',
        name: '1Password CLI',
        description: 'Resolves op:// secret references used by personal-agent features and extensions.',
        configuredBy: 'PERSONAL_AGENT_OP_BIN',
        usedBy: ['op:// secret references', 'web-tools extension'],
        binary: inspectCliBinary({ command: onePasswordCommand, cwd: REPO_ROOT }),
      },
    ];

    res.json({
      profile,
      ...details,
      dependentCliTools,
      mcp: {
        configPath: mcpConfig.path,
        configExists: mcpConfig.exists,
        searchedPaths: mcpConfig.searchedPaths,
        servers: mcpConfig.servers.map((server) => ({
          name: server.name,
          transport: server.transport,
          command: server.command,
          args: [...server.args],
          cwd: server.cwd,
          url: server.url,
          raw: {},
        })),
      },
      packageInstall: buildPackageInstallState(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
});

app.post('/api/tools/packages/install', (req, res) => {
  try {
    const { source, target, profileName } = req.body as {
      source?: string;
      target?: 'profile' | 'local';
      profileName?: string;
    };

    if (typeof source !== 'string' || source.trim().length === 0) {
      res.status(400).json({ error: 'source required' });
      return;
    }

    if (target !== 'profile' && target !== 'local') {
      res.status(400).json({ error: 'target must be profile or local' });
      return;
    }

    if (target === 'profile' && typeof profileName !== 'string') {
      res.status(400).json({ error: 'profileName required for profile installs' });
      return;
    }

    const currentProfile = getCurrentProfile();
    const result = installPackageSource({
      repoRoot: REPO_ROOT,
      profilesRoot: getProfilesRoot(),
      profileName: target === 'profile' ? profileName : undefined,
      source,
      target,
      sourceBaseDir: REPO_ROOT,
    });

    res.json({
      ...result,
      packageInstall: buildPackageInstallState(currentProfile),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tools/mcp/servers/:server', async (_req, res) => {
  try {
    const server = _req.params.server;
    if (!server) {
      res.status(400).json({ error: 'server required' });
      return;
    }

    const config = readMcpConfig({ cwd: REPO_ROOT });
    const result = await inspectMcpServer(server, {
      cwd: REPO_ROOT,
      configPath: config.path,
    });

    if (result.exitCode !== 0 || !result.data) {
      res.status(500).json({
        error: (result.error ?? result.stderr) || `Failed to inspect MCP server ${server}`,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
      return;
    }

    res.json({
      server,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...result.data,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tools/mcp/servers/:server/tools/:tool', async (_req, res) => {
  try {
    const { server, tool } = _req.params;
    if (!server || !tool) {
      res.status(400).json({ error: 'server and tool required' });
      return;
    }

    const config = readMcpConfig({ cwd: REPO_ROOT });
    const result = await inspectMcpTool(server, tool, {
      cwd: REPO_ROOT,
      configPath: config.path,
    });

    if (result.exitCode !== 0 || !result.data) {
      res.status(500).json({
        error: (result.error ?? result.stderr) || `Failed to inspect MCP tool ${server}/${tool}`,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
      return;
    }

    res.json({
      server,
      tool,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      ...result.data,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

function handleOpenConversationLayoutReadRequest(_req: express.Request, res: express.Response) {
  try {
    const saved = readSavedWebUiPreferences(SETTINGS_FILE);
    res.json({
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
      archivedSessionIds: saved.archivedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

function handleOpenConversationLayoutWriteRequest(req: express.Request, res: express.Response) {
  try {
    const { sessionIds, pinnedSessionIds, archivedSessionIds } = req.body as {
      sessionIds?: string[];
      pinnedSessionIds?: string[];
      archivedSessionIds?: string[];
    };

    if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
      res.status(400).json({ error: 'sessionIds must be an array when provided' });
      return;
    }

    if (pinnedSessionIds !== undefined && !Array.isArray(pinnedSessionIds)) {
      res.status(400).json({ error: 'pinnedSessionIds must be an array when provided' });
      return;
    }

    if (archivedSessionIds !== undefined && !Array.isArray(archivedSessionIds)) {
      res.status(400).json({ error: 'archivedSessionIds must be an array when provided' });
      return;
    }

    if (sessionIds === undefined && pinnedSessionIds === undefined && archivedSessionIds === undefined) {
      res.status(400).json({ error: 'sessionIds, pinnedSessionIds, or archivedSessionIds required' });
      return;
    }

    const saved = persistSettingsWrite(
      (settingsFile) => writeSavedWebUiPreferences({
        openConversationIds: sessionIds,
        pinnedConversationIds: pinnedSessionIds,
        archivedConversationIds: archivedSessionIds,
      }, settingsFile),
      { runtimeSettingsFile: SETTINGS_FILE },
    );

    res.json({
      ok: true,
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
      archivedSessionIds: saved.archivedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

app.get('/api/web-ui/open-conversations', handleOpenConversationLayoutReadRequest);
app.patch('/api/web-ui/open-conversations', handleOpenConversationLayoutWriteRequest);

app.patch('/api/web-ui/config', (req, res) => {
  try {
    const { companionPort, useTailscaleServe, resumeFallbackPrompt } = req.body as {
      companionPort?: unknown;
      useTailscaleServe?: unknown;
      resumeFallbackPrompt?: unknown;
    };

    if (companionPort === undefined && useTailscaleServe === undefined && resumeFallbackPrompt === undefined) {
      res.status(400).json({ error: 'Provide companionPort, useTailscaleServe, and/or resumeFallbackPrompt.' });
      return;
    }

    if (companionPort !== undefined && (!Number.isInteger(companionPort) || Number(companionPort) <= 0 || Number(companionPort) > 65535)) {
      res.status(400).json({ error: 'companionPort must be a valid port when provided.' });
      return;
    }

    if (useTailscaleServe !== undefined && typeof useTailscaleServe !== 'boolean') {
      res.status(400).json({ error: 'useTailscaleServe must be a boolean when provided.' });
      return;
    }

    if (resumeFallbackPrompt !== undefined && typeof resumeFallbackPrompt !== 'string') {
      res.status(400).json({ error: 'resumeFallbackPrompt must be a string when provided.' });
      return;
    }

    const savedConfig = writeWebUiConfig({
      ...(companionPort !== undefined ? { companionPort: Number(companionPort) } : {}),
      ...(useTailscaleServe !== undefined ? { useTailscaleServe } : {}),
      ...(resumeFallbackPrompt !== undefined ? { resumeFallbackPrompt } : {}),
    });

    if (useTailscaleServe !== undefined || companionPort !== undefined) {
      syncConfiguredWebUiTailscaleServe(savedConfig.useTailscaleServe);
    }
    const state = readWebUiState();
    invalidateAppTopics('webUi');

    res.json({
      ...state,
      service: {
        ...state.service,
        companionPort: savedConfig.companionPort,
        companionUrl: `http://127.0.0.1:${savedConfig.companionPort}`,
        tailscaleServe: savedConfig.useTailscaleServe,
        resumeFallbackPrompt: savedConfig.resumeFallbackPrompt,
      },
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/companion-auth', (_req, res) => {
  try {
    res.json(readCompanionAuthAdminState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/companion-auth/pairing-code', (_req, res) => {
  try {
    res.status(201).json(createCompanionPairingCode());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/companion-auth/sessions/:sessionId', (req, res) => {
  try {
    revokeCompanionSession(req.params.sessionId);
    res.json({ ok: true, state: readCompanionAuthAdminState() });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/api/tasks', (_req, res) => {
  try {
    res.json(listTasksForCurrentProfile());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/tasks', (req, res) => {
  try {
    const body = req.body as {
      taskId?: string;
      enabled?: boolean;
      cron?: string | null;
      at?: string | null;
      model?: string | null;
      cwd?: string | null;
      timeoutSeconds?: number | null;
      prompt?: string;
    };
    const profile = getCurrentProfile();
    const taskId = readRequiredTaskId(body.taskId);
    const filePath = join(taskDirForProfile(profile), `${taskId}.task.md`);
    const loaded = loadScheduledTasksForProfile(profile);

    if (existsSync(filePath) || loaded.tasks.some((task) => task.id === taskId)) {
      res.status(409).json({ error: `Task already exists: ${taskId}` });
      return;
    }

    const content = buildScheduledTaskMarkdown({
      taskId,
      profile,
      enabled: body.enabled ?? true,
      cron: body.cron,
      at: body.at,
      model: body.model,
      cwd: body.cwd,
      timeoutSeconds: body.timeoutSeconds,
      prompt: body.prompt ?? '',
    });

    validateScheduledTaskDefinition(filePath, content);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    invalidateAppTopics('tasks');

    const savedTask = resolveScheduledTaskForProfile(profile, taskId);
    res.status(201).json({
      ok: true,
      task: buildTaskDetailResponse(savedTask.task, savedTask.runtime),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/tasks/:id', (req, res) => {
  try {
    const body = req.body as {
      enabled?: boolean;
      cron?: string | null;
      at?: string | null;
      model?: string | null;
      cwd?: string | null;
      timeoutSeconds?: number | null;
      prompt?: string;
    };
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }

    const requestedKeys = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined);
    const enabled = body.enabled;
    const toggleOnly = requestedKeys.length === 1 && requestedKeys[0] === 'enabled' && typeof enabled === 'boolean';

    if (toggleOnly) {
      let content = readFileSync(resolvedTask.task.filePath, 'utf-8');
      if (/enabled:\s*(true|false)/.test(content)) {
        content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
      } else {
        content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
      }
      writeFileSync(resolvedTask.task.filePath, content, 'utf-8');
      invalidateAppTopics('tasks');

      const updatedTask = resolveScheduledTaskForProfile(getCurrentProfile(), resolvedTask.task.id);
      res.json({ ok: true, task: buildTaskDetailResponse(updatedTask.task, updatedTask.runtime) });
      return;
    }

    const schedule = resolvedTask.task.schedule;
    const nextContent = buildScheduledTaskMarkdown({
      taskId: resolvedTask.task.id,
      profile: resolvedTask.task.profile,
      enabled: body.enabled ?? resolvedTask.task.enabled,
      cron: body.cron !== undefined ? body.cron : schedule.type === 'cron' ? schedule.expression : undefined,
      at: body.at !== undefined ? body.at : schedule.type === 'at' ? schedule.at : undefined,
      model: body.model !== undefined ? body.model : resolvedTask.task.modelRef,
      cwd: body.cwd !== undefined ? body.cwd : resolvedTask.task.cwd,
      timeoutSeconds: body.timeoutSeconds !== undefined ? body.timeoutSeconds : resolvedTask.task.timeoutSeconds,
      prompt: body.prompt ?? resolvedTask.task.prompt,
    });

    validateScheduledTaskDefinition(resolvedTask.task.filePath, nextContent);

    writeFileSync(resolvedTask.task.filePath, nextContent, 'utf-8');
    invalidateAppTopics('tasks');

    const updatedTask = resolveScheduledTaskForProfile(getCurrentProfile(), resolvedTask.task.id);
    res.json({ ok: true, task: buildTaskDetailResponse(updatedTask.task, updatedTask.runtime) });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tasks/:id/log', (req, res) => {
  try {
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask?.runtime?.lastLogPath || !existsSync(resolvedTask.runtime.lastLogPath)) {
      res.status(404).json({ error: 'No log available' }); return;
    }
    const log = readFileSync(resolvedTask.runtime.lastLogPath, 'utf-8');
    res.json({ log, path: resolvedTask.runtime.lastLogPath });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tasks/:id', (req, res) => {
  try {
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }

    res.json(buildTaskDetailResponse(resolvedTask.task, resolvedTask.runtime));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

/** Run a task immediately — queues a daemon-backed durable run */
app.post('/api/tasks/:id/run', async (req, res) => {
  try {
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask) { res.status(404).json({ error: 'Task not found' }); return; }
    if (!resolvedTask.task.prompt.trim()) { res.status(400).json({ error: 'Task has no prompt body' }); return; }

    const result = await startScheduledTaskRun(resolvedTask.task.filePath);
    if (!result.accepted) {
      res.status(503).json({ error: result.reason ?? 'Could not start the task run.' });
      return;
    }

    res.json({ ok: true, accepted: result.accepted, runId: result.runId });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inspectSshBinaryState() {
  return inspectCliBinary({ command: 'ssh', cwd: REPO_ROOT, versionArgs: ['-V'] });
}

function normalizeExecutionTargetInput(body: unknown) {
  if (!isRecord(body)) {
    throw new Error('Execution target payload must be an object.');
  }

  const cwdMappings = Array.isArray(body.cwdMappings)
    ? body.cwdMappings.flatMap((entry) => {
        if (!isRecord(entry)) {
          return [];
        }

        const localPrefix = typeof entry.localPrefix === 'string' ? entry.localPrefix.trim() : '';
        const remotePrefix = typeof entry.remotePrefix === 'string' ? entry.remotePrefix.trim() : '';
        return localPrefix && remotePrefix ? [{ localPrefix, remotePrefix }] : [];
      })
    : [];

  const readOptional = (value: unknown) => typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

  return {
    id: typeof body.id === 'string' ? body.id.trim() : '',
    label: typeof body.label === 'string' ? body.label.trim() : '',
    sshDestination: typeof body.sshDestination === 'string' ? body.sshDestination.trim() : '',
    ...(readOptional(body.description) ? { description: readOptional(body.description) } : {}),
    ...(readOptional(body.sshCommand) ? { sshCommand: readOptional(body.sshCommand) } : {}),
    ...(readOptional(body.remotePaCommand) ? { remotePaCommand: readOptional(body.remotePaCommand) } : {}),
    ...(readOptional(body.profile) ? { profile: readOptional(body.profile) } : {}),
    ...(readOptional(body.defaultRemoteCwd) ? { defaultRemoteCwd: readOptional(body.defaultRemoteCwd) } : {}),
    ...(readOptional(body.commandPrefix) ? { commandPrefix: readOptional(body.commandPrefix) } : {}),
    cwdMappings,
  };
}

async function readExecutionTargetsState() {
  return buildExecutionTargetsState({
    runs: (await listDurableRuns()).runs,
    inspectSshBinary: inspectSshBinaryState,
  });
}

async function readConversationExecutionStateWithTelemetry(conversationId: string): Promise<{
  state: ConversationExecutionState;
  telemetry: DurableRunsListTelemetry;
}> {
  const stored = getConversationExecutionTarget({
    profile: getCurrentProfile(),
    conversationId,
  });
  const runs = await listDurableRunsWithTelemetry();

  return {
    state: buildConversationExecutionState({
      conversationId,
      targetId: stored?.targetId ?? null,
      runs: runs.result.runs,
      inspectSshBinary: inspectSshBinaryState,
    }),
    telemetry: runs.telemetry,
  };
}

async function readConversationExecutionState(conversationId: string) {
  return (await readConversationExecutionStateWithTelemetry(conversationId)).state;
}

app.get('/api/execution-targets', async (_req, res) => {
  try {
    res.json(await readExecutionTargetsState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/execution-targets', async (req, res) => {
  try {
    saveExecutionTarget({
      target: normalizeExecutionTargetInput(req.body),
    });
    const state = await readExecutionTargetsState();
    invalidateAppTopics('executionTargets');
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('required') || message.startsWith('Invalid execution target') ? 400 : 500).json({ error: message });
  }
});

app.patch('/api/execution-targets/:id', async (req, res) => {
  try {
    saveExecutionTarget({
      target: {
        ...normalizeExecutionTargetInput(req.body),
        id: req.params.id,
      },
    });
    const state = await readExecutionTargetsState();
    invalidateAppTopics('executionTargets');
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('required') || message.startsWith('Invalid execution target') ? 400 : 500).json({ error: message });
  }
});

app.delete('/api/execution-targets/:id', async (req, res) => {
  try {
    if (!deleteExecutionTarget({ targetId: req.params.id })) {
      res.status(404).json({ error: 'Execution target not found.' });
      return;
    }

    const state = await readExecutionTargetsState();
    invalidateAppTopics('executionTargets');
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.startsWith('Invalid execution target') ? 400 : 500).json({ error: message });
  }
});

app.get('/api/runs', async (_req, res) => {
  try {
    const result = await listDurableRuns();
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

function parseRunLogTail(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : undefined;
  return Number.isFinite(parsed) && (parsed as number) > 0
    ? Math.min(1000, parsed as number)
    : 120;
}

async function readRunStreamSnapshot(runId: string, tail: number) {
  return (await getDurableRunSnapshot(runId, tail)) ?? null;
}

app.get('/api/runs/:id', async (req, res) => {
  try {
    const result = await getDurableRun(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/runs/:id/attention', async (req, res) => {
  try {
    const { read } = req.body as { read?: boolean };
    const result = await getDurableRun(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const attentionSignature = getDurableRunAttentionSignature(result.run);
    if (read === false) {
      markDurableRunAttentionUnread({ runId: req.params.id });
    } else if (attentionSignature) {
      markDurableRunAttentionRead({
        runId: req.params.id,
        attentionSignature,
      });
    }

    clearDurableRunsListCache();
    invalidateAppTopics('runs');
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/runs/:id/events', async (req, res) => {
  const runId = req.params.id;
  const tail = parseRunLogTail(req.query.tail);

  try {
    const initial = await readRunStreamSnapshot(runId, tail);
    if (!initial) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeEvent = (event: unknown) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    let closed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let lastSignature = JSON.stringify(initial);

    writeEvent({ type: 'snapshot', detail: initial.detail, log: initial.log });

    const heartbeat = setInterval(() => {
      if (!closed) {
        res.write(': heartbeat\n\n');
      }
    }, 15_000);

    const refresh = async () => {
      try {
        const next = await readRunStreamSnapshot(runId, tail);
        if (closed) {
          return;
        }

        if (!next) {
          writeEvent({ type: 'deleted', runId });
          cleanup();
          return;
        }

        const signature = JSON.stringify(next);
        if (signature === lastSignature) {
          return;
        }

        lastSignature = signature;
        writeEvent({ type: 'snapshot', detail: next.detail, log: next.log });
      } catch (error) {
        if (!closed) {
          writeEvent({ type: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    };

    const scheduleRefresh = () => {
      if (closed) {
        return;
      }

      if (refreshTimer) {
        clearTimeout(refreshTimer);
      }

      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void refresh();
      }, 75);
    };

    const watchTargets = [
      initial.detail.run.paths.root,
      initial.detail.run.paths.manifestPath,
      initial.detail.run.paths.statusPath,
      initial.detail.run.paths.checkpointPath,
      initial.detail.run.paths.outputLogPath,
      initial.detail.run.paths.resultPath,
      initial.detail.run.paths.eventsPath,
    ];
    const watchers = watchTargets.flatMap((target) => {
      try {
        return [watch(target, { persistent: false }, () => scheduleRefresh())];
      } catch {
        return [];
      }
    });

    const cleanup = () => {
      if (closed) {
        return;
      }

      closed = true;
      clearInterval(heartbeat);
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      res.end();
    };

    req.on('close', cleanup);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/runs/:id/log', async (req, res) => {
  try {
    const tail = parseRunLogTail(req.query.tail);

    const result = await getDurableRunLog(req.params.id, tail);
    if (!result) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/runs/:id/cancel', async (req, res) => {
  try {
    const result = await cancelDurableRun(req.params.id);
    if (!result.cancelled) {
      res.status(409).json({ error: result.reason ?? 'Could not cancel run.' });
      return;
    }

    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/runs/:id/import', async (req, res) => {
  try {
    const detail = await getDurableRun(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const conversationId = readRemoteExecutionRunConversationId(detail.run);
    if (!conversationId) {
      res.status(409).json({ error: 'This run is not a remote execution run.' });
      return;
    }

    const sessionFile = resolveConversationSessionFile(conversationId) ?? detail.run.manifest?.source?.filePath;
    if (!sessionFile || !existsSync(sessionFile)) {
      res.status(404).json({ error: 'Conversation not found for this remote run.' });
      return;
    }

    const result = await importRemoteExecutionRun({
      run: detail.run,
      sessionFile,
    });

    invalidateAppTopics('sessions', 'runs');
    res.json({ ok: true, runId: req.params.id, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found')
      ? 404
      : message.includes('already been imported') || message.includes('has not completed') || message.includes('not a remote execution run') || message.includes('Wait for the current local turn')
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/runs/:id/node-distill/retry', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const detail = await getDurableRun(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const run = detail.run;
    const distillInput = readConversationMemoryDistillRunInputFromRun(run, profile);
    if (!distillInput) {
      res.status(409).json({ error: 'This run is not a node distillation run.' });
      return;
    }

    if (run.status?.status !== 'failed' && run.status?.status !== 'interrupted') {
      res.status(409).json({ error: 'Only failed or interrupted node distillation runs can be retried.' });
      return;
    }

    const existing = await readConversationMemoryDistillRunState(distillInput.conversationId);
    if (existing.running) {
      res.status(409).json({ error: 'A node distillation is already running for this conversation.' });
      return;
    }

    const result = await startConversationMemoryDistillRun({
      conversationId: distillInput.conversationId,
      profile,
      checkpointId: distillInput.checkpointId,
      mode: distillInput.mode,
      trigger: distillInput.trigger,
      title: distillInput.title,
      summary: distillInput.summary,
      tags: distillInput.tags,
      emitActivity: distillInput.emitActivity,
    });

    if (!result.accepted || !result.runId) {
      const error = result.reason ?? 'Could not retry conversation node distillation.';
      markConversationMemoryMaintenanceRunFailed({
        profile,
        conversationId: distillInput.conversationId,
        checkpointId: distillInput.checkpointId,
        error,
      });
      if (distillInput.emitActivity) {
        tryWriteConversationMemoryDistillFailureActivity({
          profile,
          conversationId: distillInput.conversationId,
          error,
        });
      }
      res.status(500).json({ error });
      return;
    }

    markConversationMemoryMaintenanceRunStarted({
      profile,
      conversationId: distillInput.conversationId,
      checkpointId: distillInput.checkpointId,
      runId: result.runId,
    });

    invalidateAppTopics('runs');
    res.status(202).json({
      accepted: true,
      conversationId: distillInput.conversationId,
      runId: result.runId,
      status: 'queued',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found')
      ? 404
      : message.includes('already running') || message.includes('not a node distillation run') || message.includes('Only failed or interrupted')
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/runs/:id/node-distill/recover-now', async (req, res) => {
  const requestedProfile = typeof req.body?.profile === 'string' && req.body.profile.trim().length > 0
    ? req.body.profile.trim()
    : getCurrentProfile();

  try {
    const profile = requestedProfile;
    const detail = await getDurableRun(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const run = detail.run;
    const distillInput = readConversationMemoryDistillRunInputFromRun(run, profile);
    if (!distillInput) {
      res.status(409).json({ error: 'This run is not a node distillation run.' });
      return;
    }

    const maintenanceState = readConversationMemoryMaintenanceState({
      profile,
      conversationId: distillInput.conversationId,
    });
    if (maintenanceState?.lastCompletedCheckpointId === distillInput.checkpointId && maintenanceState.status !== 'failed') {
      res.json({
        ok: true,
        runId: run.runId,
        conversationId: distillInput.conversationId,
        resolved: 'already-completed',
        ...(maintenanceState.promotedMemoryId ? { memoryId: maintenanceState.promotedMemoryId } : {}),
        ...(maintenanceState.promotedReferencePath ? { referencePath: maintenanceState.promotedReferencePath } : {}),
      });
      return;
    }

    if (run.status?.status !== 'failed' && run.status?.status !== 'interrupted') {
      res.status(409).json({ error: 'Only failed or interrupted node distillation runs can be recovered automatically.' });
      return;
    }

    const existing = await readConversationMemoryDistillRunState(distillInput.conversationId);
    if (existing.running) {
      res.status(409).json({ error: 'A node distillation is already running for this conversation.' });
      return;
    }

    const recovered = await distillConversationMemoryNow({
      conversationId: distillInput.conversationId,
      profile,
      checkpointId: distillInput.checkpointId,
      title: distillInput.title,
      summary: distillInput.summary,
      tags: distillInput.tags,
      mode: distillInput.mode,
      trigger: distillInput.trigger,
      emitActivity: distillInput.emitActivity,
    });

    invalidateAppTopics('projects', 'sessions', 'runs');
    res.json({
      ok: true,
      runId: run.runId,
      conversationId: distillInput.conversationId,
      resolved: 'recovered',
      memoryId: recovered.memory.id,
      referencePath: recovered.reference.relativePath,
      disposition: recovered.disposition,
      ...(recovered.activityId ? { activityId: recovered.activityId } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      const detail = await getDurableRun(req.params.id);
      const run = detail?.run;
      const distillInput = run ? readConversationMemoryDistillRunInputFromRun(run, requestedProfile) : null;
      if (distillInput) {
        markConversationMemoryMaintenanceRunFailed({
          profile: requestedProfile,
          conversationId: distillInput.conversationId,
          checkpointId: distillInput.checkpointId,
          error: message,
        });
        if (distillInput.emitActivity) {
          tryWriteConversationMemoryDistillFailureActivity({
            profile: requestedProfile,
            conversationId: distillInput.conversationId,
            error: message,
          });
        }
      }
    } catch {
      // Ignore maintenance state write errors in failure path.
    }

    const status = message.includes('not found')
      ? 404
      : message.includes('already running') || message.includes('not a node distillation run') || message.includes('Only failed or interrupted')
        ? 409
        : message.includes('Invalid') || message.includes('required') || message.includes('Unable to resolve') || message.includes('empty conversation')
          ? 400
          : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/runs/:id/node-distill/recover', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const detail = await getDurableRun(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const run = detail.run;
    const distillInput = readConversationMemoryDistillRunInputFromRun(run, profile);
    if (!distillInput) {
      res.status(409).json({ error: 'This run is not a node distillation run.' });
      return;
    }

    if (run.status?.status !== 'failed' && run.status?.status !== 'interrupted') {
      res.status(409).json({ error: 'Only failed or interrupted node distillation runs can be recovered in a conversation.' });
      return;
    }

    const maintenanceState = readConversationMemoryMaintenanceState({
      profile,
      conversationId: distillInput.conversationId,
    });
    const sessionFile = resolveConversationSessionFile(distillInput.conversationId)
      ?? maintenanceState?.latestSessionFile
      ?? run.manifest?.source?.filePath;

    if (!sessionFile || !existsSync(sessionFile)) {
      res.status(404).json({ error: 'Conversation not found for this node distillation run.' });
      return;
    }

    const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === distillInput.conversationId);
    const cwd = sourceSession?.cwd
      ?? maintenanceState?.latestCwd
      ?? SessionManager.open(sessionFile).getCwd();
    const created = await createSessionFromExisting(sessionFile, cwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });

    const sourceLabel = sourceSession?.title ?? maintenanceState?.latestConversationTitle ?? distillInput.conversationId;
    renameSession(created.id, `${CONVERSATION_MEMORY_DISTILL_RECOVERY_TITLE_PREFIX} ${sourceLabel}`);

    const relatedProjectIds = getConversationProjectLink({
      profile,
      conversationId: distillInput.conversationId,
    })?.relatedProjectIds ?? [];
    if (relatedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: created.id,
        relatedProjectIds,
      });
    }

    let checkpointSnapshot: ReturnType<typeof readConversationCheckpointSnapshotFromState> | null = null;
    try {
      checkpointSnapshot = readConversationCheckpointSnapshotFromState({
        profile,
        conversationId: distillInput.conversationId,
        checkpointId: distillInput.checkpointId,
      });
    } catch {
      checkpointSnapshot = null;
    }

    const anchorLabel = formatConversationMemoryCheckpointAnchor(checkpointSnapshot);
    const errorMessage = run.status?.lastError;
    await appendVisibleCustomMessage(
      created.id,
      MEMORY_DISTILL_RECOVERY_CUSTOM_TYPE,
      buildConversationMemoryDistillRecoveryVisibleMessage({
        runId: run.runId,
        status: run.status?.status ?? 'unknown',
        sourceConversationId: distillInput.conversationId,
        sourceConversationTitle: sourceSession?.title ?? maintenanceState?.latestConversationTitle,
        checkpointId: distillInput.checkpointId,
        anchorLabel,
        error: errorMessage,
      }),
      {
        runId: run.runId,
        status: run.status?.status ?? 'unknown',
        sourceConversationId: distillInput.conversationId,
        checkpointId: distillInput.checkpointId,
        ...(anchorLabel ? { anchor: anchorLabel } : {}),
      },
    );
    await queuePromptContext(
      created.id,
      MEMORY_DISTILL_RECOVERY_CUSTOM_TYPE,
      buildConversationMemoryDistillRecoveryHiddenContext({
        runId: run.runId,
        status: run.status?.status ?? 'unknown',
        sourceConversationId: distillInput.conversationId,
        sourceConversationTitle: sourceSession?.title ?? maintenanceState?.latestConversationTitle,
        checkpointId: distillInput.checkpointId,
        anchorLabel,
        title: distillInput.title,
        summary: distillInput.summary,
        tags: distillInput.tags,
        error: errorMessage,
      }),
    );

    invalidateAppTopics('projects', 'sessions', 'runs');
    res.status(201).json({
      ok: true,
      runId: run.runId,
      conversationId: created.id,
      sessionFile: created.sessionFile,
      cwd,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found')
      ? 404
      : message.includes('not a node distillation run') || message.includes('Only failed or interrupted')
        ? 409
        : 500;
    res.status(status).json({ error: message });
  }
});

app.get('/api/runs/:id/remote-transcript', async (req, res) => {
  try {
    const detail = await getDurableRun(req.params.id);
    if (!detail) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const transcript = buildRemoteExecutionTranscriptResponse(detail.run);
    res.setHeader('Content-Type', transcript.contentType);
    res.setHeader('Content-Disposition', transcript.contentDisposition);
    res.send(transcript.content);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('missing') ? 404 : 409;
    res.status(status).json({ error: message });
  }
});

// ── Sessions (read-only JSONL) ────────────────────────────────────────────────

function handleCompanionConversationListRequest(req: express.Request, res: express.Response) {
  try {
    const archivedOffset = parseBoundedIntegerQueryValue(req.query.archivedOffset, 0);
    const archivedLimit = parseBoundedIntegerQueryValue(req.query.archivedLimit, 30, { min: 1, max: 100 });
    res.json(listCompanionConversationSections({ archivedOffset, archivedLimit }));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
}

app.get('/api/sessions', (_req, res) => {
  try {
    res.json(decorateSessionsWithAttention(getCurrentProfile(), listSessions()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/companion/conversations', handleCompanionConversationListRequest);

app.get('/api/sessions/:id', async (req, res) => {
  const startedAt = process.hrtime.bigint();

  try {
    const remoteMirror = await syncRemoteConversationMirror({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
    }).catch(() => ({ status: 'not-remote' as const, durationMs: 0 } satisfies RemoteConversationMirrorSyncTelemetry));

    const rawTailBlocks = Array.isArray(req.query.tailBlocks) ? req.query.tailBlocks[0] : req.query.tailBlocks;
    const parsedTailBlocks = typeof rawTailBlocks === 'string'
      ? Number.parseInt(rawTailBlocks, 10)
      : typeof rawTailBlocks === 'number'
        ? rawTailBlocks
        : undefined;
    const tailBlocks = Number.isInteger(parsedTailBlocks) && (parsedTailBlocks as number) > 0
      ? parsedTailBlocks as number
      : undefined;

    const sessionRead = readSessionBlocksWithTelemetry(req.params.id, tailBlocks ? { tailBlocks } : undefined);
    if (!sessionRead.detail) { res.status(404).json({ error: 'Session not found' }); return; }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    setServerTimingHeaders(res, [
      { name: 'remote_sync', durationMs: remoteMirror.durationMs, description: remoteMirror.status },
      { name: 'session_read', durationMs: sessionRead.telemetry?.durationMs ?? 0, description: sessionRead.telemetry ? `${sessionRead.telemetry.cache}/${sessionRead.telemetry.loader}` : 'unknown' },
      { name: 'total', durationMs },
    ], {
      route: 'session-detail',
      conversationId: req.params.id,
      ...(tailBlocks ? { tailBlocks } : {}),
      remoteMirror,
      sessionRead: sessionRead.telemetry,
      durationMs,
    });
    logSlowConversationPerf('session detail request', {
      conversationId: req.params.id,
      durationMs,
      ...(tailBlocks ? { tailBlocks } : {}),
      remoteMirrorStatus: remoteMirror.status,
      sessionReadCache: sessionRead.telemetry?.cache,
      sessionReadLoader: sessionRead.telemetry?.loader,
      sessionReadDurationMs: sessionRead.telemetry?.durationMs,
    });

    res.json(sessionRead.detail);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:id/tree', (req, res) => {
  try {
    const result = readSessionTree(req.params.id);
    if (!result) { res.status(404).json({ error: 'Session not found' }); return; }
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:id/blocks/:blockId/image', (req, res) => {
  try {
    const asset = readSessionImageAsset(req.params.id, req.params.blockId);
    if (!asset) { res.status(404).json({ error: 'Session image not found' }); return; }
    if (asset.fileName) {
      res.setHeader('Content-Disposition', buildContentDispositionHeader('inline', asset.fileName));
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type(asset.mimeType);
    res.send(asset.data);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:id/blocks/:blockId/images/:imageIndex', (req, res) => {
  try {
    const imageIndex = Number.parseInt(req.params.imageIndex, 10);
    const asset = readSessionImageAsset(req.params.id, req.params.blockId, imageIndex);
    if (!asset) { res.status(404).json({ error: 'Session image not found' }); return; }
    if (asset.fileName) {
      res.setHeader('Content-Disposition', buildContentDispositionHeader('inline', asset.fileName));
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.type(asset.mimeType);
    res.send(asset.data);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:id/blocks/:blockId', (req, res) => {
  try {
    const result = readSessionBlock(req.params.id, req.params.blockId);
    if (!result) { res.status(404).json({ error: 'Session block not found' }); return; }
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/sessions/search-index', (req, res) => {
  try {
    const rawSessionIds: unknown[] = Array.isArray(req.body?.sessionIds) ? req.body.sessionIds as unknown[] : [];
    const sessionIds = rawSessionIds
      .filter((value: unknown): value is string => typeof value === 'string')
      .map((value: string) => value.trim())
      .filter((value: string) => value.length > 0);

    if (sessionIds.length === 0) {
      res.json({ index: {} as Record<string, string> });
      return;
    }

    const index: Record<string, string> = {};
    for (const sessionId of sessionIds) {
      const searchText = readSessionSearchText(sessionId);
      index[sessionId] = typeof searchText === 'string' ? searchText : '';
    }

    res.json({ index });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Conversation notes ───────────────────────────────────────────────────────

const MAX_CREATED_NOTE_ID_LENGTH = 52;

function normalizeCreatedNoteTitle(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCreatedNoteSummary(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().replace(/\s+/g, ' ');
}

function normalizeCreatedNoteTags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .flatMap((entry) => entry.split(','))
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0))];
}

function slugifyCreatedNoteId(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');

  if (!slug) {
    return 'note';
  }

  return slug.slice(0, MAX_CREATED_NOTE_ID_LENGTH).replace(/-+$/g, '') || 'note';
}

function generateCreatedNoteId(title: string): string {
  const existingIds = new Set(listMemoryDocs().map((entry) => entry.id));
  const base = slugifyCreatedNoteId(title);

  if (!existingIds.has(base)) {
    return base;
  }

  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const suffix = `-${index}`;
    const trimmedBase = base.slice(0, MAX_CREATED_NOTE_ID_LENGTH - suffix.length).replace(/-+$/g, '') || 'note';
    const candidate = `${trimmedBase}${suffix}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return `${base}-${Date.now()}`;
}

app.get('/api/notes', async (_req, res) => {
  try {
    res.json({
      memories: listMemoryDocs({ includeSearchText: true }),
      memoryQueue: await listMemoryWorkItems(),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/notes/recover-failed-node-distills', async (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const activeBatchRun = (await listDurableRuns()).runs.find((run) => (
      run.manifest?.kind === 'background-run'
      && run.manifest?.source?.type === CONVERSATION_NODE_DISTILL_BATCH_RECOVERY_RUN_SOURCE_TYPE
      && run.manifest?.source?.id === profile
      && CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES.has(run.status?.status ?? '')
    ));

    if (activeBatchRun) {
      res.status(409).json({
        error: 'A failed note-extraction recovery run is already in progress.',
        runId: activeBatchRun.runId,
      });
      return;
    }

    const recoverableRunIds = (await listMemoryWorkItems())
      .filter((item) => (item.status === 'failed' || item.status === 'interrupted') && !item.runId.startsWith('state:'))
      .map((item) => item.runId);

    if (recoverableRunIds.length === 0) {
      res.status(409).json({ error: 'No failed note extractions are ready for batch recovery.' });
      return;
    }

    const result = await startConversationMemoryDistillBatchRecoveryRun({
      profile,
      runIds: recoverableRunIds,
    });

    if (!result.accepted || !result.runId) {
      res.status(500).json({ error: result.reason ?? 'Could not start failed note-extraction recovery.' });
      return;
    }

    invalidateAppTopics('runs');
    res.status(202).json({
      accepted: true,
      runId: result.runId,
      count: recoverableRunIds.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

app.post('/api/notes', (req, res) => {
  try {
    const title = normalizeCreatedNoteTitle(req.body?.title);
    if (title.length === 0) {
      res.status(400).json({ error: 'title required' });
      return;
    }

    const summary = normalizeCreatedNoteSummary(req.body?.summary) || `Personal note about ${title}.`;
    const tags = normalizeCreatedNoteTags(req.body?.tags);
    const created = createMemoryDoc({
      id: generateCreatedNoteId(title),
      title,
      summary,
      tags,
      status: 'active',
    });
    const memory = findMemoryDocById(created.id, { includeSearchText: true });

    if (!memory) {
      res.status(500).json({ error: 'Created note could not be loaded.' });
      return;
    }

    res.status(201).json({
      memory,
      content: readFileSync(created.filePath, 'utf-8'),
      references: [],
      links: readNodeLinksForCurrentProfile('note', memory.id),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/notes/:memoryId', (req, res) => {
  try {
    res.json(readNoteDetail(req.params.memoryId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(message === 'Note not found.' || message === 'Note file not found.' ? 404 : 500).json({ error: message });
  }
});

app.post('/api/notes/:memoryId', (req, res) => {
  try {
    const memory = findMemoryDocById(req.params.memoryId);
    if (!memory) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    const { content } = req.body as { content?: string };
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' });
      return;
    }

    writeFileSync(memory.path, content, 'utf-8');
    const refreshed = listMemoryDocs({ includeSearchText: true }).find((entry) => entry.path === memory.path) ?? memory;
    res.json({
      memory: refreshed,
      content,
      references: buildMemoryReferenceItems(refreshed.path),
      links: readNodeLinksForCurrentProfile('note', refreshed.id),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/notes/:memoryId', (req, res) => {
  try {
    const memory = findMemoryDocById(req.params.memoryId);
    if (!memory) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    if (!existsSync(memory.path)) {
      res.status(404).json({ error: 'Note file not found.' });
      return;
    }

    rmSync(dirname(memory.path), { recursive: true, force: true });
    res.json({ deleted: true, memoryId: memory.id });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/notes/status', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const runState = await readConversationMemoryDistillRunState(conversationId);
    const maintenanceState = readConversationMemoryMaintenanceState({
      profile: getCurrentProfile(),
      conversationId,
    });
    res.json({
      ...runState,
      status: runState.status ?? maintenanceState?.status ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

app.post('/api/conversations/:id/notes', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const conversationId = req.params.id;
    const sessionFile = resolveConversationSessionFile(conversationId);
    if (!sessionFile || !existsSync(sessionFile)) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const existing = await readConversationMemoryDistillRunState(conversationId);
    if (existing.running) {
      res.status(409).json({
        error: 'A node distillation is already running for this conversation.',
        ...existing,
      });
      return;
    }

    const { title, summary, anchorMessageId, tags } = req.body as {
      title?: string;
      summary?: string;
      anchorMessageId?: string;
      tags?: string[];
    };
    const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === conversationId);
    const relatedProjectIds = getConversationMemoryRelatedProjectIds(profile, conversationId);
    const prepared = prepareConversationMemoryMaintenance({
      profile,
      conversationId,
      sessionFile,
      conversationTitle: sourceSession?.title,
      cwd: sourceSession?.cwd,
      relatedProjectIds,
      trigger: 'manual',
      mode: 'manual',
      requestedAnchorMessageId: anchorMessageId,
    });

    const result = await startConversationMemoryDistillRun({
      conversationId,
      profile,
      checkpointId: prepared.checkpoint.checkpointId,
      mode: 'manual',
      trigger: 'manual',
      title,
      summary,
      tags,
      emitActivity: true,
    });

    if (!result.accepted || !result.runId) {
      const error = result.reason ?? 'Could not start conversation node distillation.';
      markConversationMemoryMaintenanceRunFailed({
        profile,
        conversationId,
        checkpointId: prepared.checkpoint.checkpointId,
        error,
      });
      tryWriteConversationMemoryDistillFailureActivity({
        profile,
        conversationId,
        error,
        relatedProjectIds,
      });
      res.status(503).json({
        error,
        accepted: false,
        runId: result.runId,
      });
      return;
    }

    markConversationMemoryMaintenanceRunStarted({
      profile,
      conversationId,
      checkpointId: prepared.checkpoint.checkpointId,
      runId: result.runId,
    });

    res.json({
      conversationId,
      accepted: true,
      runId: result.runId,
      running: true,
      status: 'queued',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

app.post('/api/conversations/:id/notes/distill-now', async (req, res) => {
  const currentProfile = getCurrentProfile();
  const conversationId = req.params.id;
  const {
    profile: requestedProfile,
    title,
    summary,
    anchorMessageId,
    checkpointId,
    tags,
    mode: requestedMode,
    trigger: requestedTrigger,
    emitActivity = false,
  } = req.body as {
    profile?: string;
    title?: string;
    summary?: string;
    anchorMessageId?: string;
    checkpointId?: string;
    tags?: string[];
    mode?: ConversationMemoryMaintenanceMode;
    trigger?: ConversationMemoryMaintenanceTrigger;
    emitActivity?: boolean;
  };
  const profile = typeof requestedProfile === 'string' && requestedProfile.trim().length > 0
    ? requestedProfile.trim()
    : currentProfile;
  const mode: ConversationMemoryMaintenanceMode = requestedMode === 'manual' ? 'manual' : 'auto';
  const trigger: ConversationMemoryMaintenanceTrigger = requestedTrigger === 'manual'
    || requestedTrigger === 'auto_compaction_end'
    ? requestedTrigger
    : 'turn_end';
  const normalizedCheckpointId = typeof checkpointId === 'string' && checkpointId.trim().length > 0
    ? checkpointId.trim()
    : undefined;

  try {
    const result = await distillConversationMemoryNow({
      conversationId,
      profile,
      title,
      summary,
      anchorMessageId,
      checkpointId: normalizedCheckpointId,
      tags,
      mode,
      trigger,
      emitActivity,
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (normalizedCheckpointId) {
      try {
        markConversationMemoryMaintenanceRunFailed({
          profile,
          conversationId,
          checkpointId: normalizedCheckpointId,
          error: message,
        });
      } catch {
        // Ignore maintenance state write errors in failure path.
      }
    }

    if (emitActivity) {
      tryWriteConversationMemoryDistillFailureActivity({
        profile,
        conversationId,
        error: message,
      });
    }

    const status = message.includes('not found')
      ? 404
      : message.includes('Stop the current response before distilling a note node.')
        ? 409
        : message.includes('Invalid') || message.includes('required') || message.includes('Unable to resolve') || message.includes('empty conversation')
          ? 400
          : 500;

    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
      conversationId,
      profile,
      mode,
      trigger,
      checkpointId: normalizedCheckpointId,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/notes/:memoryId/start', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const memoryId = req.params.memoryId;
    const memory = listMemoryDocs().find((entry) => entry.id === memoryId);
    const loadedMemory = loadMemoryDocs({ profilesRoot: getProfilesRoot() }).docs.find((entry) => entry.id === memoryId);

    if (!memory || !loadedMemory) {
      res.status(404).json({ error: 'Note not found.' });
      return;
    }

    const sourceCwd = typeof loadedMemory.metadata.source_cwd === 'string'
      ? loadedMemory.metadata.source_cwd.trim()
      : '';

    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd } = req.body as { cwd?: string };
    let nextCwd = resolveRequestedCwd(requestedCwd, sourceCwd || defaultWebCwd);

    if (!nextCwd && !requestedCwd) {
      nextCwd = defaultWebCwd;
    }

    if (!nextCwd) {
      res.status(400).json({ error: 'cwd required' });
      return;
    }

    if ((!existsSync(nextCwd) || !statSync(nextCwd).isDirectory()) && !requestedCwd && nextCwd !== defaultWebCwd) {
      nextCwd = defaultWebCwd;
    }

    if (!existsSync(nextCwd)) {
      res.status(400).json({ error: `Directory does not exist: ${nextCwd}` });
      return;
    }

    if (!statSync(nextCwd).isDirectory()) {
      res.status(400).json({ error: `Not a directory: ${nextCwd}` });
      return;
    }

    const result = await createLocalSession(nextCwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });

    const requestedRelatedProjectIds = Array.isArray(loadedMemory.metadata.related_project_ids)
      ? loadedMemory.metadata.related_project_ids.filter((projectId): projectId is string => typeof projectId === 'string' && projectId.trim().length > 0)
      : [];
    const availableProjectIds = new Set(listReferenceableProjectIds());
    const relatedProjectIds = requestedRelatedProjectIds.filter((projectId) => availableProjectIds.has(projectId));

    if (relatedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds,
      });
      invalidateAppTopics('projects', 'sessions');
    }

    await queuePromptContext(
      result.id,
      'referenced_context',
      buildReferencedMemoryDocsContext([
        {
          id: memory.id,
          title: memory.title,
          summary: memory.summary,
          tags: memory.tags,
          path: memory.path,
          updated: memory.updated,
        },
      ], REPO_ROOT),
    );

    res.json({
      memoryId,
      id: result.id,
      sessionFile: result.sessionFile,
      cwd: nextCwd,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

// ── Live sessions (Pi SDK) ────────────────────────────────────────────────────

/** List all in-process live sessions */
app.get('/api/live-sessions', (_req, res) => {
  res.json(listAllLiveSessions());
});

/** Create a new live session */
app.post('/api/live-sessions', async (req, res) => {
  try {
    const body = req.body as { cwd?: string; referencedProjectIds?: string[]; text?: string; targetId?: string | null };
    const profile = getCurrentProfile();
    const availableProjectIds = listReferenceableProjectIds();
    const inferredReferencedProjectIds = body.text
      ? resolvePromptReferences({
          text: body.text,
          availableProjectIds,
          tasks: [],
          memoryDocs: [],
          skills: [],
          profiles: [],
        }).projectIds
      : [];
    const referencedProjectIds = body.referencedProjectIds && body.referencedProjectIds.length > 0
      ? body.referencedProjectIds.filter((projectId) => availableProjectIds.includes(projectId))
      : inferredReferencedProjectIds;
    const cwd = resolveConversationCwd({
      repoRoot: REPO_ROOT,
      profile,
      explicitCwd: body.cwd,
      defaultCwd: getDefaultWebCwd(),
      referencedProjectIds,
    });
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() || null : null;

    if (targetId) {
      const target = getExecutionTarget({ targetId });
      if (!target) {
        res.status(400).json({ error: `Execution target ${targetId} not found.` });
        return;
      }

      const remoteCwd = resolveRemoteExecutionCwd(target, cwd);
      const result = await createLocalMirrorSession({ remoteCwd });
      setConversationExecutionTarget({
        profile,
        conversationId: result.id,
        targetId,
      });
      await createRemoteLiveSession({
        profile,
        targetId,
        remoteCwd,
        localSessionFile: result.sessionFile,
        conversationId: result.id,
      });

      if (referencedProjectIds.length > 0) {
        setConversationProjectLinks({
          profile,
          conversationId: result.id,
          relatedProjectIds: referencedProjectIds,
        });
        invalidateAppTopics('projects', 'sessions');
      }

      migrateDraftConversationPlan(profile, result.id);
      res.json(result);
      return;
    }

    const result = await createLocalSession(cwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    if (referencedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds: referencedProjectIds,
      });
      invalidateAppTopics('projects', 'sessions');
    }
    migrateDraftConversationPlan(profile, result.id);
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

/** Resume an existing session file into a live session */
app.post('/api/live-sessions/resume', async (req, res) => {
  try {
    const { sessionFile } = req.body as { sessionFile: string };
    if (!sessionFile) { res.status(400).json({ error: 'sessionFile required' }); return; }

    const conversationId = SessionManager.open(sessionFile).getSessionId();
    const targetBinding = getConversationExecutionTarget({
      profile: getCurrentProfile(),
      conversationId,
    });

    if (targetBinding) {
      const result = await resumeRemoteLiveSession({
        profile: getCurrentProfile(),
        conversationId,
        localSessionFile: sessionFile,
        targetId: targetBinding.targetId,
      });
      res.json(result);
      return;
    }

    const result = await resumeLocalSession(sessionFile, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    await flushLiveDeferredResumes();
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/remote-runs', async (req, res) => {
  try {
    const body = req.body as {
      conversationId?: string;
      cwd?: string;
      referencedProjectIds?: string[];
      text?: string;
      targetId?: string;
    };
    const profile = getCurrentProfile();
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    const referencedProjectIds = Array.isArray(body.referencedProjectIds)
      ? body.referencedProjectIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const sessionFile = conversationId ? resolveConversationSessionFile(conversationId) : undefined;
    const cwd = conversationId
      ? undefined
      : resolveConversationCwd({
          repoRoot: REPO_ROOT,
          profile,
          explicitCwd: body.cwd,
          defaultCwd: getDefaultWebCwd(),
          referencedProjectIds,
        });

    const result = await submitRemoteExecutionRun({
      ...(conversationId ? { conversationId, sessionFile } : { cwd, referencedProjectIds }),
      text: typeof body.text === 'string' ? body.text : '',
      targetId: typeof body.targetId === 'string' ? body.targetId : '',
      profile,
      repoRoot: REPO_ROOT,
    });

    invalidateAppTopics('sessions', 'runs');
    res.status(202).json({ accepted: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('required') || message.includes('not found') || message.includes('Wait for the current local turn')
      ? 400
      : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/conversations/:id/recover', async (req, res) => {
  try {
    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({ error: 'conversation id required' });
      return;
    }

    const resumeFallbackPrompt = readWebUiConfig().resumeFallbackPrompt;

    if (isLocalLive(conversationId)) {
      const liveEntry = liveRegistry.get(conversationId);
      if (liveEntry?.session.sessionFile) {
        await syncWebLiveConversationRun({
          conversationId,
          sessionFile: liveEntry.session.sessionFile,
          cwd: liveEntry.cwd,
          title: liveEntry.title,
          profile: getCurrentProfile(),
          state: 'running',
          pendingOperation: {
            type: 'prompt',
            text: resumeFallbackPrompt,
            enqueuedAt: new Date().toISOString(),
          },
        });
      }

      promptLocalSession(conversationId, resumeFallbackPrompt).catch(async (error) => {
        if (liveEntry?.session.sessionFile) {
          await syncWebLiveConversationRun({
            conversationId,
            sessionFile: liveEntry.session.sessionFile,
            cwd: liveEntry.cwd,
            title: liveEntry.title,
            profile: getCurrentProfile(),
            state: 'failed',
            lastError: error instanceof Error ? error.message : String(error),
          });
        }

        logError('conversation recovery error', {
          sessionId: conversationId,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      });

      res.json({
        conversationId,
        live: true,
        recovered: true,
        replayedPendingOperation: false,
        usedFallbackPrompt: true,
      });
      return;
    }

    const runDetail = await getDurableRun(createWebLiveConversationRunId(conversationId));
    const payload = runDetail?.run.checkpoint?.payload;
    const checkpointPayload = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : {};
    const readCheckpointString = (key: string): string | undefined => {
      const value = checkpointPayload[key];
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
    };

    const pendingOperation = parsePendingOperation(checkpointPayload.pendingOperation);
    const sessionDetail = readSessionBlocks(conversationId);
    const sessionFile = sessionDetail?.meta.file
      ?? readCheckpointString('sessionFile')
      ?? runDetail?.run.manifest?.source?.filePath?.trim();

    if (!sessionFile || !existsSync(sessionFile)) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const currentProfile = getCurrentProfile();
    const manifestSpec = runDetail?.run.manifest?.spec;
    const manifestCwd = typeof manifestSpec?.cwd === 'string' && manifestSpec.cwd.trim().length > 0
      ? manifestSpec.cwd.trim()
      : undefined;
    const resumed = await resumeLocalSession(sessionFile, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    await flushLiveDeferredResumes();

    const resumedEntry = liveRegistry.get(resumed.id);
    const effectiveCwd = resumedEntry?.cwd
      ?? sessionDetail?.meta.cwd
      ?? readCheckpointString('cwd')
      ?? manifestCwd;
    const effectiveTitle = sessionDetail?.meta.title ?? readCheckpointString('title');
    const effectiveProfile = readCheckpointString('profile') ?? currentProfile;

    if (!effectiveCwd) {
      res.status(500).json({ error: 'Could not determine the conversation working directory.' });
      return;
    }

    const recoveryOperation = pendingOperation ?? {
      type: 'prompt' as const,
      text: resumeFallbackPrompt,
      enqueuedAt: new Date().toISOString(),
    };
    const replayedPendingOperation = Boolean(pendingOperation);
    const usedFallbackPrompt = !pendingOperation;

    await syncWebLiveConversationRun({
      conversationId: resumed.id,
      sessionFile,
      cwd: effectiveCwd,
      title: effectiveTitle,
      profile: effectiveProfile,
      state: 'running',
      pendingOperation: recoveryOperation,
    });

    for (const message of recoveryOperation.contextMessages ?? []) {
      await queuePromptContext(resumed.id, message.customType, message.content);
    }

    promptLocalSession(
      resumed.id,
      recoveryOperation.text,
      recoveryOperation.behavior,
      recoveryOperation.images,
    ).catch(async (error) => {
      await syncWebLiveConversationRun({
        conversationId: resumed.id,
        sessionFile,
        cwd: effectiveCwd,
        title: effectiveTitle,
        profile: effectiveProfile,
        state: 'failed',
        lastError: error instanceof Error ? error.message : String(error),
      });

      logError('conversation recovery error', {
        sessionId: resumed.id,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
    });

    res.json({
      conversationId: resumed.id,
      live: true,
      recovered: true,
      replayedPendingOperation,
      usedFallbackPrompt,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

/** Check if a session is live */
app.get('/api/live-sessions/:id', (req, res) => {
  const live = isLiveSession(req.params.id);
  if (!live) { res.status(404).json({ live: false }); return; }
  const entry = listAllLiveSessions().find((session) => session.id === req.params.id);
  res.json({ live: true, ...entry });
});

app.post('/api/live-sessions/:id/takeover', (req, res) => {
  try {
    const { id } = req.params;
    const surfaceId = typeof req.body?.surfaceId === 'string' ? req.body.surfaceId.trim() : '';
    if (!surfaceId) {
      res.status(400).json({ error: 'surfaceId is required' });
      return;
    }
    if (!isLocalLive(id)) {
      res.status(400).json({ error: 'Takeover is only available for local live conversations right now.' });
      return;
    }

    res.json(takeOverSessionControl(id, surfaceId));
  } catch (error) {
    if (error instanceof LiveSessionControlError) {
      res.status(409).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

/** SSE stream for a live session */
app.get('/api/live-sessions/:id/events', (req, res) => {
  const { id } = req.params;
  if (!isLiveSession(id)) { res.status(404).json({ error: 'Not a live session' }); return; }

  const rawTailBlocks = Array.isArray(req.query.tailBlocks) ? req.query.tailBlocks[0] : req.query.tailBlocks;
  const parsedTailBlocks = typeof rawTailBlocks === 'string'
    ? Number.parseInt(rawTailBlocks, 10)
    : typeof rawTailBlocks === 'number'
      ? rawTailBlocks
      : undefined;
  const tailBlocks = Number.isInteger(parsedTailBlocks) && (parsedTailBlocks as number) > 0
    ? parsedTailBlocks as number
    : undefined;
  const rawSurfaceId = Array.isArray(req.query.surfaceId) ? req.query.surfaceId[0] : req.query.surfaceId;
  const surfaceId = typeof rawSurfaceId === 'string' ? rawSurfaceId.trim() : '';
  const rawSurfaceType = Array.isArray(req.query.surfaceType) ? req.query.surfaceType[0] : req.query.surfaceType;
  const surfaceType = rawSurfaceType === 'mobile_web' ? 'mobile_web' : 'desktop_web';

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send a heartbeat comment every 15s so the connection stays alive
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);

  const unsubscribe = subscribeLiveSession(id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, {
    ...(tailBlocks ? { tailBlocks } : {}),
    ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe?.();
  });
});

function syncConversationProjectReferences(conversationId: string, mentionedProjectIds: string[]): string[] {
  const profile = getCurrentProfile();
  const availableProjectIds = listReferenceableProjectIds();
  const availableProjectIdSet = new Set(availableProjectIds);
  const existingProjectIds = (getConversationProjectLink({
    profile,
    conversationId,
  })?.relatedProjectIds ?? []).filter((projectId) => availableProjectIdSet.has(projectId));
  const relatedProjectIds = [...new Set([...existingProjectIds, ...mentionedProjectIds])];

  const existingMatches = existingProjectIds.length === relatedProjectIds.length
    && existingProjectIds.every((projectId, index) => projectId === relatedProjectIds[index]);

  if (!existingMatches) {
    setConversationProjectLinks({
      profile,
      conversationId,
      relatedProjectIds,
    });
    invalidateAppTopics('projects', 'sessions');
  }

  return relatedProjectIds;
}

function buildReferencedProjectsContext(projectIds: string[]): string {
  const currentProfile = getCurrentProfile();
  const lines = projectIds.map((projectId) => {
    const projectProfile = readProjectProfileById(projectId) ?? currentProfile;
    const paths = resolveProjectPaths({
      repoRoot: REPO_ROOT,
      profile: projectProfile,
      projectId,
    });
    const lineParts = [`- @${projectId}: ${relative(REPO_ROOT, paths.projectFile)}`];

    try {
      const detail = readProjectDetailFromProject({
        repoRoot: REPO_ROOT,
        profile: projectProfile,
        projectId,
      });
      if (projectProfile !== currentProfile) {
        lineParts.push(`  profile: ${projectProfile}`);
      }
      lineParts.push(`  title: ${detail.project.title}`);
      lineParts.push(`  description: ${detail.project.description}`);
      lineParts.push(`  summary: ${detail.project.summary}`);
      lineParts.push(`  goal: ${detail.project.requirements.goal}`);
      if (detail.project.requirements.acceptanceCriteria.length > 0) {
        lineParts.push(`  acceptanceCriteria: ${detail.project.requirements.acceptanceCriteria.join(' | ')}`);
      }
      if (detail.project.planSummary) {
        lineParts.push(`  planSummary: ${detail.project.planSummary}`);
      }
      if (detail.project.completionSummary) {
        lineParts.push(`  completionSummary: ${detail.project.completionSummary}`);
      }
      if (detail.project.currentFocus) {
        lineParts.push(`  currentFocus: ${detail.project.currentFocus}`);
      }
      if (detail.project.repoRoot) {
        lineParts.push(`  repoRoot: ${detail.project.repoRoot}`);
      }
      if (detail.brief) {
        lineParts.push(`  brief: ${relative(REPO_ROOT, detail.brief.path)}`);
      }
      if (detail.noteCount > 0) {
        lineParts.push(`  notesDir: ${relative(REPO_ROOT, paths.notesDir)} (${detail.noteCount} notes)`);
      }
      if (detail.attachmentCount > 0) {
        lineParts.push(`  attachmentsDir: ${relative(REPO_ROOT, paths.attachmentsDir)} (${detail.attachmentCount} files)`);
      }
      if (detail.artifactCount > 0) {
        lineParts.push(`  artifactsDir: ${relative(REPO_ROOT, paths.artifactsDir)} (${detail.artifactCount} files)`);
      }
    } catch {
      // Ignore malformed project metadata in the lightweight reference summary.
    }

    return lineParts.join('\n');
  });

  return [
    'Referenced projects for this conversation:',
    ...lines,
    'Projects are durable cross-conversation hubs. Read the structured project fields, handoff doc, and notes when you need continuity, and use the project tool for structured project CRUD plus conversation reference changes.',
  ].join('\n');
}

interface PromptAttachmentRefInput {
  attachmentId: string;
  revision?: number;
}

function normalizePromptAttachmentRefs(value: unknown): PromptAttachmentRefInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: PromptAttachmentRefInput[] = [];
  const seen = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }

    const attachmentId = typeof (candidate as { attachmentId?: unknown }).attachmentId === 'string'
      ? (candidate as { attachmentId: string }).attachmentId.trim()
      : '';
    if (!attachmentId) {
      continue;
    }

    const revisionCandidate = (candidate as { revision?: unknown }).revision;
    const revision = Number.isInteger(revisionCandidate) && (revisionCandidate as number) > 0
      ? revisionCandidate as number
      : undefined;

    const dedupeKey = `${attachmentId}:${String(revision ?? 'latest')}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    refs.push({
      attachmentId,
      ...(revision ? { revision } : {}),
    });
  }

  return refs;
}

function buildConversationAttachmentsContext(
  attachments: ReturnType<typeof resolveConversationAttachmentPromptFiles>,
): string {
  if (attachments.length === 0) {
    return '';
  }

  const lines = attachments.map((attachment) => {
    const lineParts = [
      `- ${attachment.attachmentId} [${attachment.kind}] ${attachment.title} (rev ${attachment.revision})`,
      `  sourcePath: ${attachment.sourcePath}`,
      `  previewPath: ${attachment.previewPath}`,
      `  sourceMimeType: ${attachment.sourceMimeType}`,
      `  previewMimeType: ${attachment.previewMimeType}`,
    ];

    return lineParts.join('\n');
  });

  return [
    'Referenced conversation attachments:',
    ...lines,
    'Use these local files with tools when needed. The sourcePath points at editable .excalidraw data, and previewPath points at the rendered PNG preview.',
  ].join('\n');
}

/** Send a prompt to a live session */
app.post('/api/live-sessions/:id/prompt', async (req, res) => {
  try {
    const { id } = req.params;
    const { text = '', behavior, images, attachmentRefs } = req.body as {
      text?: string;
      behavior?: 'steer' | 'followUp';
      images?: Array<{ type?: 'image'; data: string; mimeType: string; name?: string }>;
      attachmentRefs?: unknown;
      surfaceId?: string;
    };
    const normalizedAttachmentRefs = normalizePromptAttachmentRefs(attachmentRefs);
    if (!text && (!images || images.length === 0) && normalizedAttachmentRefs.length === 0) {
      res.status(400).json({ error: 'text, images, or attachmentRefs required' });
      return;
    }

    const surfaceId = ensureRequestControlsLocalLiveConversation(id, req.body);
    const isRemoteLive = isRemoteLiveSession(id);

    const currentProfile = getCurrentProfile();
    const tasks = listTasksForCurrentProfile();
    const memoryDocs = listMemoryDocs();
    const skills = listSkillsForCurrentProfile();
    const profileAgents = listProfileAgentItems().map((item) => ({
      id: item.source,
      source: item.source,
      path: item.path,
    }));
    const promptReferences = resolvePromptReferences({
      text,
      availableProjectIds: listReferenceableProjectIds(),
      tasks,
      memoryDocs,
      skills,
      profiles: profileAgents,
    });

    const relatedProjectIds = syncConversationProjectReferences(id, promptReferences.projectIds);
    const referencedTasks = pickPromptReferencesInOrder(promptReferences.taskIds, tasks);
    const referencedMemoryDocs = pickPromptReferencesInOrder(promptReferences.memoryDocIds, memoryDocs);
    const referencedSkills = pickPromptReferencesInOrder(promptReferences.skillNames, skills);
    const referencedProfiles = pickPromptReferencesInOrder(promptReferences.profileIds, profileAgents);

    let referencedAttachments: ReturnType<typeof resolveConversationAttachmentPromptFiles> = [];
    if (normalizedAttachmentRefs.length > 0) {
      try {
        referencedAttachments = resolveConversationAttachmentPromptFiles({
          profile: currentProfile,
          conversationId: id,
          refs: normalizedAttachmentRefs,
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const liveEntry = !isRemoteLive ? liveRegistry.get(id) : undefined;
    const remoteLive = isRemoteLive ? getRemoteLiveSessionMeta(id) : null;
    const sessionFile = liveEntry?.session.sessionFile ?? remoteLive?.sessionFile;
    const daemonRunsRoot = resolveDurableRunsRoot(resolveDaemonRoot());
    const backgroundRunContextEntries = sessionFile
      ? listPendingBackgroundRunResults({
          runsRoot: daemonRunsRoot,
          sessionFile,
        })
      : [];
    const backgroundRunHiddenContext = buildBackgroundRunHiddenContext(backgroundRunContextEntries);

    const automationBeforePrompt = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: id,
      settingsFile: SETTINGS_FILE,
    }).document;
    if (automationBeforePrompt.waitingForUser || automationBeforePrompt.items.some((item) => item.status === 'waiting')) {
      saveConversationAutomationDocument(resumeConversationAutomationAfterUserMessage(automationBeforePrompt));
    }

    const queuedContextBlocks = [
      relatedProjectIds.length > 0 ? buildReferencedProjectsContext(relatedProjectIds) : '',
      referencedAttachments.length > 0 ? buildConversationAttachmentsContext(referencedAttachments) : '',
      referencedTasks.length > 0 ? buildReferencedTasksContext(referencedTasks, REPO_ROOT) : '',
      referencedMemoryDocs.length > 0 ? buildReferencedMemoryDocsContext(referencedMemoryDocs, REPO_ROOT) : '',
      referencedSkills.length > 0 ? buildReferencedSkillsContext(referencedSkills, REPO_ROOT) : '',
      referencedProfiles.length > 0 ? buildReferencedProfilesContext(referencedProfiles, REPO_ROOT) : '',
      backgroundRunHiddenContext,
    ].filter(Boolean);

    const hiddenContext = queuedContextBlocks.join('\n\n');

    if (!isRemoteLive && queuedContextBlocks.length > 0) {
      await queuePromptContext(id, 'referenced_context', hiddenContext);
    }

    if (!isRemoteLive && liveEntry?.session.sessionFile) {
      await syncWebLiveConversationRun({
        conversationId: id,
        sessionFile: liveEntry.session.sessionFile,
        cwd: liveEntry.cwd,
        title: liveEntry.title,
        profile: currentProfile,
        state: 'running',
        pendingOperation: {
          type: 'prompt',
          text,
          ...(behavior ? { behavior } : {}),
          ...(images && images.length > 0
            ? {
                images: images.map((image) => ({
                  type: 'image' as const,
                  data: image.data,
                  mimeType: image.mimeType,
                  ...(image.name ? { name: image.name } : {}),
                })),
              }
            : {}),
          ...(queuedContextBlocks.length > 0
            ? {
                contextMessages: [{
                  customType: 'referenced_context',
                  content: hiddenContext,
                }],
              }
            : {}),
          enqueuedAt: new Date().toISOString(),
        },
      });
    }

    if (isRemoteLive && referencedAttachments.length > 0) {
      res.status(400).json({ error: 'Remote conversations do not support local attachment references yet.' });
      return;
    }

    const promptImages = images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
      ...(image.name ? { name: image.name } : {}),
    }));
    const submittedPrompt = isRemoteLive
      ? await submitRemoteLiveSessionPrompt({
          conversationId: id,
          text,
          behavior,
          images: promptImages,
          ...(hiddenContext ? { hiddenContext } : {}),
        })
      : await submitLocalPromptSession(id, text, behavior, promptImages, surfaceId);
    const promptPromise = submittedPrompt.completion;

    void promptPromise.then(async () => {
      if (!sessionFile || backgroundRunContextEntries.length === 0) {
        return;
      }

      try {
        const deliveredIds = markBackgroundRunResultsDelivered({
          runsRoot: daemonRunsRoot,
          sessionFile,
          resultIds: backgroundRunContextEntries.map((entry) => entry.id),
        });
        if (deliveredIds.length > 0) {
          invalidateAppTopics('runs');
        }
      } catch (error) {
        logError('background run context completion error', {
          sessionId: id,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }).catch(async (err) => {
      if (!isRemoteLive && liveEntry?.session.sessionFile) {
        await syncWebLiveConversationRun({
          conversationId: id,
          sessionFile: liveEntry.session.sessionFile,
          cwd: liveEntry.cwd,
          title: liveEntry.title,
          profile: currentProfile,
          state: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        });
      }

      logError('live prompt error', {
        sessionId: id,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
    res.json({
      ok: true,
      accepted: true,
      delivery: submittedPrompt.acceptedAs,
      relatedProjectIds,
      referencedTaskIds: promptReferences.taskIds,
      referencedMemoryDocIds: promptReferences.memoryDocIds,
      referencedSkillNames: promptReferences.skillNames,
      referencedProfileIds: promptReferences.profileIds,
      referencedAttachmentIds: referencedAttachments.map((attachment) => attachment.attachmentId),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/dequeue', (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

    const { behavior, index } = req.body as {
      behavior?: 'steer' | 'followUp';
      index?: number;
      surfaceId?: string;
    };

    if (behavior !== 'steer' && behavior !== 'followUp') {
      res.status(400).json({ error: 'behavior must be "steer" or "followUp"' });
      return;
    }

    if (!Number.isInteger(index) || (index as number) < 0) {
      res.status(400).json({ error: 'index must be a non-negative integer' });
      return;
    }

    const restored = restoreQueuedMessage(req.params.id, behavior, index as number);
    res.json({ ok: true, ...restored });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    const status = message.includes('Queued prompt changed before it could be restored')
      || message.includes('Queued prompt restore is unavailable')
      ? 409
      : 500;
    res.status(status).json({ error: message });
  }
});

app.post('/api/live-sessions/:id/compact', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    const { customInstructions } = req.body as { customInstructions?: string; surfaceId?: string };
    const result = await compactSession(req.params.id, customInstructions?.trim() || undefined);
    res.json({ ok: true, result });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/reload', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    await reloadSessionResources(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/export', async (req, res) => {
  try {
    const { outputPath } = req.body as { outputPath?: string };
    const path = await exportSessionHtml(req.params.id, outputPath?.trim() || undefined);
    res.json({ ok: true, path });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/live-sessions/:id/name', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    const { name } = req.body as { name?: string; surfaceId?: string };
    const nextName = name?.trim();
    if (!nextName) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    renameSession(req.params.id, nextName);
    res.json({ ok: true, name: nextName });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

/** Abort a running agent */
app.post('/api/live-sessions/:id/abort', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    await abortLiveSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

/** Get token usage stats for a live session */
app.get('/api/live-sessions/:id/context', (req, res) => {
  const startedAt = process.hrtime.bigint();

  try {
    const { id } = req.params;
    const liveEntry = liveRegistry.get(id);
    const remoteLive = getRemoteLiveSessionMeta(id);
    const initialArchivedTail = liveEntry ? null : readSessionBlocksWithTelemetry(id, { tailBlocks: 120 });
    const cwd = liveEntry?.cwd ?? remoteLive?.cwd ?? initialArchivedTail?.detail?.meta.cwd;
    if (!cwd) { res.status(404).json({ error: 'Session not found' }); return; }

    const gitSummaryRead = remoteLive
      ? { summary: null, telemetry: { cache: 'hit' as const, durationMs: 0, hasRepo: false } satisfies GitStatusReadTelemetry }
      : readGitStatusSummaryWithTelemetry(cwd);
    const gitSummary = gitSummaryRead.summary;

    // User messages: prefer local live in-memory messages (most up-to-date), otherwise use a small persisted tail.
    let userMessages: { id: string; ts: string; text: string; imageCount: number }[] = [];
    let userMessageSource: 'live' | 'tail-120' | 'tail-400' | 'none' = liveEntry ? 'live' : 'none';
    let userMessageReadTelemetry: SessionDetailReadTelemetry | null = null;
    if (liveEntry) {
      userMessages = liveEntry.session.messages
        .filter((message) => message.role === 'user')
        .slice(-5)
        .map((message, index) => {
          const { text, imageCount } = summarizeUserMessageContent(message.content);
          return { id: String(index), ts: new Date().toISOString(), text: text.slice(0, 300), imageCount };
        });
    } else if (initialArchivedTail) {
      const recentTailUserMessages = (initialArchivedTail.detail?.blocks ?? []).filter((block) => block.type === 'user');
      const expandedTail = initialArchivedTail.detail && recentTailUserMessages.length < 5 && initialArchivedTail.detail.blockOffset > 0
        ? readSessionBlocksWithTelemetry(id, { tailBlocks: 400 })
        : initialArchivedTail;
      userMessageSource = expandedTail === initialArchivedTail ? 'tail-120' : 'tail-400';
      userMessageReadTelemetry = expandedTail.telemetry;
      userMessages = (expandedTail.detail?.blocks ?? [])
        .filter((block) => block.type === 'user')
        .slice(-5)
        .map((block) => ({
          id: block.id,
          ts: block.ts,
          text: 'text' in block ? block.text : '',
          imageCount: 'images' in block && Array.isArray(block.images) ? block.images.length : 0,
        }));
    }

    const relatedProjectIds = getConversationProjectLink({
      profile: getCurrentProfile(),
      conversationId: id,
    })?.relatedProjectIds ?? [];

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    setServerTimingHeaders(res, [
      { name: 'git', durationMs: gitSummaryRead.telemetry.durationMs, description: remoteLive ? 'remote-skip' : gitSummaryRead.telemetry.cache },
      { name: 'user_msgs', durationMs: userMessageReadTelemetry?.durationMs ?? 0, description: userMessageSource },
      { name: 'total', durationMs },
    ], {
      route: 'live-session-context',
      conversationId: id,
      git: gitSummaryRead.telemetry,
      userMessages: {
        source: userMessageSource,
        telemetry: userMessageReadTelemetry,
        count: userMessages.length,
      },
      durationMs,
    });
    logSlowConversationPerf('live session context request', {
      conversationId: id,
      durationMs,
      gitCache: gitSummaryRead.telemetry.cache,
      userMessageSource,
      userMessageReadDurationMs: userMessageReadTelemetry?.durationMs,
      userMessageReadLoader: userMessageReadTelemetry?.loader,
    });

    res.json({
      cwd,
      branch: gitSummary?.branch ?? null,
      git: gitSummary
        ? {
            changeCount: gitSummary.changeCount,
            linesAdded: gitSummary.linesAdded,
            linesDeleted: gitSummary.linesDeleted,
            changes: gitSummary.changes.map((change) => ({
              relativePath: change.relativePath,
              change: change.change,
            })),
          }
        : null,
      userMessages,
      relatedProjectIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/plan/events', (req, res) => {
  const conversationId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 1000\n\n');

  let closed = false;
  let writeQueue = Promise.resolve();

  const writeEvent = (event: { type: 'snapshot'; data: Awaited<ReturnType<typeof buildConversationAutomationResponse>> }) => {
    if (closed) {
      return;
    }

    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const enqueueWrite = (task: () => Promise<void> | void) => {
    writeQueue = writeQueue
      .then(async () => {
        if (closed) {
          return;
        }

        await task();
      })
      .catch((error) => {
        logWarn('conversation automation event stream write failed', {
          conversationId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const writeSnapshot = async () => {
    const data = await buildConversationAutomationResponse(conversationId);
    writeEvent({ type: 'snapshot', data });
  };

  enqueueWrite(writeSnapshot);

  const heartbeat = setInterval(() => {
    if (!closed) {
      res.write(': heartbeat\n\n');
    }
  }, 15_000);
  const unsubscribe = subscribeConversationAutomation(conversationId, () => {
    enqueueWrite(writeSnapshot);
  });

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.get('/api/conversations/:id/plan', async (req, res) => {
  try {
    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/conversations/:id/plan', async (req, res) => {
  try {
    const body = req.body as {
      enabled?: boolean;
      items?: unknown;
    };

    if (typeof body.enabled !== 'boolean' && !Array.isArray(body.items)) {
      res.status(400).json({ error: 'enabled or items required' });
      return;
    }

    const skillNames = new Set(listSkillsForCurrentProfile().map((skill) => skill.name));
    if (Array.isArray(body.items)) {
      validateConversationAutomationTemplateItems(body.items, skillNames);
    }

    let document = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
      settingsFile: SETTINGS_FILE,
    }).document;
    const updatedAt = new Date().toISOString();

    if (Array.isArray(body.items)) {
      document = replaceConversationAutomationItems(document, body.items, updatedAt);
    }

    if (typeof body.enabled === 'boolean') {
      document = updateConversationAutomationEnabled(document, body.enabled, updatedAt);
    }

    saveConversationAutomationDocument(document);

    if (document.enabled) {
      await kickConversationAutomation(req.params.id);
    }

    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unknown skill:')
      || message.includes('items must be an array')
      || message.includes('Each item')
      || message.includes('Each skill item')
      || message.includes('Each instruction item')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/conversations/:id/plan/items/:itemId/reset', async (req, res) => {
  try {
    const { resume } = req.body as { resume?: boolean };
    const loaded = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
      settingsFile: SETTINGS_FILE,
    });
    const document = loaded.document;
    const item = document.items.find((candidate) => candidate.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'Automation item not found' });
      return;
    }
    if (document.activeItemId === item.id || item.status === 'running') {
      res.status(409).json({ error: 'Running automation items cannot be reset' });
      return;
    }

    saveConversationAutomationDocument(resetConversationAutomationFromItem(document, req.params.itemId, {
      enabled: resume === true ? true : document.enabled,
    }));

    if (resume) {
      await kickConversationAutomation(req.params.id);
    }

    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

app.post('/api/conversations/:id/plan/items/:itemId/status', async (req, res) => {
  try {
    const { checked } = req.body as { checked?: unknown };
    if (typeof checked !== 'boolean') {
      res.status(400).json({ error: 'checked must be a boolean' });
      return;
    }

    const loaded = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
      settingsFile: SETTINGS_FILE,
    });
    const document = loaded.document;
    const item = document.items.find((candidate) => candidate.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'Automation item not found' });
      return;
    }
    if (document.activeItemId === item.id || item.status === 'running') {
      res.status(409).json({ error: 'Running automation items cannot be edited from the checklist.' });
      return;
    }

    const nextDocument = checked
      ? updateConversationAutomationItemStatus(document, req.params.itemId, 'completed', {
        resultReason: 'Completed from the checklist UI.',
      })
      : setConversationAutomationItemPending(document, req.params.itemId, {
        enabled: document.enabled,
      });
    saveConversationAutomationDocument(nextDocument);

    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

app.get('/api/conversations/:id/execution', async (req, res) => {
  const startedAt = process.hrtime.bigint();

  try {
    const execution = await readConversationExecutionStateWithTelemetry(req.params.id);
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    setServerTimingHeaders(res, [
      { name: 'runs', durationMs: execution.telemetry.durationMs, description: `${execution.telemetry.cache}/${execution.telemetry.source}` },
      { name: 'total', durationMs },
    ], {
      route: 'conversation-execution',
      conversationId: req.params.id,
      runs: execution.telemetry,
      durationMs,
    });
    logSlowConversationPerf('conversation execution request', {
      conversationId: req.params.id,
      durationMs,
      runsCache: execution.telemetry.cache,
      runsSource: execution.telemetry.source,
      runsDurationMs: execution.telemetry.durationMs,
    });

    res.json(execution.state);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/conversations/:id/remote-connection', (req, res) => {
  try {
    res.json(getRemoteConversationConnectionState({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
    }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/conversations/:id/remote-connection/events', (req, res) => {
  const conversationId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
  res.write('retry: 1000\n\n');

  const writeSnapshot = () => {
    const data = getRemoteConversationConnectionState({
      profile: getCurrentProfile(),
      conversationId,
    });
    res.write(`data: ${JSON.stringify({ type: 'snapshot', data })}\n\n`);
  };

  writeSnapshot();

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15_000);
  const unsubscribe = subscribeRemoteConversationConnection(conversationId, writeSnapshot);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

app.patch('/api/conversations/:id/execution', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

    const targetId = req.body?.targetId === null
      ? null
      : typeof req.body?.targetId === 'string'
        ? req.body.targetId.trim() || null
        : null;

    if (targetId && !getExecutionTarget({ targetId })) {
      res.status(400).json({ error: `Execution target ${targetId} not found.` });
      return;
    }

    const profile = getCurrentProfile();
    const previous = getConversationExecutionTarget({
      profile,
      conversationId: req.params.id,
    });

    if (previous?.targetId && previous.targetId !== targetId) {
      await stopRemoteLiveSession(req.params.id).catch(() => undefined);
      clearRemoteConversationBindingForConversation({
        profile,
        conversationId: req.params.id,
      });
    }

    setConversationExecutionTarget({
      profile,
      conversationId: req.params.id,
      targetId,
    });

    if (targetId === null) {
      clearRemoteConversationBindingForConversation({
        profile,
        conversationId: req.params.id,
      });
    }

    invalidateAppTopics('executionTargets');
    res.json(await readConversationExecutionState(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(message.startsWith('Invalid') ? 400 : 500).json({ error: message });
  }
});

app.patch('/api/conversations/:id/title', (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    const { name } = req.body as { name?: string; surfaceId?: string };
    const nextName = name?.trim();
    if (!nextName) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    const conversationId = req.params.id;
    if (isLocalLive(conversationId)) {
      renameSession(conversationId, nextName);
      res.json({ ok: true, title: nextName });
      return;
    }

    const renamed = renameStoredSession(conversationId, nextName);
    invalidateAppTopics('sessions');
    res.json({ ok: true, title: renamed.title });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found')
      ? 404
      : message.includes('must not be empty') || message.endsWith('required')
        ? 400
        : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(status).json({ error: message });
  }
});

app.post('/api/conversations/:id/cwd', async (req, res) => {
  try {
    const { cwd: requestedCwd } = req.body as { cwd?: string };
    const conversationId = req.params.id;
    const profile = getCurrentProfile();
    const remoteBinding = readRemoteConversationBindingForConversation({
      profile,
      conversationId,
    });

    const liveEntry = liveRegistry.get(conversationId);
    const sessionDetail = readSessionBlocks(conversationId);
    const currentCwd = liveEntry?.cwd ?? sessionDetail?.meta.cwd;
    const sourceSessionFile = liveEntry?.session.sessionFile ?? sessionDetail?.meta.file;

    if (!currentCwd || !sourceSessionFile) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    if (remoteBinding) {
      const remoteLive = getRemoteLiveSessionMeta(conversationId);
      if (remoteLive?.isStreaming) {
        res.status(409).json({ error: 'Stop the current response before changing the working directory.' });
        return;
      }

      const resolved = await browseRemoteTargetDirectory({
        targetId: remoteBinding.targetId,
        cwd: requestedCwd,
        baseCwd: currentCwd,
      });

      if (resolved.cwd === currentCwd) {
        res.json({ id: conversationId, sessionFile: sourceSessionFile, cwd: currentCwd, changed: false });
        return;
      }

      const result = forkLocalMirrorSession({
        sessionFile: sourceSessionFile,
        remoteCwd: resolved.cwd,
      });

      const relatedProjectIds = getConversationProjectLink({
        profile,
        conversationId,
      })?.relatedProjectIds ?? [];

      if (relatedProjectIds.length > 0) {
        setConversationProjectLinks({
          profile,
          conversationId: result.id,
          relatedProjectIds,
        });
      }

      setConversationExecutionTarget({
        profile,
        conversationId: result.id,
        targetId: remoteBinding.targetId,
      });
      await createRemoteLiveSession({
        profile,
        targetId: remoteBinding.targetId,
        remoteCwd: resolved.cwd,
        localSessionFile: result.sessionFile,
        conversationId: result.id,
        bootstrapLocalSessionFile: result.sessionFile,
      });

      if (remoteLive) {
        await stopRemoteLiveSession(conversationId).catch(() => undefined);
      }

      invalidateAppTopics('projects', 'sessions');
      res.json({ id: result.id, sessionFile: result.sessionFile, cwd: resolved.cwd, changed: true });
      return;
    }

    if (liveEntry?.session.isStreaming) {
      res.status(409).json({ error: 'Stop the current response before changing the working directory.' });
      return;
    }

    const nextCwd = resolveRequestedCwd(requestedCwd, currentCwd);
    if (!nextCwd) {
      res.status(400).json({ error: 'cwd required' });
      return;
    }

    if (!existsSync(nextCwd)) {
      res.status(400).json({ error: `Directory does not exist: ${nextCwd}` });
      return;
    }

    if (!statSync(nextCwd).isDirectory()) {
      res.status(400).json({ error: `Not a directory: ${nextCwd}` });
      return;
    }

    if (nextCwd === currentCwd) {
      res.json({ id: conversationId, sessionFile: sourceSessionFile, cwd: currentCwd, changed: false });
      return;
    }

    const result = await createSessionFromExisting(sourceSessionFile, nextCwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });

    const relatedProjectIds = getConversationProjectLink({
      profile,
      conversationId,
    })?.relatedProjectIds ?? [];

    if (relatedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds,
      });
      invalidateAppTopics('projects', 'sessions');
    }

    if (liveEntry) {
      destroySession(conversationId);
    }

    res.json({ id: result.id, sessionFile: result.sessionFile, cwd: nextCwd, changed: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/artifacts', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const artifacts = listConversationArtifacts({
      profile,
      conversationId: req.params.id,
    });

    res.json({ conversationId: req.params.id, artifacts });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/artifacts/:artifactId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const artifact = getConversationArtifact({
      profile,
      conversationId: req.params.id,
      artifactId: req.params.artifactId,
    });

    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    res.json({ conversationId: req.params.id, artifact });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/conversations/:id/artifacts/:artifactId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const deleted = deleteConversationArtifact({
      profile,
      conversationId: req.params.id,
      artifactId: req.params.artifactId,
    });

    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      deleted,
      artifactId: req.params.artifactId,
      artifacts: listConversationArtifacts({ profile, conversationId: req.params.id }),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/attachments', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const attachments = listConversationAttachments({
      profile,
      conversationId: req.params.id,
    });

    res.json({ conversationId: req.params.id, attachments });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/attachments/:attachmentId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const attachment = getConversationAttachment({
      profile,
      conversationId: req.params.id,
      attachmentId: req.params.attachmentId,
    });

    if (!attachment) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    res.json({ conversationId: req.params.id, attachment });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/conversations/:id/attachments', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const body = req.body as {
      kind?: 'excalidraw';
      title?: string;
      sourceData?: string;
      sourceName?: string;
      sourceMimeType?: string;
      previewData?: string;
      previewName?: string;
      previewMimeType?: string;
      note?: string;
    };

    if (!body.sourceData || !body.previewData) {
      res.status(400).json({ error: 'sourceData and previewData are required.' });
      return;
    }

    const attachment = saveConversationAttachment({
      profile,
      conversationId: req.params.id,
      kind: body.kind ?? 'excalidraw',
      title: body.title,
      sourceData: body.sourceData,
      sourceName: body.sourceName,
      sourceMimeType: body.sourceMimeType,
      previewData: body.previewData,
      previewName: body.previewName,
      previewMimeType: body.previewMimeType,
      note: body.note,
    });

    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      attachment,
      attachments: listConversationAttachments({ profile, conversationId: req.params.id }),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/conversations/:id/attachments/:attachmentId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const body = req.body as {
      title?: string;
      sourceData?: string;
      sourceName?: string;
      sourceMimeType?: string;
      previewData?: string;
      previewName?: string;
      previewMimeType?: string;
      note?: string;
    };

    if (!body.sourceData || !body.previewData) {
      res.status(400).json({ error: 'sourceData and previewData are required.' });
      return;
    }

    const existing = getConversationAttachment({
      profile,
      conversationId: req.params.id,
      attachmentId: req.params.attachmentId,
    });

    if (!existing) {
      res.status(404).json({ error: 'Attachment not found' });
      return;
    }

    const attachment = saveConversationAttachment({
      profile,
      conversationId: req.params.id,
      attachmentId: req.params.attachmentId,
      title: body.title,
      sourceData: body.sourceData,
      sourceName: body.sourceName,
      sourceMimeType: body.sourceMimeType,
      previewData: body.previewData,
      previewName: body.previewName,
      previewMimeType: body.previewMimeType,
      note: body.note,
    });

    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      attachment,
      attachments: listConversationAttachments({ profile, conversationId: req.params.id }),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/conversations/:id/attachments/:attachmentId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const deleted = deleteConversationAttachment({
      profile,
      conversationId: req.params.id,
      attachmentId: req.params.attachmentId,
    });

    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      deleted,
      attachmentId: req.params.attachmentId,
      attachments: listConversationAttachments({ profile, conversationId: req.params.id }),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/attachments/:attachmentId/download/:asset', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const asset = req.params.asset === 'source' ? 'source' : req.params.asset === 'preview' ? 'preview' : null;
    if (!asset) {
      res.status(400).json({ error: 'asset must be "source" or "preview"' });
      return;
    }

    const revisionQuery = typeof req.query.revision === 'string'
      ? Number.parseInt(req.query.revision, 10)
      : undefined;

    if (req.query.revision !== undefined && (!Number.isInteger(revisionQuery) || (revisionQuery as number) <= 0)) {
      res.status(400).json({ error: 'revision must be a positive integer when provided.' });
      return;
    }

    const download = readConversationAttachmentDownload({
      profile,
      conversationId: req.params.id,
      attachmentId: req.params.attachmentId,
      asset,
      ...(revisionQuery ? { revision: revisionQuery } : {}),
    });

    res.setHeader('Content-Type', download.mimeType);
    res.setHeader('Content-Disposition', buildContentDispositionHeader(
      asset === 'preview' ? 'inline' : 'attachment',
      download.fileName,
    ));
    res.sendFile(download.filePath);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });

    const message = err instanceof Error ? err.message : String(err);
    if (message.toLowerCase().includes('not found')) {
      res.status(404).json({ error: message });
      return;
    }

    res.status(500).json({ error: message });
  }
});

app.get('/api/conversations/:id/projects', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const relatedProjectIds = getConversationProjectLink({
      profile,
      conversationId: req.params.id,
    })?.relatedProjectIds ?? [];
    res.json({ conversationId: req.params.id, relatedProjectIds });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/conversations/:id/projects', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const { projectId } = req.body as { projectId?: string };
    if (!projectId) { res.status(400).json({ error: 'projectId required' }); return; }

    const document = addConversationProjectLink({
      profile,
      conversationId: req.params.id,
      projectId,
    });

    invalidateAppTopics('projects', 'sessions');
    res.json({ conversationId: req.params.id, relatedProjectIds: document.relatedProjectIds });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/conversations/:id/projects/:projectId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const document = removeConversationProjectLink({
      profile,
      conversationId: req.params.id,
      projectId: req.params.projectId,
    });

    invalidateAppTopics('projects', 'sessions');
    res.json({ conversationId: req.params.id, relatedProjectIds: document.relatedProjectIds });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/conversations/:id/deferred-resumes', (req, res) => {
  try {
    const sessionFile = resolveConversationSessionFile(req.params.id);
    if (!sessionFile) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json({
      conversationId: req.params.id,
      resumes: listDeferredResumesForSessionFile(sessionFile),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/conversations/:id/deferred-resumes', async (req, res) => {
  try {
    const sessionFile = resolveConversationSessionFile(req.params.id);
    if (!sessionFile) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const { delay, prompt } = req.body as { delay?: string; prompt?: string };
    if (!delay || delay.trim().length === 0) {
      res.status(400).json({ error: 'delay is required' });
      return;
    }

    const resumeRecord = await scheduleDeferredResumeForSessionFile({
      sessionFile,
      delay,
      prompt,
    });

    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      resume: resumeRecord,
      resumes: listDeferredResumesForSessionFile(sessionFile),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post('/api/conversations/:id/deferred-resumes/:resumeId/fire', async (req, res) => {
  try {
    const sessionFile = resolveConversationSessionFile(req.params.id);
    if (!sessionFile) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const resume = await fireDeferredResumeNowForSessionFile({
      sessionFile,
      id: req.params.resumeId,
    });

    await flushLiveDeferredResumes();
    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      resume,
      resumes: listDeferredResumesForSessionFile(sessionFile),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.delete('/api/conversations/:id/deferred-resumes/:resumeId', async (req, res) => {
  try {
    const sessionFile = resolveConversationSessionFile(req.params.id);
    if (!sessionFile) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    await cancelDeferredResumeForSessionFile({
      sessionFile,
      id: req.params.resumeId,
    });

    invalidateAppTopics('sessions');
    res.json({
      conversationId: req.params.id,
      cancelledId: req.params.resumeId,
      resumes: listDeferredResumesForSessionFile(sessionFile),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch('/api/conversations/:id/attention', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const { id } = req.params;
    const { read } = req.body as { read?: boolean };
    const session = listConversationSessionsSnapshot().find((entry) => entry.id === id);

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (read === false) {
      markConversationAttentionUnread({
        profile,
        conversationId: id,
        messageCount: session.messageCount,
      });
    } else {
      markConversationAttentionRead({
        profile,
        conversationId: id,
        messageCount: session.messageCount,
      });
    }

    invalidateAppTopics('sessions');
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/live-sessions/:id/fork-entries', (req, res) => {
  const liveEntry = liveRegistry.get(req.params.id);
  if (!liveEntry) { res.status(404).json({ error: 'Session not live' }); return; }
  try {
    res.json(liveEntry.session.getUserMessagesForForking());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/branch', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    const { entryId } = req.body as { entryId: string; surfaceId?: string };
    if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
    res.json(await branchSession(req.params.id, entryId, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    }));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/fork', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    const { entryId, preserveSource } = req.body as { entryId: string; preserveSource?: boolean; surfaceId?: string };
    if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
    res.json(await forkSession(req.params.id, entryId, {
      preserveSource,
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    }));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/live-sessions/:id/stats', (req, res) => {
  const stats = getSessionStats(req.params.id);
  if (!stats) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(stats);
});

app.get('/api/live-sessions/:id/context-usage', (req, res) => {
  if (isRemoteLiveSession(req.params.id)) {
    res.json({ tokens: null, modelId: undefined, contextWindow: undefined });
    return;
  }

  const usage = getSessionContextUsage(req.params.id);
  if (!usage) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(usage);
});

/** Destroy / close a live session */
app.delete('/api/live-sessions/:id', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);

    if (isRemoteLiveSession(req.params.id)) {
      await stopRemoteLiveSession(req.params.id);
      res.json({ ok: true });
      return;
    }

    destroySession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    if (writeLiveConversationControlError(res, err)) {
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ── Projects ─────────────────────────────────────────────────────────────────

function readProjectIndexForProfile(profile = getCurrentProfile()) {
  return listProjectIndex({
    repoRoot: REPO_ROOT,
    profile,
  });
}

function readProjectIndexForSelection(profile: string | 'all') {
  if (profile !== 'all') {
    const index = readProjectIndexForProfile(profile);
    return {
      profile,
      projects: index.projects.map((project) => ({ ...project, profile })),
      invalidProjects: index.invalidProjects.map((project) => ({ ...project, profile })),
    };
  }

  const projects: Array<ReturnType<typeof annotateProjectRecord>> = [];
  const invalidProjects: InvalidProjectRecord[] = [];

  for (const availableProfile of listAvailableProfiles()) {
    const index = readProjectIndexForProfile(availableProfile);
    projects.push(...index.projects.map((project) => ({ ...project, profile: availableProfile })));
    invalidProjects.push(...index.invalidProjects.map((project) => ({ ...project, profile: availableProfile })));
  }

  projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return {
    profile,
    projects,
    invalidProjects,
  };
}

function listProjectsForCurrentProfile() {
  return readProjectIndexForSelection(getCurrentProfile()).projects;
}

function listReferenceableProjectIds(): string[] {
  return listAllProjectIds({ repoRoot: REPO_ROOT });
}

function readProjectProfileById(projectId: string): string | null {
  try {
    return readProjectOwnerProfile({ repoRoot: REPO_ROOT, projectId });
  } catch {
    return null;
  }
}

function projectErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return /not found/i.test(message) ? 404 : 400;
}

app.get('/api/projects', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req, { allowAll: true });
    const index = readProjectIndexForSelection(profile);
    res.set('X-Personal-Agent-Project-Warning-Count', String(index.invalidProjects.length));
    res.json(index.projects);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
});

app.get('/api/projects/diagnostics', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req, { allowAll: true });
    const index = readProjectIndexForSelection(profile);
    res.json({
      profile,
      invalidProjects: index.invalidProjects,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/projects/:id/package', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const projectPackage = exportProjectSharePackage({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
    });
    const fileName = buildProjectSharePackageFileName({
      projectId: projectPackage.source.projectId,
      exportedAt: projectPackage.exportedAt,
    });

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', buildContentDispositionHeader('attachment', fileName));
    res.send(`${JSON.stringify(projectPackage, null, 2)}\n`);
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      title?: string;
      description?: string;
      repoRoot?: string | null;
      summary?: string;
      goal?: string;
      acceptanceCriteria?: string[];
      planSummary?: string;
      completionSummary?: string | null;
      status?: string;
      currentFocus?: string | null;
      blockers?: string[];
      recentProgress?: string[];
    };

    const detail = createProjectRecord({
      repoRoot: REPO_ROOT,
      profile,
      title: body.title ?? '',
      description: body.description ?? '',
      projectRepoRoot: body.repoRoot,
      summary: body.summary,
      goal: body.goal,
      acceptanceCriteria: body.acceptanceCriteria,
      planSummary: body.planSummary,
      completionSummary: body.completionSummary,
      status: body.status,
      currentFocus: body.currentFocus,
      blockers: body.blockers,
      recentProgress: body.recentProgress,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForProfile(detail.project.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      title?: string;
      description?: string;
      repoRoot?: string | null;
      summary?: string;
      goal?: string;
      acceptanceCriteria?: string[];
      planSummary?: string | null;
      completionSummary?: string | null;
      status?: string;
      currentFocus?: string | null;
      currentMilestoneId?: string | null;
      blockers?: string[];
      recentProgress?: string[];
    };

    updateProjectRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      title: body.title,
      description: body.description,
      projectRepoRoot: body.repoRoot,
      summary: body.summary,
      goal: body.goal,
      acceptanceCriteria: body.acceptanceCriteria,
      planSummary: body.planSummary,
      completionSummary: body.completionSummary,
      status: body.status,
      currentFocus: body.currentFocus,
      currentMilestoneId: body.currentMilestoneId,
      blockers: body.blockers,
      recentProgress: body.recentProgress,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const result = deleteProjectRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
    });
    invalidateAppTopics('projects');
    res.json(result);
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/archive', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    setProjectArchivedState({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      archived: true,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/unarchive', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    setProjectArchivedState({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      archived: false,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/brief', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as { content?: string };
    saveProjectBrief({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      content: body.content ?? '',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/brief/regenerate', async (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const detail = readProjectDetailForProfile(req.params.id, profile);
    const brief = await generateProjectBrief({
      detail,
      linkedConversations: detail.linkedConversations,
      activityEntries: listActivityForProfile(profile).filter((entry) => (entry.relatedProjectIds ?? []).includes(req.params.id)),
      settingsFile: SETTINGS_FILE,
      authFile: AUTH_FILE,
    });
    saveProjectBrief({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      content: brief,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/notes', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as { title?: string; kind?: string; body?: string };
    createProjectNoteRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      title: body.title ?? '',
      kind: body.kind ?? 'note',
      body: body.body,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id/notes/:noteId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as { title?: string; kind?: string; body?: string };
    updateProjectNoteRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      noteId: req.params.noteId,
      title: body.title,
      kind: body.kind,
      body: body.body,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/notes/:noteId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    deleteProjectNoteRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      noteId: req.params.noteId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/files', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      kind?: 'attachment' | 'artifact';
      name?: string;
      mimeType?: string;
      title?: string;
      description?: string;
      data?: string;
    };
    uploadProjectFile({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      kind: body.kind ?? 'attachment',
      name: body.name ?? '',
      mimeType: body.mimeType,
      title: body.title,
      description: body.description,
      data: body.data ?? '',
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/projects/:id/files/:kind/:fileId/download', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const download = readProjectFileDownload({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      kind: req.params.kind === 'artifact' ? 'artifact' : 'attachment',
      fileId: req.params.fileId,
    });
    if (download.file.mimeType) {
      res.type(download.file.mimeType);
    }
    res.setHeader('Content-Disposition', buildContentDispositionHeader('attachment', download.file.originalName));
    res.sendFile(download.filePath);
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/files/:kind/:fileId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    deleteProjectFileRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      kind: req.params.kind === 'artifact' ? 'artifact' : 'attachment',
      fileId: req.params.fileId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/milestones', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      title?: string;
      status?: string;
      summary?: string;
      makeCurrent?: boolean;
    };

    addProjectMilestone({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      title: body.title ?? '',
      status: body.status ?? '',
      summary: body.summary,
      makeCurrent: body.makeCurrent,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id/milestones/:milestoneId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      title?: string;
      status?: string;
      summary?: string | null;
      makeCurrent?: boolean;
    };

    updateProjectMilestone({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
      title: body.title,
      status: body.status,
      summary: body.summary,
      makeCurrent: body.makeCurrent,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/tasks', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      title?: string;
      status?: string;
      milestoneId?: string | null;
    };

    createProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      title: body.title ?? '',
      status: body.status ?? '',
      milestoneId: body.milestoneId,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id/tasks/:taskId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as {
      title?: string;
      status?: string;
      milestoneId?: string | null;
    };

    updateProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      taskId: req.params.taskId,
      title: body.title,
      status: body.status,
      milestoneId: body.milestoneId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/milestones/:milestoneId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    deleteProjectMilestone({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/milestones/:milestoneId/move', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as { direction?: 'up' | 'down' };

    moveProjectMilestone({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
      direction: body.direction ?? 'up',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/tasks/:taskId', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    deleteProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      taskId: req.params.taskId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/tasks/:taskId/move', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as { direction?: 'up' | 'down' };

    moveProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      taskId: req.params.taskId,
      direction: body.direction ?? 'up',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/projects/:id/source', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    res.json(readProjectSource({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/source', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const body = req.body as { content?: string };
    saveProjectSource({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      content: body.content ?? '',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ── Shell run ─────────────────────────────────────────────────────────────────

app.post('/api/execution-targets/:targetId/folders', async (req, res) => {
  try {
    const { cwd, baseCwd } = req.body as { cwd?: string; baseCwd?: string };
    const result = await browseRemoteTargetDirectory({
      targetId: req.params.targetId,
      cwd,
      baseCwd,
    });
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('not found')
      ? 404
      : message.includes('Directory does not exist') || message.includes('Not a directory') || message.endsWith('required')
        ? 400
        : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/folder-picker', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd } = req.body as { cwd?: string };
    const result = pickFolder({
      initialDirectory: resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd,
      prompt: 'Choose working directory',
    });
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/workspace', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
      ? req.query.cwd
      : defaultWebCwd;
    const resolvedCwd = resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
    const snapshot = readWorkspaceSnapshot(resolvedCwd);
    retainWorkspaceWatch(snapshot.root);
    res.json(snapshot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/workspace/git-status', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
      ? req.query.cwd
      : defaultWebCwd;
    const resolvedCwd = resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
    const summary = readWorkspaceGitStatus(resolvedCwd);
    retainWorkspaceWatch(summary.root);
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/workspace/git-diff', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
      ? req.query.cwd
      : defaultWebCwd;
    const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    const scope = typeof req.query.scope === 'string' ? req.query.scope.trim() : '';
    if (!path) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    if (scope !== 'staged' && scope !== 'unstaged' && scope !== 'untracked' && scope !== 'conflicted') {
      res.status(400).json({ error: 'scope required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
    const detail = readWorkspaceGitDiff({ cwd: resolvedCwd, path, scope });
    retainWorkspaceWatch(detail.root);
    res.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'path required'
      || message === 'scope required'
      || message === 'Git repository required.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      || message.startsWith('Path is outside the workspace root:')
      || message.startsWith('Git status entry not found for path:')
      || message.startsWith('No staged change found for path:')
      || message.startsWith('No unstaged change found for path:')
      || message.startsWith('No untracked change found for path:')
      || message.startsWith('No conflicted change found for path:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/git/stage', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd, path } = req.body as { cwd?: string; path?: string };
    if (typeof path !== 'string' || path.trim().length === 0) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const summary = stageWorkspaceGitPath({ cwd: resolvedCwd, path });
    retainWorkspaceWatch(summary.root);
    invalidateAppTopics('workspace');
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'path required'
      || message === 'Git repository required.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      || message.startsWith('Path is outside the workspace root:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/git/unstage', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd, path } = req.body as { cwd?: string; path?: string };
    if (typeof path !== 'string' || path.trim().length === 0) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const summary = unstageWorkspaceGitPath({ cwd: resolvedCwd, path });
    retainWorkspaceWatch(summary.root);
    invalidateAppTopics('workspace');
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'path required'
      || message === 'Git repository required.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      || message.startsWith('Path is outside the workspace root:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/git/stage-all', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd } = req.body as { cwd?: string };
    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const summary = stageAllWorkspaceGitChanges(resolvedCwd);
    retainWorkspaceWatch(summary.root);
    invalidateAppTopics('workspace');
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Git repository required.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/git/unstage-all', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd } = req.body as { cwd?: string };
    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const summary = unstageAllWorkspaceGitChanges(resolvedCwd);
    retainWorkspaceWatch(summary.root);
    invalidateAppTopics('workspace');
    res.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Git repository required.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/git/draft-commit-message', async (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd } = req.body as { cwd?: string };
    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const draft = await draftWorkspaceCommitMessage({
      draftSource: readWorkspaceGitDraftSource(resolvedCwd),
      authFile: AUTH_FILE,
      settingsFile: SETTINGS_FILE,
    });
    res.json(draft);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'Git repository required.'
      || message === 'No staged changes available for commit drafting.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/git/commit', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd, message } = req.body as { cwd?: string; message?: string };
    if (typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const result = commitWorkspaceGitChanges({ cwd: resolvedCwd, message });
    retainWorkspaceWatch(result.root);
    invalidateAppTopics('workspace');
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'message required'
      || message === 'Git repository required.'
      || message === 'Resolve conflicts before committing.'
      || message === 'Stage at least one change before committing.'
      || message === 'Commit message subject is required.'
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/workspace/file', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
      ? req.query.cwd
      : defaultWebCwd;
    const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!path) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
    const detail = readWorkspaceFile({ cwd: resolvedCwd, path });
    retainWorkspaceWatch(detail.root);
    res.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'path required' || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:') || message.startsWith('Path is outside the workspace root:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/workspace/file/asset', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const cwd = typeof req.query.cwd === 'string' && req.query.cwd.trim().length > 0
      ? req.query.cwd
      : defaultWebCwd;
    const path = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    if (!path) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(cwd, defaultWebCwd) ?? defaultWebCwd;
    const asset = readWorkspacePreviewAsset({ cwd: resolvedCwd, path });
    retainWorkspaceWatch(asset.root);
    res.type(asset.mimeType);
    res.sendFile(asset.filePath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'path required'
      || message === 'Preview unavailable for this file type.'
      || message.startsWith('File does not exist:')
      || message.startsWith('Directory does not exist:')
      || message.startsWith('Not a directory:')
      || message.startsWith('Path is outside the workspace root:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/workspace/file', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { cwd: requestedCwd, path, content } = req.body as { cwd?: string; path?: string; content?: string };
    if (typeof path !== 'string' || path.trim().length === 0) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' });
      return;
    }

    const resolvedCwd = resolveRequestedCwd(requestedCwd, defaultWebCwd) ?? defaultWebCwd;
    const detail = writeWorkspaceFile({ cwd: resolvedCwd, path, content });
    retainWorkspaceWatch(detail.root);
    invalidateAppTopics('workspace');
    res.json(detail);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'path required' || message === 'content required' || message.startsWith('Directory does not exist:') || message.startsWith('Not a directory:') || message.startsWith('Path is outside the workspace root:')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/run', (req, res) => {
  try {
    const defaultWebCwd = getDefaultWebCwd();
    const { command, cwd: runCwd } = req.body as { command: string; cwd?: string };
    if (!command) { res.status(400).json({ error: 'command required' }); return; }
    const resolvedRunCwd = resolveRequestedCwd(runCwd, defaultWebCwd) ?? defaultWebCwd;
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(command, {
        cwd: resolvedRunCwd,
        timeout: 30_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const e = err as { stderr?: string; stdout?: string; status?: number; message?: string };
      output = (e.stdout ?? '') + (e.stderr ?? e.message ?? '');
      exitCode = e.status ?? 1;
    }
    res.json({ output: output.slice(0, 50_000), exitCode });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Memory browser ────────────────────────────────────────────────────────────

interface MemoryUsageSummary {
  recentSessionCount: number;
  lastUsedAt: string | null;
  usedInLastSession: boolean;
}

interface SkillItem extends MemoryUsageSummary {
  source: string;
  name: string;
  description: string;
  path: string;
}

interface MemoryDocItem extends MemoryUsageSummary {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  path: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
  searchText?: string;
  referenceCount?: number;
}

interface MemoryReferenceItem {
  title: string;
  summary: string;
  path: string;
  relativePath: string;
  tags: string[];
  updated?: string;
}

interface NodeLinkSummary {
  kind: NodeLinkKind;
  id: string;
  title: string;
  summary?: string;
}

interface NodeLinks {
  outgoing: NodeLinkSummary[];
  incoming: NodeLinkSummary[];
  unresolved: string[];
}

interface MemoryDocDetail {
  memory: MemoryDocItem;
  content: string;
  references: MemoryReferenceItem[];
  links: NodeLinks;
}

interface SkillDetail {
  skill: SkillItem;
  content: string;
  links: NodeLinks;
}

interface MemoryWorkItem {
  conversationId: string;
  conversationTitle: string;
  runId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}

interface AgentsItem {
  source: string;
  path: string;
  exists: boolean;
  content?: string;
}

function parseFrontmatter(filePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!m) return {};
    const fm = m[1];
    const result: Record<string, unknown> = {};
    const lines = fm.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const kv = line.match(/^([\w-]+):\s*(.*)/);
      if (!kv) { i++; continue; }
      const key = kv[1]; const val = kv[2].trim();
      if (val === '') {
        const items: string[] = [];
        i++;
        while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s+-\s+/, '').trim()); i++;
        }
        result[key] = items; continue;
      } else if (val.startsWith('[')) {
        result[key] = val.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        result[key] = val.replace(/^["']|["']$/g, '');
      }
      i++;
    }
    return result;
  } catch { return {}; }
}

function normalizeMemoryPath(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return normalize(trimmed.startsWith('/') ? trimmed : join(REPO_ROOT, trimmed));
}

function extractMemorySearchText(filePaths: string[], maxCharacters = 16_000): string {
  try {
    const combined = filePaths
      .map((filePath) => readFileSync(filePath, 'utf-8').replace(/^---\n[\s\S]*?\n---\n?/, ''))
      .join('\n\n');

    return combined
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[>#*_~|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxCharacters);
  } catch {
    return '';
  }
}

let memoryMigrationAttempted = false;

function ensureMemoryDocsDir(): string {
  const profilesRoot = getProfilesRoot();
  if (!memoryMigrationAttempted) {
    migrateLegacyProfileMemoryDirs({ profilesRoot });
    memoryMigrationAttempted = true;
  }

  const memoryDir = getMemoryDocsDir({ profilesRoot });
  mkdirSync(memoryDir, { recursive: true });
  return memoryDir;
}

function listMemoryDocs(options: { includeSearchText?: boolean } = {}): MemoryDocItem[] {
  const includeSearchText = options.includeSearchText === true;
  const loaded = loadMemoryDocs({ profilesRoot: getProfilesRoot() });

  const memoryDocs = loaded.docs.map((doc) => {
    const searchText = includeSearchText ? extractMemorySearchText([doc.filePath, ...doc.referencePaths]) : '';

    return {
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      tags: doc.tags,
      path: doc.filePath,
      type: doc.type,
      status: doc.status,
      area: doc.area,
      role: doc.role,
      parent: doc.parent,
      related: doc.related,
      updated: doc.updated,
      referenceCount: doc.referencePaths.length,
      ...(searchText ? { searchText } : {}),
      recentSessionCount: 0,
      lastUsedAt: null,
      usedInLastSession: false,
    } satisfies MemoryDocItem;
  });

  return memoryDocs.sort((left, right) => {
    const leftUpdated = left.updated ?? '';
    const rightUpdated = right.updated ?? '';
    if (leftUpdated !== rightUpdated) {
      return rightUpdated.localeCompare(leftUpdated);
    }

    return left.title.localeCompare(right.title);
  });
}

function findMemoryDocById(memoryId: string, options: { includeSearchText?: boolean } = {}): MemoryDocItem | null {
  const normalizedId = memoryId.trim();
  if (!normalizedId) {
    return null;
  }

  const memoryDocs = listMemoryDocs(options);
  return memoryDocs.find((entry) => entry.id === normalizedId) ?? null;
}

function buildMemoryReferenceItems(memoryPath: string): MemoryReferenceItem[] {
  return loadMemoryPackageReferences(dirname(memoryPath)).map((reference) => ({
    title: reference.title,
    summary: reference.summary,
    tags: reference.tags,
    path: reference.filePath,
    relativePath: reference.relativePath,
    updated: reference.updated || undefined,
  } satisfies MemoryReferenceItem));
}

function readNodeLinksForCurrentProfile(kind: NodeLinkKind, id: string) {
  return readNodeLinks({
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
    profile: getCurrentProfile(),
    kind,
    id,
  });
}

function readNodeLinksForProfile(kind: NodeLinkKind, id: string, profile: string) {
  return readNodeLinks({
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
    profile,
    kind,
    id,
  });
}

function readNoteDetail(memoryId: string): MemoryDocDetail {
  const memory = findMemoryDocById(memoryId, { includeSearchText: true });
  if (!memory) {
    throw new Error('Note not found.');
  }

  if (!existsSync(memory.path)) {
    throw new Error('Note file not found.');
  }

  return {
    memory,
    content: readFileSync(memory.path, 'utf-8'),
    references: buildMemoryReferenceItems(memory.path),
    links: readNodeLinksForCurrentProfile('note', memory.id),
  };
}

function readSkillDetailForProfile(skillName: string, profile = getCurrentProfile()): SkillDetail {
  const skill = listSkillsForProfile(profile).find((entry) => entry.name === skillName);
  if (!skill) {
    throw new Error(`Skill not found: ${skillName}`);
  }

  if (!existsSync(skill.path)) {
    throw new Error(`Skill file not found: ${skill.path}`);
  }

  return {
    skill,
    content: readFileSync(skill.path, 'utf-8'),
    links: readNodeLinksForProfile('skill', skill.name, profile),
  };
}

function pathIsWithin(pathValue: string, dirValue: string): boolean {
  const normalizedPath = normalize(pathValue);
  const normalizedDir = normalize(dirValue);
  return normalizedPath === normalizedDir
    || normalizedPath.startsWith(`${normalizedDir}/`)
    || normalizedPath.startsWith(`${normalizedDir}\\`);
}

function inferSkillSource(skillPath: string, profile: string): string {
  const frontmatter = parseFrontmatter(skillPath);
  const profiles = Array.isArray(frontmatter.profiles)
    ? frontmatter.profiles.map((value) => String(value).trim()).filter(Boolean)
    : [];

  if (profiles.length === 1 && profiles[0] === profile) {
    return profile;
  }

  return 'shared';
}

function isSkillDefinitionFile(filePath: string): boolean {
  const fileName = basename(filePath);
  if (fileName === 'SKILL.md') {
    return true;
  }

  if (fileName !== 'INDEX.md') {
    return false;
  }

  const frontmatter = parseFrontmatter(filePath);
  const kind = typeof frontmatter.kind === 'string' ? frontmatter.kind.trim().toLowerCase() : '';
  if (kind === 'skill') {
    return true;
  }

  return typeof frontmatter.name === 'string' && typeof frontmatter.description === 'string';
}

function listSkillDefinitionFiles(skillDir: string): string[] {
  if (!existsSync(skillDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [normalize(skillDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && isSkillDefinitionFile(fullPath)) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function listSkillsForProfile(profile = getCurrentProfile()): SkillItem[] {
  const resolved = resolveResourceProfile(profile, {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
  const skills: SkillItem[] = [];
  const seenPaths = new Set<string>();

  for (const dir of resolved.skillDirs) {
    for (const skillMd of listSkillDefinitionFiles(dir)) {
      const normalizedPath = normalize(skillMd);
      if (seenPaths.has(normalizedPath)) {
        continue;
      }
      seenPaths.add(normalizedPath);

      const fm = parseFrontmatter(skillMd);
      skills.push({
        source: inferSkillSource(skillMd, profile),
        name: String(fm.name ?? basename(dirname(skillMd))),
        description: String(fm.description ?? ''),
        path: skillMd,
        recentSessionCount: 0,
        lastUsedAt: null,
        usedInLastSession: false,
      });
    }
  }

  return skills;
}

function listSkillsForCurrentProfile(): SkillItem[] {
  return listSkillsForProfile(getCurrentProfile());
}

function inferAgentSource(filePath: string, profile: string): string {
  const normalizedBase = basename(filePath).replace(/\.[^.]+$/, '');
  if (normalizedBase === profile || normalizedBase.startsWith(`${profile}-`)) {
    return profile;
  }

  return 'shared';
}

function listProfileAgentItems(): AgentsItem[] {
  const items: AgentsItem[] = [];
  const seenPaths = new Set<string>();

  for (const profile of listAvailableProfiles()) {
    const resolved = resolveResourceProfile(profile, {
      repoRoot: REPO_ROOT,
      profilesRoot: getProfilesRoot(),
    });

    for (const filePath of resolved.agentsFiles) {
      const normalizedPath = normalize(filePath);
      if (seenPaths.has(normalizedPath)) {
        continue;
      }
      seenPaths.add(normalizedPath);

      items.push({
        source: inferAgentSource(filePath, profile),
        path: filePath,
        exists: existsSync(filePath),
        content: existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined,
      });
    }
  }

  return items;
}

function buildRecentReadUsage(trackedPaths: string[]): Map<string, MemoryUsageSummary> {
  const usageMap = new Map<string, MemoryUsageSummary>();
  const tracked = new Set(trackedPaths.map((itemPath) => normalize(itemPath)));

  for (const itemPath of tracked) {
    usageMap.set(itemPath, {
      recentSessionCount: 0,
      lastUsedAt: null,
      usedInLastSession: false,
    });
  }

  if (tracked.size === 0) {
    return usageMap;
  }

  const sessions = listSessions();
  if (sessions.length === 0) {
    return usageMap;
  }

  const recentWindowStart = Date.now() - (7 * 24 * 60 * 60 * 1000);
  const latestSessionId = sessions[0]?.id;

  for (const session of sessions.slice(0, 60)) {
    const detail = readSessionBlocks(session.id);
    if (!detail) {
      continue;
    }

    const touchedPaths = new Set<string>();
    for (const block of detail.blocks) {
      if (block.type !== 'tool_use' || block.tool !== 'read') {
        continue;
      }

      const normalizedPath = normalizeMemoryPath(block.input.path);
      if (!normalizedPath || !tracked.has(normalizedPath)) {
        continue;
      }

      touchedPaths.add(normalizedPath);
    }

    if (touchedPaths.size === 0) {
      continue;
    }

    const sessionTimestamp = detail.meta.timestamp;
    const sessionTimeMs = new Date(sessionTimestamp).getTime();

    for (const itemPath of touchedPaths) {
      const current = usageMap.get(itemPath);
      if (!current) {
        continue;
      }

      if (Number.isFinite(sessionTimeMs) && sessionTimeMs >= recentWindowStart) {
        current.recentSessionCount += 1;
      }

      if (!current.lastUsedAt || sessionTimestamp > current.lastUsedAt) {
        current.lastUsedAt = sessionTimestamp;
      }

      if (session.id === latestSessionId) {
        current.usedInLastSession = true;
      }
    }
  }

  return usageMap;
}

app.get('/api/memory', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    const resolvedProfile = resolveResourceProfile(profile, {
      repoRoot: REPO_ROOT,
      profilesRoot: getProfilesRoot(),
    });
    const agentsMd: AgentsItem[] = resolvedProfile.agentsFiles.map((filePath) => ({
      source: inferAgentSource(filePath, profile),
      path: filePath,
      exists: existsSync(filePath),
      content: existsSync(filePath) ? readFileSync(filePath, 'utf-8') : undefined,
    }));

    const skills = listSkillsForProfile(profile);
    const memoryDocs = listMemoryDocs();

    const usageByPath = buildRecentReadUsage([
      ...skills.map((item) => item.path),
      ...memoryDocs.map((item) => item.path),
    ]);

    for (const skill of skills) {
      const usage = usageByPath.get(normalize(skill.path));
      if (!usage) {
        continue;
      }

      skill.recentSessionCount = usage.recentSessionCount;
      skill.lastUsedAt = usage.lastUsedAt;
      skill.usedInLastSession = usage.usedInLastSession;
    }

    for (const doc of memoryDocs) {
      const usage = usageByPath.get(normalize(doc.path));
      if (!usage) {
        continue;
      }

      doc.recentSessionCount = usage.recentSessionCount;
      doc.lastUsedAt = usage.lastUsedAt;
      doc.usedInLastSession = usage.usedInLastSession;
    }

    res.json({ profile, agentsMd, skills, memoryDocs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
});

app.get('/api/memory/file', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

    const syncRoot = getSyncRoot();
    const allowed = filePath.endsWith('.md') && (
      pathIsWithin(filePath, REPO_ROOT)
      || pathIsWithin(filePath, syncRoot)
    );

    if (!allowed) {
      res.status(403).json({ error: 'Access denied' }); return;
    }
    if (!existsSync(filePath)) { res.status(404).json({ error: 'File not found' }); return; }
    const content = readFileSync(filePath, 'utf-8');
    res.json({ content, path: filePath });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/skills/:name', (req, res) => {
  try {
    const profile = resolveRequestedProfileFromQuery(req) as string;
    res.json(readSkillDetailForProfile(req.params.name, profile));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.startsWith('Skill not found:') || message.startsWith('Skill file not found:') ? 404 : 500).json({ error: message });
  }
});

app.post('/api/memory/file', (req, res) => {
  try {
    const { path: filePath, content } = req.body as { path: string; content: string };
    if (!filePath || content === undefined) { res.status(400).json({ error: 'path and content required' }); return; }

    const syncRoot = getSyncRoot();
    const allowed = filePath.endsWith('.md') && (
      pathIsWithin(filePath, REPO_ROOT)
      || pathIsWithin(filePath, syncRoot)
    );

    if (!allowed) {
      res.status(403).json({ error: 'Access denied' }); return;
    }
    writeFileSync(filePath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Companion auth + restricted companion service ────────────────────────────

companionApp.post('/api/companion-auth/exchange', companionAuthExchangeRateLimit, (req, res) => {
  try {
    const { code, deviceLabel } = req.body as { code?: unknown; deviceLabel?: unknown };
    if (typeof code !== 'string' || code.trim().length === 0) {
      res.status(400).json({ error: 'Pairing code required.' });
      return;
    }

    const exchanged = exchangeCompanionPairingCode(code, {
      ...(typeof deviceLabel === 'string' ? { deviceLabel } : {}),
      surface: 'companion',
    });
    setCompanionSessionCookie(req, res, exchanged.sessionToken);
    res.status(201).json({ session: exchanged.session });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.includes('invalid or expired') ? 400 : 500).json({ error: message });
  }
});

companionApp.get('/api/companion-auth/session', (req, res) => {
  const session = ensureCompanionSession(req, res);
  if (!session) {
    return;
  }

  res.json({ session });
});

companionApp.post('/api/companion-auth/logout', (req, res) => {
  revokeCompanionSessionByToken(readCookieValue(req, COMPANION_SESSION_COOKIE));
  clearCompanionSessionCookie(req, res);
  res.json({ ok: true });
});

companionApp.use('/api', (req, res, next) => {
  if (req.path === '/companion-auth/session' || req.path === '/companion-auth/exchange' || req.path === '/companion-auth/logout') {
    next();
    return;
  }

  if (!ensureCompanionSession(req, res)) {
    return;
  }

  next();
});

companionApp.get('/api/events', (req, res) => {
  writeSseHeaders(res);

  let closed = false;
  let writeQueue = Promise.resolve();

  const writeEvent = (event: unknown) => {
    if (closed) {
      return;
    }

    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const enqueueWrite = (task: () => Promise<void> | void) => {
    writeQueue = writeQueue
      .then(async () => {
        if (closed) {
          return;
        }

        await task();
      })
      .catch((error) => {
        logWarn('companion event stream write failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const writeSnapshotEvents = async (topics: AppEventTopic[]) => {
    await emitCompanionSnapshotEvents(topics, writeEvent);
  };

  writeEvent({ type: 'connected' });
  enqueueWrite(async () => {
    await writeSnapshotEvents(['sessions', 'activity', 'alerts', 'projects']);
  });

  const sessionToken = readCookieValue(req, COMPANION_SESSION_COOKIE);
  const heartbeat = setInterval(() => {
    if (closed) {
      return;
    }

    if (!readCompanionSession(sessionToken, { touch: false, surface: 'companion' })) {
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
      return;
    }

    res.write(': heartbeat\n\n');
  }, 15_000);
  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === 'invalidate') {
      const topics = event.topics.filter((topic) => COMPANION_EVENT_TOPICS.has(topic));
      if (topics.length === 0) {
        return;
      }

      enqueueWrite(async () => {
        await writeSnapshotEvents(topics);
        writeEvent({ type: 'invalidate', topics });
      });
      return;
    }

    if (event.type === 'live_title') {
      writeEvent(event);
    }
  });

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    unsubscribe();
  });
});

companionApp.get('/api/alerts', (_req, res) => {
  try {
    res.json(getAlertSnapshotForProfile(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/alerts/:id', (req, res) => {
  try {
    const alert = getAlertForProfile(getCurrentProfile(), req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json(alert);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/alerts/:id/ack', (req, res) => {
  try {
    const alert = acknowledgeAlertForProfile(getCurrentProfile(), req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('alerts');
    res.json({ ok: true, alert });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/alerts/:id/dismiss', (req, res) => {
  try {
    const alert = dismissAlertForProfile(getCurrentProfile(), req.params.id);
    if (!alert) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('alerts');
    res.json({ ok: true, alert });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/alerts/:id/snooze', async (req, res) => {
  try {
    const { delay, at } = req.body as { delay?: string; at?: string };
    const result = await snoozeAlertForProfile(getCurrentProfile(), req.params.id, { delay, at });
    if (!result) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('alerts', 'sessions', 'runs');
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: message });
  }
});

companionApp.post('/api/inbox/clear', (_req, res) => {
  try {
    const result = clearInboxForCurrentProfile();
    res.json({
      ok: true,
      deletedActivityIds: result.deletedActivityIds,
      clearedConversationIds: result.clearedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/activity', (_req, res) => {
  try {
    res.json(listActivityForCurrentProfile());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/activity/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const match = findActivityRecord(profile, req.params.id);
    if (!match) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    res.json({ ...match.entry, read: match.read });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/activity/:id/start', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const match = findActivityRecord(profile, req.params.id);

    if (!match) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const entry = match.entry;
    const requestedRelatedProjectIds = Array.isArray(entry.relatedProjectIds)
      ? entry.relatedProjectIds.filter((projectId): projectId is string => typeof projectId === 'string' && projectId.trim().length > 0)
      : [];
    const availableProjectIds = new Set(listReferenceableProjectIds());
    const relatedProjectIds = requestedRelatedProjectIds.filter((projectId) => availableProjectIds.has(projectId));
    const cwd = resolveConversationCwd({
      repoRoot: REPO_ROOT,
      profile,
      defaultCwd: getDefaultWebCwd(),
      referencedProjectIds: relatedProjectIds,
    });
    const result = await createLocalSession(cwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });

    if (relatedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds,
      });
    }

    const relatedConversationIds = [...new Set([...(entry.relatedConversationIds ?? []), result.id])];
    setActivityConversationLinks({
      stateRoot: match.stateRoot,
      profile,
      activityId: entry.id,
      relatedConversationIds,
    });

    await queuePromptContext(result.id, 'referenced_context', buildInboxActivityConversationContext({
      ...entry,
      relatedProjectIds,
      relatedConversationIds,
    }));

    invalidateAppTopics('activity', 'projects', 'sessions');
    res.json({
      activityId: entry.id,
      id: result.id,
      sessionFile: result.sessionFile,
      cwd,
      relatedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.patch('/api/activity/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const { id } = req.params;
    const { read } = req.body as { read?: boolean };
    const changed = markActivityReadState(profile, id, read !== false);
    if (!changed) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    invalidateAppTopics('activity');
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/tasks', (_req, res) => {
  try {
    res.json(listTasksForCurrentProfile());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.patch('/api/tasks/:id', (req, res) => {
  try {
    const body = req.body as {
      enabled?: boolean;
      cron?: string | null;
      at?: string | null;
      model?: string | null;
      cwd?: string | null;
      timeoutSeconds?: number | null;
      prompt?: string;
    };
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const requestedKeys = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined);
    const enabled = body.enabled;
    const toggleOnly = requestedKeys.length === 1 && requestedKeys[0] === 'enabled' && typeof enabled === 'boolean';

    if (toggleOnly) {
      let content = readFileSync(resolvedTask.task.filePath, 'utf-8');
      if (/enabled:\s*(true|false)/.test(content)) {
        content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
      } else {
        content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
      }
      writeFileSync(resolvedTask.task.filePath, content, 'utf-8');
      invalidateAppTopics('tasks');

      const updatedTask = resolveScheduledTaskForProfile(getCurrentProfile(), resolvedTask.task.id);
      res.json({ ok: true, task: buildTaskDetailResponse(updatedTask.task, updatedTask.runtime) });
      return;
    }

    const schedule = resolvedTask.task.schedule;
    const nextContent = buildScheduledTaskMarkdown({
      taskId: resolvedTask.task.id,
      profile: resolvedTask.task.profile,
      enabled: body.enabled ?? resolvedTask.task.enabled,
      cron: body.cron !== undefined ? body.cron : schedule.type === 'cron' ? schedule.expression : undefined,
      at: body.at !== undefined ? body.at : schedule.type === 'at' ? schedule.at : undefined,
      model: body.model !== undefined ? body.model : resolvedTask.task.modelRef,
      cwd: body.cwd !== undefined ? body.cwd : resolvedTask.task.cwd,
      timeoutSeconds: body.timeoutSeconds !== undefined ? body.timeoutSeconds : resolvedTask.task.timeoutSeconds,
      prompt: body.prompt ?? resolvedTask.task.prompt,
    });

    validateScheduledTaskDefinition(resolvedTask.task.filePath, nextContent);

    writeFileSync(resolvedTask.task.filePath, nextContent, 'utf-8');
    invalidateAppTopics('tasks');

    const updatedTask = resolveScheduledTaskForProfile(getCurrentProfile(), resolvedTask.task.id);
    res.json({ ok: true, task: buildTaskDetailResponse(updatedTask.task, updatedTask.runtime) });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/tasks/:id/log', (req, res) => {
  try {
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask?.runtime?.lastLogPath || !existsSync(resolvedTask.runtime.lastLogPath)) {
      res.status(404).json({ error: 'No log available' });
      return;
    }

    const log = readFileSync(resolvedTask.runtime.lastLogPath, 'utf-8');
    res.json({ log, path: resolvedTask.runtime.lastLogPath });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/tasks/:id', (req, res) => {
  try {
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    res.json(buildTaskDetailResponse(resolvedTask.task, resolvedTask.runtime));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/tasks/:id/run', async (req, res) => {
  try {
    const resolvedTask = findCurrentProfileTask(req.params.id);
    if (!resolvedTask) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    if (!resolvedTask.task.prompt.trim()) {
      res.status(400).json({ error: 'Task has no prompt body' });
      return;
    }

    const result = await startScheduledTaskRun(resolvedTask.task.filePath);
    if (!result.accepted) {
      res.status(503).json({ error: result.reason ?? 'Could not start the task run.' });
      return;
    }

    res.json({ ok: true, accepted: result.accepted, runId: result.runId });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/runs', async (_req, res) => {
  try {
    res.json(await listDurableRuns());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/runs/:id', async (req, res) => {
  try {
    const result = await getDurableRun(req.params.id);
    if (!result) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/runs/:id/log', async (req, res) => {
  try {
    const tail = parseRunLogTail(req.query.tail);
    const result = await getDurableRunLog(req.params.id, tail);
    if (!result) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/daemon', async (_req, res) => {
  try {
    res.json(await readDaemonState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/daemon/service/restart', async (_req, res) => {
  try {
    suppressMonitoredServiceAttention('daemon');
    const state = await restartDaemonServiceAndReadState();
    invalidateAppTopics('daemon', 'sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/sync', async (_req, res) => {
  try {
    res.json(await readSyncState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/sync/run', async (_req, res) => {
  try {
    const state = await requestSyncRunAndReadState();
    invalidateAppTopics('sync');
    res.json(state);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/web-ui/state', (_req, res) => {
  try {
    res.json(readWebUiState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/web-ui/service/restart', (_req, res) => {
  try {
    res.status(202).json(requestWebUiServiceRestart({ repoRoot: REPO_ROOT }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Managed web UI restart already in progress')
      || message.startsWith('Application restart already in progress')
      || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

companionApp.post('/api/application/restart', (_req, res) => {
  try {
    res.status(202).json(requestApplicationRestart({ repoRoot: REPO_ROOT, profile: getCurrentProfile() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Application restart already in progress') || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

companionApp.post('/api/application/update', (_req, res) => {
  try {
    res.status(202).json(requestApplicationUpdate({ repoRoot: REPO_ROOT, profile: getCurrentProfile() }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Application restart already in progress') || message.startsWith('Application update already in progress')
      ? 409
      : message.startsWith('Managed web UI service is not installed')
        ? 400
        : 500;
    res.status(status).json({ error: message });
  }
});

companionApp.get('/api/projects', (_req, res) => {
  try {
    res.json(listProjectsForCurrentProfile());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/projects/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    res.json(readProjectDetailForProfile(req.params.id, profile));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

companionApp.get('/api/sessions', (_req, res) => {
  try {
    res.json(decorateSessionsWithAttention(getCurrentProfile(), listSessions()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/companion/conversations', handleCompanionConversationListRequest);

companionApp.get('/api/sessions/:id', async (req, res) => {
  const startedAt = process.hrtime.bigint();

  try {
    const remoteMirror = await syncRemoteConversationMirror({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
    }).catch(() => ({ status: 'not-remote' as const, durationMs: 0 } satisfies RemoteConversationMirrorSyncTelemetry));

    const rawTailBlocks = Array.isArray(req.query.tailBlocks) ? req.query.tailBlocks[0] : req.query.tailBlocks;
    const parsedTailBlocks = typeof rawTailBlocks === 'string'
      ? Number.parseInt(rawTailBlocks, 10)
      : typeof rawTailBlocks === 'number'
        ? rawTailBlocks
        : undefined;
    const tailBlocks = Number.isInteger(parsedTailBlocks) && (parsedTailBlocks as number) > 0
      ? parsedTailBlocks as number
      : undefined;

    const sessionRead = readSessionBlocksWithTelemetry(req.params.id, tailBlocks ? { tailBlocks } : undefined);
    if (!sessionRead.detail) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    setServerTimingHeaders(res, [
      { name: 'remote_sync', durationMs: remoteMirror.durationMs, description: remoteMirror.status },
      { name: 'session_read', durationMs: sessionRead.telemetry?.durationMs ?? 0, description: sessionRead.telemetry ? `${sessionRead.telemetry.cache}/${sessionRead.telemetry.loader}` : 'unknown' },
      { name: 'total', durationMs },
    ], {
      route: 'companion-session-detail',
      conversationId: req.params.id,
      ...(tailBlocks ? { tailBlocks } : {}),
      remoteMirror,
      sessionRead: sessionRead.telemetry,
      durationMs,
    });

    res.json(sessionRead.detail);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.patch('/api/conversations/:id/attention', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const { id } = req.params;
    const { read } = req.body as { read?: boolean };
    const session = listConversationSessionsSnapshot().find((entry) => entry.id === id);

    if (!session) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    if (read === false) {
      markConversationAttentionUnread({
        profile,
        conversationId: id,
        messageCount: session.messageCount,
      });
    } else {
      markConversationAttentionRead({
        profile,
        conversationId: id,
        messageCount: session.messageCount,
      });
    }

    invalidateAppTopics('sessions');
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/live-sessions', (_req, res) => {
  res.json(listAllLiveSessions());
});

companionApp.post('/api/live-sessions', async (req, res) => {
  try {
    const body = req.body as { referencedProjectIds?: string[]; text?: string };
    const profile = getCurrentProfile();
    const availableProjectIds = listReferenceableProjectIds();
    const inferredReferencedProjectIds = body.text
      ? resolvePromptReferences({
        text: body.text,
        availableProjectIds,
        tasks: [],
        memoryDocs: [],
        skills: [],
        profiles: [],
      }).projectIds
      : [];
    const referencedProjectIds = body.referencedProjectIds && body.referencedProjectIds.length > 0
      ? body.referencedProjectIds.filter((projectId) => availableProjectIds.includes(projectId))
      : inferredReferencedProjectIds;
    const cwd = resolveConversationCwd({
      repoRoot: REPO_ROOT,
      profile,
      explicitCwd: undefined,
      defaultCwd: getDefaultWebCwd(),
      referencedProjectIds,
    });

    const result = await createLocalSession(cwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    if (referencedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds: referencedProjectIds,
      });
      invalidateAppTopics('projects', 'sessions');
    }
    migrateDraftConversationPlan(profile, result.id);
    res.json(result);
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/live-sessions/:id', (req, res) => {
  const live = isLiveSession(req.params.id);
  if (!live) {
    res.status(404).json({ live: false });
    return;
  }

  const entry = listAllLiveSessions().find((session) => session.id === req.params.id);
  res.json({ live: true, ...entry });
});

companionApp.post('/api/live-sessions/:id/takeover', (req, res) => {
  try {
    const { id } = req.params;
    const surfaceId = typeof req.body?.surfaceId === 'string' ? req.body.surfaceId.trim() : '';
    if (!surfaceId) {
      res.status(400).json({ error: 'surfaceId is required' });
      return;
    }
    if (!isLocalLive(id)) {
      res.status(400).json({ error: 'Takeover is only available for local live conversations right now.' });
      return;
    }

    res.json(takeOverSessionControl(id, surfaceId));
  } catch (error) {
    if (error instanceof LiveSessionControlError) {
      res.status(409).json({ error: error.message });
      return;
    }

    res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

companionApp.get('/api/live-sessions/:id/events', (req, res) => {
  const { id } = req.params;
  if (!isLiveSession(id)) {
    res.status(404).json({ error: 'Not a live session' });
    return;
  }

  const rawTailBlocks = Array.isArray(req.query.tailBlocks) ? req.query.tailBlocks[0] : req.query.tailBlocks;
  const parsedTailBlocks = typeof rawTailBlocks === 'string'
    ? Number.parseInt(rawTailBlocks, 10)
    : typeof rawTailBlocks === 'number'
      ? rawTailBlocks
      : undefined;
  const tailBlocks = Number.isInteger(parsedTailBlocks) && (parsedTailBlocks as number) > 0
    ? parsedTailBlocks as number
    : undefined;
  const rawSurfaceId = Array.isArray(req.query.surfaceId) ? req.query.surfaceId[0] : req.query.surfaceId;
  const surfaceId = typeof rawSurfaceId === 'string' ? rawSurfaceId.trim() : '';
  const rawSurfaceType = Array.isArray(req.query.surfaceType) ? req.query.surfaceType[0] : req.query.surfaceType;
  const surfaceType = rawSurfaceType === 'mobile_web' ? 'mobile_web' : 'desktop_web';

  writeSseHeaders(res);

  const sessionToken = readCookieValue(req, COMPANION_SESSION_COOKIE);
  const heartbeat = setInterval(() => {
    if (!readCompanionSession(sessionToken, { touch: false, surface: 'companion' })) {
      clearInterval(heartbeat);
      unsubscribe?.();
      res.end();
      return;
    }

    res.write(': heartbeat\n\n');
  }, 15_000);
  const unsubscribe = subscribeLiveSession(id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, {
    ...(tailBlocks ? { tailBlocks } : {}),
    ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
  });

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe?.();
  });
});

companionApp.post('/api/live-sessions/:id/prompt', async (req, res) => {
  try {
    const { id } = req.params;
    const { text = '', behavior, images, attachmentRefs } = req.body as {
      text?: string;
      behavior?: 'steer' | 'followUp';
      images?: Array<{ type?: 'image'; data: string; mimeType: string; name?: string }>;
      attachmentRefs?: unknown;
      surfaceId?: string;
    };
    const normalizedAttachmentRefs = normalizePromptAttachmentRefs(attachmentRefs);
    if (!text && (!images || images.length === 0) && normalizedAttachmentRefs.length === 0) {
      res.status(400).json({ error: 'text, images, or attachmentRefs required' });
      return;
    }

    const surfaceId = ensureRequestControlsLocalLiveConversation(id, req.body);
    const isRemoteLive = isRemoteLiveSession(id);

    const currentProfile = getCurrentProfile();
    const tasks = listTasksForCurrentProfile();
    const memoryDocs = listMemoryDocs();
    const skills = listSkillsForCurrentProfile();
    const profileAgents = listProfileAgentItems().map((item) => ({
      id: item.source,
      source: item.source,
      path: item.path,
    }));
    const promptReferences = resolvePromptReferences({
      text,
      availableProjectIds: listReferenceableProjectIds(),
      tasks,
      memoryDocs,
      skills,
      profiles: profileAgents,
    });

    const relatedProjectIds = syncConversationProjectReferences(id, promptReferences.projectIds);
    const referencedTasks = pickPromptReferencesInOrder(promptReferences.taskIds, tasks);
    const referencedMemoryDocs = pickPromptReferencesInOrder(promptReferences.memoryDocIds, memoryDocs);
    const referencedSkills = pickPromptReferencesInOrder(promptReferences.skillNames, skills);
    const referencedProfiles = pickPromptReferencesInOrder(promptReferences.profileIds, profileAgents);

    let referencedAttachments: ReturnType<typeof resolveConversationAttachmentPromptFiles> = [];
    if (normalizedAttachmentRefs.length > 0) {
      try {
        referencedAttachments = resolveConversationAttachmentPromptFiles({
          profile: currentProfile,
          conversationId: id,
          refs: normalizedAttachmentRefs,
        });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }

    const liveEntry = !isRemoteLive ? liveRegistry.get(id) : undefined;
    const remoteLive = isRemoteLive ? getRemoteLiveSessionMeta(id) : null;
    const sessionFile = liveEntry?.session.sessionFile ?? remoteLive?.sessionFile;
    const daemonRunsRoot = resolveDurableRunsRoot(resolveDaemonRoot());
    const backgroundRunContextEntries = sessionFile
      ? listPendingBackgroundRunResults({
        runsRoot: daemonRunsRoot,
        sessionFile,
      })
      : [];
    const backgroundRunHiddenContext = buildBackgroundRunHiddenContext(backgroundRunContextEntries);

    const automationBeforePrompt = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: id,
      settingsFile: SETTINGS_FILE,
    }).document;
    if (automationBeforePrompt.waitingForUser || automationBeforePrompt.items.some((item) => item.status === 'waiting')) {
      saveConversationAutomationDocument(resumeConversationAutomationAfterUserMessage(automationBeforePrompt));
    }

    const queuedContextBlocks = [
      relatedProjectIds.length > 0 ? buildReferencedProjectsContext(relatedProjectIds) : '',
      referencedAttachments.length > 0 ? buildConversationAttachmentsContext(referencedAttachments) : '',
      referencedTasks.length > 0 ? buildReferencedTasksContext(referencedTasks, REPO_ROOT) : '',
      referencedMemoryDocs.length > 0 ? buildReferencedMemoryDocsContext(referencedMemoryDocs, REPO_ROOT) : '',
      referencedSkills.length > 0 ? buildReferencedSkillsContext(referencedSkills, REPO_ROOT) : '',
      referencedProfiles.length > 0 ? buildReferencedProfilesContext(referencedProfiles, REPO_ROOT) : '',
      backgroundRunHiddenContext,
    ].filter(Boolean);

    const hiddenContext = queuedContextBlocks.join('\n\n');

    if (!isRemoteLive && queuedContextBlocks.length > 0) {
      await queuePromptContext(id, 'referenced_context', hiddenContext);
    }

    if (!isRemoteLive && liveEntry?.session.sessionFile) {
      await syncWebLiveConversationRun({
        conversationId: id,
        sessionFile: liveEntry.session.sessionFile,
        cwd: liveEntry.cwd,
        title: liveEntry.title,
        profile: currentProfile,
        state: 'running',
        pendingOperation: {
          type: 'prompt',
          text,
          ...(behavior ? { behavior } : {}),
          ...(images && images.length > 0
            ? {
              images: images.map((image) => ({
                type: 'image' as const,
                data: image.data,
                mimeType: image.mimeType,
                ...(image.name ? { name: image.name } : {}),
              })),
            }
            : {}),
          ...(queuedContextBlocks.length > 0
            ? {
              contextMessages: [{
                customType: 'referenced_context',
                content: hiddenContext,
              }],
            }
            : {}),
          enqueuedAt: new Date().toISOString(),
        },
      });
    }

    if (isRemoteLive && referencedAttachments.length > 0) {
      res.status(400).json({ error: 'Remote conversations do not support local attachment references yet.' });
      return;
    }

    const promptImages = images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
      ...(image.name ? { name: image.name } : {}),
    }));
    const submittedPrompt = isRemoteLive
      ? await submitRemoteLiveSessionPrompt({
        conversationId: id,
        text,
        behavior,
        images: promptImages,
        ...(hiddenContext ? { hiddenContext } : {}),
      })
      : await submitLocalPromptSession(id, text, behavior, promptImages, surfaceId);
    const promptPromise = submittedPrompt.completion;

    void promptPromise.then(async () => {
      if (!sessionFile || backgroundRunContextEntries.length === 0) {
        return;
      }

      try {
        const deliveredIds = markBackgroundRunResultsDelivered({
          runsRoot: daemonRunsRoot,
          sessionFile,
          resultIds: backgroundRunContextEntries.map((entry) => entry.id),
        });
        if (deliveredIds.length > 0) {
          invalidateAppTopics('runs');
        }
      } catch (error) {
        logError('background run context completion error', {
          sessionId: id,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
    }).catch(async (err) => {
      if (!isRemoteLive && liveEntry?.session.sessionFile) {
        await syncWebLiveConversationRun({
          conversationId: id,
          sessionFile: liveEntry.session.sessionFile,
          cwd: liveEntry.cwd,
          title: liveEntry.title,
          profile: currentProfile,
          state: 'failed',
          lastError: err instanceof Error ? err.message : String(err),
        });
      }

      logError('live prompt error', {
        sessionId: id,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    });
    res.json({
      ok: true,
      accepted: true,
      delivery: submittedPrompt.acceptedAs,
      relatedProjectIds,
      referencedTaskIds: promptReferences.taskIds,
      referencedMemoryDocIds: promptReferences.memoryDocIds,
      referencedSkillNames: promptReferences.skillNames,
      referencedProfileIds: promptReferences.profileIds,
      referencedAttachmentIds: referencedAttachments.map((attachment) => attachment.attachmentId),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

companionApp.post('/api/live-sessions/:id/abort', async (req, res) => {
  try {
    ensureRequestControlsLocalLiveConversation(req.params.id, req.body);
    await abortLiveSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    if (writeLiveConversationControlError(res, err)) {
      return;
    }
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/conversations/:id/plan', async (req, res) => {
  try {
    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.patch('/api/conversations/:id/plan', async (req, res) => {
  try {
    const body = req.body as { enabled?: boolean; items?: unknown };
    if (typeof body.enabled !== 'boolean' && !Array.isArray(body.items)) {
      res.status(400).json({ error: 'enabled or items required' });
      return;
    }

    const skillNames = new Set(listSkillsForCurrentProfile().map((skill) => skill.name));
    if (Array.isArray(body.items)) {
      validateConversationAutomationTemplateItems(body.items, skillNames);
    }

    let document = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
      settingsFile: SETTINGS_FILE,
    }).document;
    const updatedAt = new Date().toISOString();

    if (Array.isArray(body.items)) {
      document = replaceConversationAutomationItems(document, body.items, updatedAt);
    }

    if (typeof body.enabled === 'boolean') {
      document = updateConversationAutomationEnabled(document, body.enabled, updatedAt);
    }

    saveConversationAutomationDocument(document);

    if (document.enabled) {
      await kickConversationAutomation(req.params.id);
    }

    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unknown skill:')
      || message.includes('items must be an array')
      || message.includes('Each item')
      || message.includes('Each skill item')
      || message.includes('Each instruction item')
      ? 400
      : 500;
    res.status(status).json({ error: message });
  }
});

companionApp.post('/api/conversations/:id/plan/items/:itemId/status', async (req, res) => {
  try {
    const { checked } = req.body as { checked?: unknown };
    if (typeof checked !== 'boolean') {
      res.status(400).json({ error: 'checked must be a boolean' });
      return;
    }

    const loaded = loadConversationAutomationState({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
      settingsFile: SETTINGS_FILE,
    });
    const document = loaded.document;
    const item = document.items.find((candidate) => candidate.id === req.params.itemId);
    if (!item) {
      res.status(404).json({ error: 'Automation item not found' });
      return;
    }
    if (document.activeItemId === item.id || item.status === 'running') {
      res.status(409).json({ error: 'Running automation items cannot be edited from the checklist.' });
      return;
    }

    const nextDocument = checked
      ? updateConversationAutomationItemStatus(document, req.params.itemId, 'completed', { resultReason: 'Completed from the checklist UI.' })
      : setConversationAutomationItemPending(document, req.params.itemId, { enabled: document.enabled });
    saveConversationAutomationDocument(nextDocument);

    res.json(await buildConversationAutomationResponse(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

companionApp.get('/api/conversations/:id/execution', async (req, res) => {
  try {
    res.json(await readConversationExecutionState(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.startsWith('Invalid') ? 400 : 500).json({ error: message });
  }
});

companionApp.get('/api/conversations/:id/artifacts', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const artifacts = listConversationArtifacts({ profile, conversationId: req.params.id });
    res.json({ conversationId: req.params.id, artifacts });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/conversations/:id/artifacts/:artifactId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const artifact = getConversationArtifact({
      profile,
      conversationId: req.params.id,
      artifactId: req.params.artifactId,
    });

    if (!artifact) {
      res.status(404).json({ error: 'Artifact not found' });
      return;
    }

    res.json({ conversationId: req.params.id, artifact });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

companionApp.get('/api/web-ui/open-conversations', handleOpenConversationLayoutReadRequest);
companionApp.patch('/api/web-ui/open-conversations', handleOpenConversationLayoutWriteRequest);

companionApp.get('/api/memory', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const skills = listSkillsForProfile(profile);
    const memoryDocs = listMemoryDocs();
    const usageByPath = buildRecentReadUsage([
      ...skills.map((item) => item.path),
      ...memoryDocs.map((item) => item.path),
    ]);

    for (const skill of skills) {
      const usage = usageByPath.get(normalize(skill.path));
      if (usage) {
        skill.recentSessionCount = usage.recentSessionCount;
        skill.lastUsedAt = usage.lastUsedAt;
        skill.usedInLastSession = usage.usedInLastSession;
      }
    }

    for (const doc of memoryDocs) {
      const usage = usageByPath.get(normalize(doc.path));
      if (usage) {
        doc.recentSessionCount = usage.recentSessionCount;
        doc.lastUsedAt = usage.lastUsedAt;
        doc.usedInLastSession = usage.usedInLastSession;
      }
    }

    res.json({ profile, agentsMd: [], skills, memoryDocs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.startsWith('Unknown profile:') ? 400 : 500).json({ error: message });
  }
});

companionApp.get('/api/memory/file', (req, res) => {
  try {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    const allowed = listCompanionReadableMarkdownPaths(getCurrentProfile());
    if (!allowed.has(normalize(filePath))) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (!existsSync(filePath)) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.json({ content: readFileSync(filePath, 'utf-8'), path: filePath });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

companionApp.get('/api/skills/:name', (req, res) => {
  try {
    res.json(readSkillDetailForProfile(req.params.name));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.startsWith('Skill not found:') || message.startsWith('Skill file not found:') ? 404 : 500).json({ error: message });
  }
});

companionApp.get('/api/notes/:memoryId', (req, res) => {
  try {
    res.json(readNoteDetail(req.params.memoryId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message === 'Note not found.' || message === 'Note file not found.' ? 404 : 500).json({ error: message });
  }
});

if (existsSync(DIST_DIR)) {
  companionApp.use('/assets', express.static(DIST_ASSETS_DIR));
  companionApp.use('/app', express.static(COMPANION_DIST_DIR));
  companionApp.get('/', (_req, res) => {
    res.redirect('/app/inbox');
  });
  companionApp.use(express.static(COMPANION_DIST_DIR, { index: false }));
  companionApp.get('*', (req, res, next) => {
    if (!shouldServeCompanionIndex(req.path)) {
      next();
      return;
    }

    res.sendFile(join(COMPANION_DIST_DIR, 'index.html'));
  });
} else {
  companionApp.get('*', (_req, res) => {
    res.send(
      '<pre style="font-family:monospace;padding:2rem;background:#07090e;color:#bfcfee">' +
        'personal-agent companion\n\n' +
        'SPA not built yet.\n' +
        'Run: npm run build in packages/web\n' +
        '</pre>',
    );
  });
}

// ── Static + SPA fallback ─────────────────────────────────────────────────────

if (existsSync(DIST_DIR)) {
  if (COMPANION_DISABLED) {
    app.get('/app*', (_req, res) => {
      res.sendFile(join(COMPANION_DIST_DIR, 'index.html'));
    });
  } else {
    app.get('/app*', (req, res) => {
      const search = typeof req.url === 'string' && req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      res.redirect(`http://${LOOPBACK_HOST}:${COMPANION_PORT}${req.path}${search}`);
    });
  }
  app.use(express.static(DIST_DIR));
  app.get('*', (_req, res) => {
    res.sendFile(join(DIST_DIR, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.send(
      '<pre style="font-family:monospace;padding:2rem;background:#07090e;color:#bfcfee">' +
        'personal-agent web UI\n\n' +
        'SPA not built yet.\n' +
        'Run: npm run build in packages/web\n' +
        '</pre>',
    );
  });
}

app.listen(PORT, LOOPBACK_HOST, () => {
  logInfo('web ui started', {
    url: `http://${LOOPBACK_HOST}:${PORT}`,
    profile: getCurrentProfile(),
    repoRoot: REPO_ROOT,
    cwd: getDefaultWebCwd(),
    dist: DIST_DIR,
  });
});

if (!COMPANION_DISABLED) {
  companionApp.listen(COMPANION_PORT, LOOPBACK_HOST, () => {
    logInfo('companion service started', {
      url: `http://${LOOPBACK_HOST}:${COMPANION_PORT}`,
      profile: getCurrentProfile(),
      repoRoot: REPO_ROOT,
      dist: COMPANION_DIST_DIR,
    });
  });
}
