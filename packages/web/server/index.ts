import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { listSessions, readSessionBlock, readSessionBlocks, readSessionImageAsset, readSessionSearchText, readSessionTree, renameStoredSession } from './sessions.js';
import { invalidateAppTopics, startAppEventMonitor, subscribeAppEvents, type AppEventTopic } from './appEvents.js';
import { resolveConversationCwd, resolveRequestedCwd } from './conversationCwd.js';
import { pickFolder } from './folderPicker.js';
import { readGitStatusSummary } from './gitStatus.js';
import {
  installGatewayAndReadState,
  readGatewayState,
  restartGatewayAndReadState,
  saveGatewayConfigAndReadState,
  startGatewayAndReadState,
  stopGatewayAndReadState,
  uninstallGatewayAndReadState,
} from './gateway.js';
import { parseGatewayConfigUpdateInput } from './gatewayConfig.js';
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
} from './providerAuth.js';
import { readSavedConversationTitlePreferences, writeSavedConversationTitlePreferences } from './conversationTitlePreferences.js';
import { logError, logInfo, logWarn, installProcessLogging, webRequestLoggingMiddleware } from './logging.js';
import {
  createServiceAttentionMonitor,
  suppressMonitoredServiceAttention,
  writeInternalAttentionEntry,
} from './internalAttention.js';
import { readSavedThemePreferences, writeSavedThemePreferences, type ThemeMode } from './themePreferences.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from './webUiPreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE, persistSettingsWrite } from './settingsPersistence.js';
import {
  getProfileConfigFilePath,
  readSavedProfilePreferences,
  resolveActiveProfile,
  writeSavedProfilePreferences,
} from './profilePreferences.js';
import { syncDaemonTaskScopeToProfile } from './daemonProfileSync.js';
import {
  buildScheduledTaskMarkdown,
  readScheduledTaskFileMetadata,
  taskBelongsToProfile,
  type TaskRuntimeEntry,
} from './scheduledTasks.js';
import { createProjectAgentExtension } from './projectAgentExtension.js';
import { createArtifactAgentExtension } from './artifactAgentExtension.js';
import { createDeferredResumeAgentExtension } from './deferredResumeAgentExtension.js';
import { createScheduledTaskAgentExtension } from './scheduledTaskAgentExtension.js';
import { createActivityAgentExtension } from './activityAgentExtension.js';
import { createConversationTodoAgentExtension } from './conversationTodoAgentExtension.js';
import { createRunAgentExtension } from './runAgentExtension.js';
import { createMemoryAgentExtension } from './memoryAgentExtension.js';
import {
  saveCuratedDistilledConversationMemory,
  type DistilledConversationMemoryDraft,
} from './conversationMemoryCuration.js';
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
  restoreQueuedMessage,
  queuePromptContext,
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
  registry as liveRegistry,
} from './liveSessions.js';
import {
  abortRemoteLiveSession,
  browseRemoteTargetDirectory,
  clearRemoteConversationBindingForConversation,
  createLocalMirrorSession,
  createRemoteLiveSession,
  forkLocalMirrorSession,
  getRemoteLiveSessionMeta,
  isRemoteLiveSession,
  listRemoteLiveSessions,
  promptRemoteLiveSession,
  readRemoteConversationBindingForConversation,
  resumeRemoteLiveSession,
  stopRemoteLiveSession,
  subscribeRemoteLiveSession,
  syncRemoteConversationMirror,
} from './remoteLiveSessions.js';
import { recoverDurableLiveConversations } from './conversationRecovery.js';
import {
  loadConversationAutomationState,
  readSavedConversationAutomationPreferences,
  replaceConversationAutomationItems,
  resetConversationAutomationFromItem,
  resolveConversationAutomationPath,
  updateConversationAutomationEnabled,
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
import { cancelDurableRun, getDurableRun, getDurableRunLog, getDurableRunSnapshot, listDurableRuns } from './durableRuns.js';
import {
  buildConversationExecutionState,
  buildExecutionTargetsState,
  buildRemoteExecutionTranscriptResponse,
  importRemoteExecutionRun,
  readRemoteExecutionRunConversationId,
  resolveRemoteExecutionCwd,
  submitRemoteExecutionRun,
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
  addConversationProjectLink,
  deleteConversationArtifact,
  deleteConversationAttachment,
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  getConversationArtifact,
  getConversationAttachment,
  getConversationExecutionTarget,
  getConversationProjectLink,
  getExecutionTarget,
  getProfilesRoot,
  getStateRoot,
  loadMemoryDocs,
  loadMemoryPackageReferences,
  listConversationProjectLinks,
  listConversationArtifacts,
  listConversationAttachments,
  inspectCliBinary,
  inspectMcpServer,
  inspectMcpTool,
  listProfileActivityEntries,
  listProjectIds,
  createProjectActivityEntry,
  listDeferredResumeRecords,
  loadDeferredResumeState,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  getMemoryDocsDir,
  getPiAgentRuntimeDir,
  getPiAgentStateDir,
  migrateLegacyProfileMemoryDirs,
  readConversationAttachmentDownload,
  readMcpConfig,
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
  writeProfileActivityEntry,
  deleteExecutionTarget,
} from '@personal-agent/core';
import {
  getRepoDefaultsAgentDir,
  installPackageSource,
  listProfiles,
  materializeProfileToAgentDir,
  readPackageSourceTargetState,
  resolveProfileSettingsFilePath,
  resolveResourceProfile,
} from '@personal-agent/resources';
import {
  completeDeferredResumeConversationRun,
  loadDaemonConfig,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  parsePendingOperation,
  parseTaskDefinition,
  resolveDaemonPaths,
  startScheduledTaskRun,
  startBackgroundRun,
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
import { generateProjectBrief } from './projectBriefs.js';
import { openLocalPathOnHost } from './localPathOpener.js';
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
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? DEFAULT_REPO_ROOT;
const PROCESS_CWD = process.cwd();
const AGENT_DIR = getPiAgentRuntimeDir();
const AUTH_FILE = join(AGENT_DIR, 'auth.json');
const SESSIONS_DIR = join(getPiAgentStateDir(), 'sessions');
const TASK_STATE_FILE = join(getStateRoot(), 'daemon', 'task-state.json');
const PROFILE_CONFIG_FILE = getProfileConfigFilePath();
const DEFERRED_RESUME_POLL_MS = 3_000;
const DEFERRED_RESUME_RETRY_DELAY_MS = 30_000;
const CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE = 'conversation-memory-distill';
const CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES = new Set(['queued', 'running', 'recovering', 'waiting']);

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
  options?: { tailBlocks?: number },
): (() => void) | null {
  return subscribeLocal(sessionId, listener, options)
    ?? subscribeRemoteLiveSession(sessionId, listener, options);
}

async function abortLiveSession(sessionId: string): Promise<void> {
  if (isRemoteLiveSession(sessionId)) {
    await abortRemoteLiveSession(sessionId);
    return;
  }

  await abortLocalSession(sessionId);
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
  invalidateAppTopics('activity', 'projects', 'tasks');
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
    createRunAgentExtension(),
    createMemoryAgentExtension(),
    createArtifactAgentExtension({
      stateRoot: getStateRoot(),
      getCurrentProfile,
    }),
    createDeferredResumeAgentExtension(),
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

function createInboxActivityId(prefix: string): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${suffix}`;
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

function writeConversationMemoryDistillActivity(options: {
  profile: string;
  conversationId: string;
  kind: 'conversation-memory-distilled' | 'conversation-memory-distill-failed';
  summary: string;
  details: string;
  relatedProjectIds: string[];
}): string {
  const activityId = createInboxActivityId(options.kind === 'conversation-memory-distilled' ? 'memory-distill' : 'memory-distill-fail');
  const createdAt = new Date().toISOString();
  const entry = createProjectActivityEntry({
    id: activityId,
    createdAt,
    profile: options.profile,
    kind: options.kind,
    summary: options.summary,
    details: options.details,
    relatedProjectIds: options.relatedProjectIds,
  });

  writeProfileActivityEntry({
    profile: options.profile,
    entry,
  });

  setActivityConversationLinks({
    profile: options.profile,
    activityId,
    relatedConversationIds: [options.conversationId],
  });

  invalidateAppTopics('activity', 'sessions');
  return activityId;
}

interface ConversationMemoryDistillRunState {
  conversationId: string;
  running: boolean;
  runId: string | null;
  status: string | null;
}

function isConversationMemoryDistillRun(run: Awaited<ReturnType<typeof listDurableRuns>>['runs'][number], conversationId: string): boolean {
  return run.manifest?.kind === 'background-run'
    && run.manifest.source?.type === CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE
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

async function listMemoryWorkItems(): Promise<MemoryWorkItem[]> {
  const sessionsById = new Map(listConversationSessionsSnapshot().map((session) => [session.id, session]));
  const runs = (await listDurableRuns()).runs
    .filter((run) => run.manifest?.kind === 'background-run' && run.manifest.source?.type === CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE)
    .sort((left, right) => {
      const leftCreatedAt = left.manifest?.createdAt ?? '';
      const rightCreatedAt = right.manifest?.createdAt ?? '';
      return rightCreatedAt.localeCompare(leftCreatedAt);
    });

  const visibleStatuses = new Set([...CONVERSATION_MEMORY_DISTILL_ACTIVE_STATUSES, 'failed', 'interrupted']);
  const items: MemoryWorkItem[] = [];
  const seenConversationIds = new Set<string>();

  for (const run of runs) {
    const conversationId = typeof run.manifest?.source?.id === 'string' ? run.manifest.source.id.trim() : '';
    if (!conversationId || seenConversationIds.has(conversationId)) {
      continue;
    }

    const status = run.status?.status ?? '';
    if (!visibleStatuses.has(status)) {
      continue;
    }

    seenConversationIds.add(conversationId);
    const session = sessionsById.get(conversationId);
    const createdAt = run.manifest?.createdAt ?? run.status?.createdAt ?? new Date().toISOString();
    const updatedAt = run.status?.updatedAt ?? createdAt;

    items.push({
      conversationId,
      conversationTitle: session?.title ?? conversationId,
      runId: run.runId,
      status,
      createdAt,
      updatedAt,
      ...(run.status?.lastError ? { lastError: run.status.lastError } : {}),
    });
  }

  return items;
}

function loadTaskStateEntries(): TaskRuntimeEntry[] {
  if (!existsSync(TASK_STATE_FILE)) {
    return [];
  }

  const taskState = JSON.parse(readFileSync(TASK_STATE_FILE, 'utf-8')) as { tasks?: Record<string, unknown> };
  return Object.values(taskState.tasks ?? {}) as TaskRuntimeEntry[];
}

function taskDirForProfile(profile: string): string {
  return join(getProfilesRoot(), profile, 'agent', 'tasks');
}

function listTaskDefinitionFiles(taskDir: string): string[] {
  if (!existsSync(taskDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [taskDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.task.md')) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function findCurrentProfileTaskEntry(taskId: string): TaskRuntimeEntry | undefined {
  const currentProfile = getCurrentProfile();
  const runtimeEntries = loadTaskStateEntries().filter((task) => taskBelongsToProfile(task, currentProfile));
  const matchedRuntime = runtimeEntries.find((task) => task.id === taskId);
  if (matchedRuntime) {
    return matchedRuntime;
  }

  for (const filePath of listTaskDefinitionFiles(taskDirForProfile(currentProfile))) {
    try {
      const metadata = readScheduledTaskFileMetadata(filePath);
      if (metadata.id !== taskId) {
        continue;
      }

      return {
        id: metadata.id,
        filePath,
        scheduleType: metadata.scheduleType,
        running: false,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function listTasksForCurrentProfile() {
  const currentProfile = getCurrentProfile();
  const runtimeEntries = loadTaskStateEntries().filter((task) => taskBelongsToProfile(task, currentProfile));
  const runtimeByFilePath = new Map(runtimeEntries.map((task) => [task.filePath, task]));
  const runtimeById = new Map(runtimeEntries.map((task) => [task.id, task]));
  const tasks = listTaskDefinitionFiles(taskDirForProfile(currentProfile)).flatMap((filePath) => {
    try {
      const metadata = readScheduledTaskFileMetadata(filePath);
      const runtime = runtimeByFilePath.get(filePath) ?? runtimeById.get(metadata.id);
      return [{
        id: metadata.id,
        filePath,
        scheduleType: metadata.scheduleType,
        running: runtime?.running ?? false,
        enabled: metadata.enabled,
        cron: metadata.cron,
        at: metadata.at,
        prompt: metadata.prompt,
        model: metadata.model,
        lastStatus: runtime?.lastStatus,
        lastRunAt: runtime?.lastRunAt,
        lastSuccessAt: runtime?.lastSuccessAt,
        lastAttemptCount: runtime?.lastAttemptCount,
      }];
    } catch {
      return [];
    }
  });

  tasks.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));
  return tasks;
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

function buildTaskDetailResponse(entry: TaskRuntimeEntry) {
  const metadata = readScheduledTaskFileMetadata(entry.filePath);
  return {
    ...entry,
    id: metadata.id,
    scheduleType: metadata.scheduleType,
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
      };
    }),
  ];
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
    project: annotateProjectRecord(detail.project, profile),
    attachments: applyProjectProfile(detail.attachments, profile),
    artifacts: applyProjectProfile(detail.artifacts, profile),
    linkedConversations,
    timeline: [],
  };
  enriched.timeline = buildProjectTimeline(enriched, profile);
  return enriched;
}

function readProjectDetailForCurrentProfile(projectId: string): ProjectDetailWithProfile {
  return readProjectDetailForProfile(projectId, getCurrentProfile());
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

async function buildSnapshotEvents(topics: AppEventTopic[]) {
  const uniqueTopics = [...new Set(topics)];
  const events = await Promise.all(uniqueTopics.map(async (topic) => {
    switch (topic) {
      case 'activity': {
        const snapshot = getActivitySnapshotForCurrentProfile();
        return { type: 'activity_snapshot' as const, entries: snapshot.entries, unreadCount: snapshot.unreadCount };
      }
      case 'projects':
        return { type: 'projects_snapshot' as const, projects: listProjectsForCurrentProfile() };
      case 'sessions':
        return { type: 'sessions_snapshot' as const, sessions: listConversationSessionsSnapshot() };
      case 'tasks':
        return { type: 'tasks_snapshot' as const, tasks: listTasksForCurrentProfile() };
      case 'runs':
        return { type: 'runs_snapshot' as const, result: await listDurableRuns() };
      default:
        return null;
    }
  }));

  return events.filter((event): event is NonNullable<typeof event> => event !== null);
}

const DIST_DIR =
  process.env.PA_WEB_DIST ??
  join(dirname(fileURLToPath(import.meta.url)), '../dist');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(webRequestLoggingMiddleware);

startAppEventMonitor({
  repoRoot: REPO_ROOT,
  sessionsDir: SESSIONS_DIR,
  taskStateFile: TASK_STATE_FILE,
  getCurrentProfile,
});

createServiceAttentionMonitor({
  repoRoot: REPO_ROOT,
  stateRoot: resolveDaemonRoot(),
  getCurrentProfile,
  readDaemonState,
  readGatewayState,
  logger: {
    warn: (message, fields) => logWarn(message, fields),
  },
}).start();

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
    for (const event of await buildSnapshotEvents(topics)) {
      writeEvent(event);
    }
  };

  writeEvent({ type: 'connected' });
  enqueueWrite(async () => {
    await writeSnapshotEvents(['activity', 'projects', 'sessions', 'tasks', 'runs']);
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

// ── Gateway ──────────────────────────────────────────────────────────────────

app.get('/api/gateway', (_req, res) => {
  try {
    res.json(readGatewayState(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/config', (req, res) => {
  try {
    const input = parseGatewayConfigUpdateInput(req.body);
    if (!listAvailableProfiles().includes(input.profile)) {
      res.status(400).json({ error: `Unknown profile: ${input.profile}` });
      return;
    }

    suppressMonitoredServiceAttention('gateway');
    res.json(saveGatewayConfigAndReadState(getCurrentProfile(), input));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.startsWith('Unknown profile:') || message.includes('must be') || message.endsWith('is required')
      ? 400
      : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/gateway/restart', (_req, res) => {
  try {
    suppressMonitoredServiceAttention('gateway');
    res.json(restartGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/install', (_req, res) => {
  try {
    suppressMonitoredServiceAttention('gateway');
    res.json(installGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/start', (_req, res) => {
  try {
    suppressMonitoredServiceAttention('gateway');
    res.json(startGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/stop', (_req, res) => {
  try {
    suppressMonitoredServiceAttention('gateway');
    res.json(stopGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/uninstall', (_req, res) => {
  try {
    suppressMonitoredServiceAttention('gateway');
    res.json(uninstallGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
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
    res.json(await installDaemonServiceAndReadState());
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
    res.json(await startDaemonServiceAndReadState());
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
    res.json(await restartDaemonServiceAndReadState());
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
    res.json(await stopDaemonServiceAndReadState());
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
    res.json(await uninstallDaemonServiceAndReadState());
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
    res.json(await requestSyncRunAndReadState());
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
    res.json(await setupSyncAndReadState(input));
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
    res.json(installWebUiServiceAndReadState());
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
    res.json(startWebUiServiceAndReadState());
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
    res.json(stopWebUiServiceAndReadState());
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
    res.json(uninstallWebUiServiceAndReadState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

// ── Activity ─────────────────────────────────────────────────────────────────

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
    const availableProjectIds = new Set(listProjectIds({ repoRoot: REPO_ROOT, profile }));
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

const SETTINGS_FILE = DEFAULT_RUNTIME_SETTINGS_FILE;

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

function listAvailableThemeIds(): string[] {
  try {
    const profile = resolveResourceProfile(getCurrentProfile(), {
      repoRoot: REPO_ROOT,
      profilesRoot: getProfilesRoot(),
    });
    const ids = profile.themeEntries
      .map((entry) => basename(entry, '.json').trim())
      .filter((entry) => entry.length > 0);

    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
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
  invalidateAppTopics('sessions');
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

  invalidateAppTopics('sessions');
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

    if (login.status === 'completed') {
      reloadAllLiveSessionAuth();
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
    if (login.status === 'completed') {
      reloadAllLiveSessionAuth();
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
        usedBy: ['op:// secret references', 'web-tools extension', 'gateway secret resolution'],
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

app.get('/api/agent-theme', (_req, res) => {
  try {
    const saved = readSavedThemePreferences(SETTINGS_FILE);
    res.json({
      ...saved,
      themes: listAvailableThemeIds(),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/agent-theme', (req, res) => {
  try {
    const { themeMode, themeDark, themeLight } = req.body as {
      themeMode?: ThemeMode;
      themeDark?: string;
      themeLight?: string;
    };

    if (themeMode === undefined && themeDark === undefined && themeLight === undefined) {
      res.status(400).json({ error: 'themeMode, themeDark, or themeLight required' });
      return;
    }

    persistSettingsWrite((settingsFile) => {
      writeSavedThemePreferences({ themeMode, themeDark, themeLight }, settingsFile);
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

app.get('/api/web-ui/open-conversations', (_req, res) => {
  try {
    const saved = readSavedWebUiPreferences(SETTINGS_FILE);
    res.json({
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/web-ui/open-conversations', (req, res) => {
  try {
    const { sessionIds, pinnedSessionIds } = req.body as {
      sessionIds?: string[];
      pinnedSessionIds?: string[];
    };

    if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
      res.status(400).json({ error: 'sessionIds must be an array when provided' });
      return;
    }

    if (pinnedSessionIds !== undefined && !Array.isArray(pinnedSessionIds)) {
      res.status(400).json({ error: 'pinnedSessionIds must be an array when provided' });
      return;
    }

    if (sessionIds === undefined && pinnedSessionIds === undefined) {
      res.status(400).json({ error: 'sessionIds or pinnedSessionIds required' });
      return;
    }

    const saved = persistSettingsWrite(
      (settingsFile) => writeSavedWebUiPreferences({
        openConversationIds: sessionIds,
        pinnedConversationIds: pinnedSessionIds,
      }, settingsFile),
      { runtimeSettingsFile: SETTINGS_FILE },
    );

    res.json({
      ok: true,
      sessionIds: saved.openConversationIds,
      pinnedSessionIds: saved.pinnedConversationIds,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/web-ui/config', (req, res) => {
  try {
    const { useTailscaleServe, resumeFallbackPrompt } = req.body as {
      useTailscaleServe?: unknown;
      resumeFallbackPrompt?: unknown;
    };

    if (useTailscaleServe === undefined && resumeFallbackPrompt === undefined) {
      res.status(400).json({ error: 'Provide useTailscaleServe and/or resumeFallbackPrompt.' });
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

    if (useTailscaleServe !== undefined) {
      syncConfiguredWebUiTailscaleServe(useTailscaleServe);
    }

    const savedConfig = writeWebUiConfig({
      ...(useTailscaleServe !== undefined ? { useTailscaleServe } : {}),
      ...(resumeFallbackPrompt !== undefined ? { resumeFallbackPrompt } : {}),
    });
    const state = readWebUiState();

    res.json({
      ...state,
      service: {
        ...state.service,
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

    if (existsSync(filePath) || listTasksForCurrentProfile().some((task) => task.id === taskId)) {
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

    parseTaskDefinition({
      filePath,
      rawContent: content,
      defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
    });

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    invalidateAppTopics('tasks');
    res.status(201).json({
      ok: true,
      task: buildTaskDetailResponse({
        id: taskId,
        filePath,
        scheduleType: body.at ? 'at' : 'cron',
        running: false,
      }),
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
    const entry = findCurrentProfileTaskEntry(req.params.id);
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    const requestedKeys = Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined);
    const enabled = body.enabled;
    const toggleOnly = requestedKeys.length === 1 && requestedKeys[0] === 'enabled' && typeof enabled === 'boolean';

    if (toggleOnly) {
      let content = readFileSync(entry.filePath, 'utf-8');
      if (/enabled:\s*(true|false)/.test(content)) {
        content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
      } else {
        content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
      }
      writeFileSync(entry.filePath, content, 'utf-8');
      invalidateAppTopics('tasks');
      res.json({ ok: true, task: buildTaskDetailResponse(entry) });
      return;
    }

    const metadata = readScheduledTaskFileMetadata(entry.filePath);
    const nextContent = buildScheduledTaskMarkdown({
      taskId: entry.id,
      profile: metadata.profile ?? getCurrentProfile(),
      enabled: body.enabled ?? metadata.enabled,
      cron: body.cron !== undefined ? body.cron : metadata.cron,
      at: body.at !== undefined ? body.at : metadata.at,
      model: body.model !== undefined ? body.model : metadata.model,
      cwd: body.cwd !== undefined ? body.cwd : metadata.cwd,
      timeoutSeconds: body.timeoutSeconds !== undefined ? body.timeoutSeconds : metadata.timeoutSeconds,
      prompt: body.prompt ?? metadata.promptBody,
      output: metadata.output,
    });

    parseTaskDefinition({
      filePath: entry.filePath,
      rawContent: nextContent,
      defaultTimeoutSeconds: loadDaemonConfig().modules.tasks.defaultTimeoutSeconds,
    });

    writeFileSync(entry.filePath, nextContent, 'utf-8');
    invalidateAppTopics('tasks');
    res.json({ ok: true, task: buildTaskDetailResponse(entry) });
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
    const entry = findCurrentProfileTaskEntry(req.params.id);
    if (!entry?.lastLogPath || !existsSync(entry.lastLogPath)) {
      res.status(404).json({ error: 'No log available' }); return;
    }
    const log = readFileSync(entry.lastLogPath, 'utf-8');
    res.json({ log, path: entry.lastLogPath });
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
    const entry = findCurrentProfileTaskEntry(req.params.id);
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    res.json(buildTaskDetailResponse(entry));
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
    const entry = findCurrentProfileTaskEntry(req.params.id);
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    const metadata = readScheduledTaskFileMetadata(entry.filePath);
    const fileContent = metadata.fileContent;
    const afterFrontmatter = fileContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    if (!afterFrontmatter) { res.status(400).json({ error: 'Task has no prompt body' }); return; }

    const result = await startScheduledTaskRun(entry.filePath);
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

async function readConversationExecutionState(conversationId: string) {
  const stored = getConversationExecutionTarget({
    profile: getCurrentProfile(),
    conversationId,
  });

  return buildConversationExecutionState({
    conversationId,
    targetId: stored?.targetId ?? null,
    runs: (await listDurableRuns()).runs,
    inspectSshBinary: inspectSshBinaryState,
  });
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
    res.json(await readExecutionTargetsState());
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
    res.json(await readExecutionTargetsState());
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

    res.json(await readExecutionTargetsState());
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

app.get('/api/sessions/:id', async (req, res) => {
  try {
    await syncRemoteConversationMirror({
      profile: getCurrentProfile(),
      conversationId: req.params.id,
    }).catch(() => undefined);

    const rawTailBlocks = Array.isArray(req.query.tailBlocks) ? req.query.tailBlocks[0] : req.query.tailBlocks;
    const parsedTailBlocks = typeof rawTailBlocks === 'string'
      ? Number.parseInt(rawTailBlocks, 10)
      : typeof rawTailBlocks === 'number'
        ? rawTailBlocks
        : undefined;
    const tailBlocks = Number.isInteger(parsedTailBlocks) && (parsedTailBlocks as number) > 0
      ? parsedTailBlocks as number
      : undefined;

    const result = readSessionBlocks(req.params.id, tailBlocks ? { tailBlocks } : undefined);
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

// ── Conversation memories ────────────────────────────────────────────────────

app.get('/api/memories', async (_req, res) => {
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

app.get('/api/memories/:memoryId', (req, res) => {
  try {
    const memory = findMemoryDocById(req.params.memoryId, { includeSearchText: true });
    if (!memory) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }

    if (!existsSync(memory.path)) {
      res.status(404).json({ error: 'Memory file not found.' });
      return;
    }

    const references = loadMemoryPackageReferences(dirname(memory.path)).map((reference) => ({
      title: reference.title,
      summary: reference.summary,
      tags: reference.tags,
      path: reference.filePath,
      relativePath: reference.relativePath,
      updated: reference.updated || undefined,
    } satisfies MemoryReferenceItem));

    res.json({
      memory,
      content: readFileSync(memory.path, 'utf-8'),
      references,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/memories/:memoryId', (req, res) => {
  try {
    const memory = findMemoryDocById(req.params.memoryId);
    if (!memory) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }

    const { content } = req.body as { content?: string };
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content required' });
      return;
    }

    writeFileSync(memory.path, content, 'utf-8');
    const refreshed = listMemoryDocs({ includeSearchText: true }).find((entry) => entry.path === memory.path) ?? memory;
    const references = loadMemoryPackageReferences(dirname(refreshed.path)).map((reference) => ({
      title: reference.title,
      summary: reference.summary,
      tags: reference.tags,
      path: reference.filePath,
      relativePath: reference.relativePath,
      updated: reference.updated || undefined,
    } satisfies MemoryReferenceItem));

    res.json({
      memory: refreshed,
      content,
      references,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/memories/:memoryId', (req, res) => {
  try {
    const memory = findMemoryDocById(req.params.memoryId);
    if (!memory) {
      res.status(404).json({ error: 'Memory not found.' });
      return;
    }

    if (!existsSync(memory.path)) {
      res.status(404).json({ error: 'Memory file not found.' });
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

app.get('/api/conversations/:id/memories/status', async (req, res) => {
  try {
    const conversationId = req.params.id;
    const state = await readConversationMemoryDistillRunState(conversationId);
    res.json(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: message });
  }
});

app.post('/api/conversations/:id/memories', async (req, res) => {
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
        error: 'A memory distillation is already running for this conversation.',
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

    const runnerPath = join(REPO_ROOT, 'packages/web/dist-server/distillConversationMemoryRun.js');
    if (!existsSync(runnerPath)) {
      res.status(500).json({ error: `Distillation runner not found: ${runnerPath}` });
      return;
    }

    const payload = Buffer.from(JSON.stringify({
      conversationId,
      anchorMessageId,
      title,
      summary,
      tags,
    }), 'utf-8').toString('base64url');

    const result = await startBackgroundRun({
      taskSlug: `distill-memory-${conversationId}`,
      cwd: REPO_ROOT,
      argv: [
        process.execPath,
        runnerPath,
        '--port',
        String(PORT),
        '--profile',
        profile,
        '--payload',
        payload,
      ],
      source: {
        type: CONVERSATION_MEMORY_DISTILL_RUN_SOURCE_TYPE,
        id: conversationId,
      },
    });

    if (!result.accepted) {
      res.status(503).json({
        error: result.reason ?? 'Could not start conversation memory distillation.',
        accepted: false,
        runId: result.runId,
      });
      return;
    }

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

app.post('/api/conversations/:id/memories/distill-now', (req, res) => {
  const currentProfile = getCurrentProfile();
  const conversationId = req.params.id;
  const {
    profile: requestedProfile,
    title,
    summary,
    anchorMessageId,
    tags,
    emitActivity = false,
  } = req.body as {
    profile?: string;
    title?: string;
    summary?: string;
    anchorMessageId?: string;
    tags?: string[];
    emitActivity?: boolean;
  };
  const profile = typeof requestedProfile === 'string' && requestedProfile.trim().length > 0
    ? requestedProfile.trim()
    : currentProfile;

  try {
    if (liveRegistry.get(conversationId)?.session.isStreaming) {
      res.status(409).json({ error: 'Stop the current response before distilling memory.' });
      return;
    }

    const sessionFile = resolveConversationSessionFile(conversationId);
    if (!sessionFile || !existsSync(sessionFile)) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const snapshot = buildCheckpointSnapshotFromSessionFile(sessionFile, anchorMessageId);
    const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === conversationId);
    const relatedProjectIds = getConversationProjectLink({
      profile,
      conversationId,
    })?.relatedProjectIds ?? [];

    const memory = saveDistilledConversationMemory({
      title,
      summary,
      tags,
      sourceConversationTitle: sourceSession?.title,
      sourceCwd: sourceSession?.cwd,
      sourceProfile: profile,
      relatedProjectIds,
      snapshot,
    });

    const activitySummary = memory.disposition === 'updated-existing'
      ? `Updated memory reference in @${memory.id}`
      : `Created memory reference in @${memory.id}`;
    const activityDetails = [
      memory.disposition === 'updated-existing'
        ? `Updated an existing reference inside durable memory hub @${memory.id} from this conversation.`
        : `Created a new reference inside durable memory hub @${memory.id} from this conversation.`,
      `Hub title: ${memory.title}`,
      memory.summary ? `Hub summary: ${memory.summary}` : undefined,
      `Reference: ${memory.reference.title}`,
      `Reference path: ${memory.reference.relativePath}`,
    ].filter((line): line is string => Boolean(line)).join('\n');

    const activityId = emitActivity
      ? writeConversationMemoryDistillActivity({
          profile,
          conversationId,
          kind: 'conversation-memory-distilled',
          summary: activitySummary,
          details: activityDetails,
          relatedProjectIds,
        })
      : undefined;

    res.json({
      conversationId,
      memory,
      disposition: memory.disposition,
      reference: memory.reference,
      ...(activityId ? { activityId } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (emitActivity) {
      try {
        const relatedProjectIds = getConversationProjectLink({
          profile,
          conversationId,
        })?.relatedProjectIds ?? [];
        writeConversationMemoryDistillActivity({
          profile,
          conversationId,
          kind: 'conversation-memory-distill-failed',
          summary: 'Conversation memory distillation failed',
          details: `Distillation failed for this conversation.\nError: ${message}`,
          relatedProjectIds,
        });
      } catch {
        // Ignore activity write errors in failure path.
      }
    }

    const status = message.includes('not found')
      ? 404
      : message.includes('Invalid') || message.includes('required') || message.includes('Unable to resolve') || message.includes('empty conversation')
        ? 400
        : 500;

    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/memories/:memoryId/start', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const memoryId = req.params.memoryId;
    const memory = listMemoryDocs().find((entry) => entry.id === memoryId);
    const loadedMemory = loadMemoryDocs({ profilesRoot: getProfilesRoot() }).docs.find((entry) => entry.id === memoryId);

    if (!memory || !loadedMemory) {
      res.status(404).json({ error: 'Memory not found.' });
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
    const availableProjectIds = new Set(listProjectIds({ repoRoot: REPO_ROOT, profile }));
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
    const inferredReferencedProjectIds = body.text
      ? resolvePromptReferences({
          text: body.text,
          availableProjectIds: listProjectIds({ repoRoot: REPO_ROOT, profile }),
          tasks: [],
          memoryDocs: [],
          skills: [],
          profiles: [],
        }).projectIds
      : [];
    const referencedProjectIds = body.referencedProjectIds && body.referencedProjectIds.length > 0
      ? body.referencedProjectIds
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

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send a heartbeat comment every 15s so the connection stays alive
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);

  const unsubscribe = subscribeLiveSession(id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }, tailBlocks ? { tailBlocks } : undefined);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe?.();
  });
});

function syncConversationProjectReferences(conversationId: string, mentionedProjectIds: string[]): string[] {
  const profile = getCurrentProfile();
  const availableProjectIds = listProjectIds({ repoRoot: REPO_ROOT, profile });
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
  const profile = getCurrentProfile();
  const lines = projectIds.map((projectId) => {
    const paths = resolveProjectPaths({
      repoRoot: REPO_ROOT,
      profile,
      projectId,
    });
    const lineParts = [`- @${projectId}: ${relative(REPO_ROOT, paths.projectFile)}`];

    try {
      const detail = readProjectDetailFromProject({
        repoRoot: REPO_ROOT,
        profile,
        projectId,
      });
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
    };
    const normalizedAttachmentRefs = normalizePromptAttachmentRefs(attachmentRefs);
    if (!text && (!images || images.length === 0) && normalizedAttachmentRefs.length === 0) {
      res.status(400).json({ error: 'text, images, or attachmentRefs required' });
      return;
    }

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
      availableProjectIds: listProjectIds({ repoRoot: REPO_ROOT, profile: currentProfile }),
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

    const queuedContextBlocks = [
      relatedProjectIds.length > 0 ? buildReferencedProjectsContext(relatedProjectIds) : '',
      referencedAttachments.length > 0 ? buildConversationAttachmentsContext(referencedAttachments) : '',
      referencedTasks.length > 0 ? buildReferencedTasksContext(referencedTasks, REPO_ROOT) : '',
      referencedMemoryDocs.length > 0 ? buildReferencedMemoryDocsContext(referencedMemoryDocs, REPO_ROOT) : '',
      referencedSkills.length > 0 ? buildReferencedSkillsContext(referencedSkills, REPO_ROOT) : '',
      referencedProfiles.length > 0 ? buildReferencedProfilesContext(referencedProfiles, REPO_ROOT) : '',
    ].filter(Boolean);

    const hiddenContext = queuedContextBlocks.join('\n\n');
    const isRemoteLive = isRemoteLiveSession(id);
    if (!isRemoteLive && queuedContextBlocks.length > 0) {
      await queuePromptContext(id, 'referenced_context', hiddenContext);
    }

    const liveEntry = liveRegistry.get(id);
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

    // Don't await — streaming response goes over SSE
    const promptImages = images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
      ...(image.name ? { name: image.name } : {}),
    }));
    const promptPromise = isRemoteLive
      ? promptRemoteLiveSession({
          conversationId: id,
          text,
          behavior,
          images: promptImages,
          ...(hiddenContext ? { hiddenContext } : {}),
        })
      : promptLocalSession(id, text, behavior, promptImages);

    promptPromise.catch(async (err) => {
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
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/dequeue', (req, res) => {
  try {
    const { behavior, index } = req.body as {
      behavior?: 'steer' | 'followUp';
      index?: number;
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
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/compact', async (req, res) => {
  try {
    const { customInstructions } = req.body as { customInstructions?: string };
    const result = await compactSession(req.params.id, customInstructions?.trim() || undefined);
    res.json({ ok: true, result });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/reload', async (req, res) => {
  try {
    await reloadSessionResources(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
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
    const { name } = req.body as { name?: string };
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
    res.status(500).json({ error: String(err) });
  }
});

/** Abort a running agent */
app.post('/api/live-sessions/:id/abort', async (req, res) => {
  try {
    await abortLiveSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

/** Get token usage stats for a live session */
app.get('/api/live-sessions/:id/context', (req, res) => {
  const { id } = req.params;

  // cwd: local live registry first, then remote live registry, then JSONL meta, then session list
  const liveEntry = liveRegistry.get(id);
  const remoteLive = getRemoteLiveSessionMeta(id);
  const detail = readSessionBlocks(id);
  const allSessions = listSessions();
  const sessionMeta = allSessions.find((session) => session.id === id);
  const cwd = liveEntry?.cwd ?? remoteLive?.cwd ?? detail?.meta.cwd ?? sessionMeta?.cwd;
  if (!cwd) { res.status(404).json({ error: 'Session not found' }); return; }

  const gitSummary = remoteLive ? null : readGitStatusSummary(cwd);

  // User messages: prefer local live in-memory messages (most up-to-date), otherwise use persisted transcript.
  let userMessages: { id: string; ts: string; text: string; imageCount: number }[] = [];
  if (liveEntry) {
    userMessages = liveEntry.session.agent.state.messages
      .filter((message) => message.role === 'user')
      .slice(-5)
      .map((message, index) => {
        const { text, imageCount } = summarizeUserMessageContent(message.content);
        return { id: String(index), ts: new Date().toISOString(), text: text.slice(0, 300), imageCount };
      });
  } else {
    userMessages = (detail?.blocks ?? [])
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

  res.json({
    cwd,
    branch: gitSummary?.branch ?? null,
    git: gitSummary
      ? {
          changeCount: gitSummary.changeCount,
          linesAdded: gitSummary.linesAdded,
          linesDeleted: gitSummary.linesDeleted,
        }
      : null,
    userMessages,
    relatedProjectIds,
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

app.get('/api/conversations/:id/execution', async (req, res) => {
  try {
    res.json(await readConversationExecutionState(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch('/api/conversations/:id/execution', async (req, res) => {
  try {
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

    res.json(await readConversationExecutionState(req.params.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(message.startsWith('Invalid') ? 400 : 500).json({ error: message });
  }
});

app.patch('/api/conversations/:id/title', (req, res) => {
  try {
    const { name } = req.body as { name?: string };
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
    const { entryId } = req.body as { entryId: string };
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
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/fork', async (req, res) => {
  try {
    const { entryId, preserveSource } = req.body as { entryId: string; preserveSource?: boolean };
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
  if (isRemoteLiveSession(req.params.id)) {
    await stopRemoteLiveSession(req.params.id);
    res.json({ ok: true });
    return;
  }

  destroySession(req.params.id);
  res.json({ ok: true });
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

app.post('/api/local-path/open', (req, res) => {
  try {
    const { path } = req.body as { path?: string };
    if (!path) {
      res.status(400).json({ error: 'path required' });
      return;
    }

    const normalizedPath = openLocalPathOnHost(path);
    res.json({ ok: true, path: normalizedPath });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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

function pathIsWithin(pathValue: string, dirValue: string): boolean {
  const normalizedPath = normalize(pathValue);
  const normalizedDir = normalize(dirValue);
  return normalizedPath === normalizedDir
    || normalizedPath.startsWith(`${normalizedDir}/`)
    || normalizedPath.startsWith(`${normalizedDir}\\`);
}

function inferSkillSource(skillPath: string, profile: string): string {
  const profileSkillDir = join(getProfilesRoot(), profile, 'agent', 'skills');
  if (profile !== 'shared' && pathIsWithin(skillPath, profileSkillDir)) {
    return profile;
  }

  const sharedSkillDirs = [
    join(getProfilesRoot(), 'shared', 'agent', 'skills'),
    join(REPO_ROOT, 'skills'),
  ];

  if (sharedSkillDirs.some((dir) => pathIsWithin(skillPath, dir))) {
    return 'shared';
  }

  return 'shared';
}

function listSkillsForProfile(profile = getCurrentProfile()): SkillItem[] {
  const resolved = resolveResourceProfile(profile, {
    repoRoot: REPO_ROOT,
    profilesRoot: getProfilesRoot(),
  });
  const skills: SkillItem[] = [];
  const seenPaths = new Set<string>();

  for (const dir of resolved.skillDirs) {
    if (!existsSync(dir)) {
      continue;
    }

    for (const name of readdirSync(dir)) {
      const skillMd = join(dir, name, 'SKILL.md');
      if (!existsSync(skillMd)) {
        continue;
      }

      const normalizedPath = normalize(skillMd);
      if (seenPaths.has(normalizedPath)) {
        continue;
      }
      seenPaths.add(normalizedPath);

      const fm = parseFrontmatter(skillMd);
      skills.push({
        source: inferSkillSource(skillMd, profile),
        name: String(fm.name ?? name),
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

function listProfileAgentItems(): AgentsItem[] {
  const items: AgentsItem[] = [];

  for (const profile of listAvailableProfiles()) {
    const filePath = join(getProfilesRoot(), profile, 'agent', 'AGENTS.md');
    if (!existsSync(filePath)) {
      continue;
    }

    items.push({
      source: profile,
      path: filePath,
      exists: true,
      content: readFileSync(filePath, 'utf-8'),
    });
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
    const sharedAgentsCandidates = [
      join(getProfilesRoot(), 'shared', 'agent', 'AGENTS.md'),
      join(getRepoDefaultsAgentDir(REPO_ROOT), 'AGENTS.md'),
    ];
    const sharedPath = sharedAgentsCandidates.find((candidate) => existsSync(candidate)) ?? sharedAgentsCandidates[0];
    const profilePath = join(getProfilesRoot(), profile, 'agent', 'AGENTS.md');
    const agentsMd: AgentsItem[] = [{
      source: 'shared',
      path: sharedPath,
      exists: existsSync(sharedPath),
      content: existsSync(sharedPath) ? readFileSync(sharedPath, 'utf-8') : undefined,
    }];
    if (profile !== 'shared') {
      agentsMd.push({
        source: profile,
        path: profilePath,
        exists: existsSync(profilePath),
        content: existsSync(profilePath) ? readFileSync(profilePath, 'utf-8') : undefined,
      });
    }

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

    const profilesRoot = getProfilesRoot();
    const allowed = filePath.endsWith('.md') && (
      pathIsWithin(filePath, REPO_ROOT)
      || pathIsWithin(filePath, profilesRoot)
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

app.post('/api/memory/file', (req, res) => {
  try {
    const { path: filePath, content } = req.body as { path: string; content: string };
    if (!filePath || content === undefined) { res.status(400).json({ error: 'path and content required' }); return; }

    const profilesRoot = getProfilesRoot();
    const allowed = filePath.endsWith('.md') && (
      pathIsWithin(filePath, REPO_ROOT)
      || pathIsWithin(filePath, profilesRoot)
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

// ── Static + SPA fallback ─────────────────────────────────────────────────────

if (existsSync(DIST_DIR)) {
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

app.listen(PORT, () => {
  logInfo('web ui started', {
    url: `http://localhost:${PORT}`,
    profile: getCurrentProfile(),
    repoRoot: REPO_ROOT,
    cwd: getDefaultWebCwd(),
    dist: DIST_DIR,
  });
});
