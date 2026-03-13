import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listSessions, readSessionBlocks, readSessionTree, renameStoredSession } from './sessions.js';
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
  installWebUiServiceAndReadState,
  markBadWebUiReleaseAndReadState,
  readWebUiState,
  restartWebUiServiceAndReadState,
  rollbackWebUiServiceAndReadState,
  startWebUiServiceAndReadState,
  stopWebUiServiceAndReadState,
  uninstallWebUiServiceAndReadState,
} from './webUi.js';
import { requestApplicationRestart } from './applicationRestart.js';
import { readSavedModelPreferences, writeSavedModelPreferences } from './modelPreferences.js';
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
  readScheduledTaskFileMetadata,
  taskBelongsToProfile,
  type TaskRuntimeEntry,
} from './scheduledTasks.js';
import { createProjectAgentExtension } from './projectAgentExtension.js';
import { createArtifactAgentExtension } from './artifactAgentExtension.js';
import { createDeferredResumeAgentExtension } from './deferredResumeAgentExtension.js';
import {
  createSession,
  createSessionFromExisting,
  resumeSession,
  getLiveSessions,
  getSessionStats,
  getSessionContextUsage,
  getAvailableModels,
  inspectAvailableTools,
  isLive,
  subscribe,
  promptSession,
  restoreQueuedMessage,
  queuePromptContext,
  compactSession,
  reloadSessionResources,
  exportSessionHtml,
  renameSession,
  abortSession,
  destroySession,
  branchSession,
  forkSession,
  registry as liveRegistry,
} from './liveSessions.js';
import { recoverDurableLiveConversations } from './conversationRecovery.js';
import { createWebLiveConversationRunId, syncWebLiveConversationRun } from './conversationRuns.js';
import { cancelDurableRun, getDurableRun, getDurableRunLog, listDurableRuns } from './durableRuns.js';
import {
  buildReferencedMemoryDocsContext,
  buildReferencedProfilesContext,
  buildReferencedSkillsContext,
  buildReferencedTasksContext,
  pickPromptReferencesInOrder,
  resolvePromptReferences,
} from './promptReferences.js';
import {
  activateDueDeferredResumes,
  addConversationProjectLink,
  deleteConversationArtifact,
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  getConversationArtifact,
  getConversationProjectLink,
  getReadySessionDeferredResumeEntries,
  listConversationProjectLinks,
  listConversationArtifacts,
  listConversationCheckpoints,
  getConversationCheckpoint,
  saveConversationCheckpoint,
  deleteConversationCheckpoint,
  resolveConversationCheckpointSnapshotFile,
  cleanMcpCliStderr,
  inspectCliBinary,
  inspectMcpCliServer,
  inspectMcpCliTool,
  listProfileActivityEntries,
  listProjectIds,
  loadDeferredResumeState,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  readMcpCliConfig,
  readProject,
  removeConversationProjectLink,
  removeDeferredResume,
  resolveProjectPaths,
  retryDeferredResume,
  saveDeferredResumeState,
  saveProfileActivityReadState,
  setConversationProjectLinks,
  summarizeConversationAttention,
} from '@personal-agent/core';
import {
  listProfiles,
  materializeProfileToAgentDir,
  resolveResourceProfile,
} from '@personal-agent/resources';
import {
  completeDeferredResumeConversationRun,
  loadDaemonConfig,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  parsePendingOperation,
  resolveDaemonPaths,
  startScheduledTaskRun,
} from '@personal-agent/daemon';
import {
  addProjectMilestone,
  createProjectRecord,
  createProjectTaskRecord,
  deleteProjectMilestone,
  deleteProjectRecord,
  deleteProjectTaskRecord,
  moveProjectMilestone,
  moveProjectTaskRecord,
  readProjectDetailFromProject,
  readProjectSource,
  saveProjectSource,
  updateProjectMilestone,
  updateProjectRecord,
  updateProjectTaskRecord,
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
import { generateProjectBrief } from './projectBriefs.js';
import {
  cancelDeferredResumeForSessionFile,
  listDeferredResumesForSessionFile,
  scheduleDeferredResumeForSessionFile,
} from './deferredResumes.js';

const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? DEFAULT_REPO_ROOT;
const DEFAULT_WEB_CWD = process.cwd();
const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const SESSIONS_DIR = join(AGENT_DIR, 'sessions');
const TASK_STATE_FILE = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
const PROFILE_CONFIG_FILE = getProfileConfigFilePath();
const DEFERRED_RESUME_POLL_MS = 3_000;
const DEFERRED_RESUME_RETRY_DELAY_MS = 30_000;

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

installProcessLogging();

function listAvailableProfiles(): string[] {
  return listProfiles({ repoRoot: REPO_ROOT });
}

function applyProfileEnvironment(profile: string): void {
  process.env.PERSONAL_AGENT_ACTIVE_PROFILE = profile;
  process.env.PERSONAL_AGENT_PROFILE = profile;
  process.env.PERSONAL_AGENT_REPO_ROOT = REPO_ROOT;
}

function materializeWebProfile(profile: string): void {
  applyProfileEnvironment(profile);
  const resolved = resolveResourceProfile(profile, { repoRoot: REPO_ROOT });
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

async function setCurrentProfile(profile: string): Promise<string> {
  const availableProfiles = listAvailableProfiles();
  if (!availableProfiles.includes(profile)) {
    throw new Error(`Unknown profile: ${profile}`);
  }

  if (profile === currentProfile) {
    return currentProfile;
  }

  materializeWebProfile(profile);
  currentProfile = profile;
  writeSavedProfilePreferences(profile, PROFILE_CONFIG_FILE);
  await syncDaemonTaskScopeForProfile(profile);
  invalidateAppTopics('activity', 'projects', 'tasks');
  return currentProfile;
}

function buildLiveSessionExtensionFactories() {
  return [
    createProjectAgentExtension({
      repoRoot: REPO_ROOT,
      getCurrentProfile,
    }),
    createArtifactAgentExtension({
      getCurrentProfile,
    }),
    createDeferredResumeAgentExtension(),
  ];
}

function buildLiveSessionResourceOptions() {
  const resolved = resolveResourceProfile(getCurrentProfile(), { repoRoot: REPO_ROOT });

  return {
    additionalExtensionPaths: resolved.extensionEntries,
    additionalSkillPaths: resolved.skillDirs,
    additionalPromptTemplatePaths: resolved.promptEntries,
    additionalThemePaths: resolved.themeEntries,
  };
}

// ── Activity read-state ───────────────────────────────────────────────────────
// Stored as a simple JSON set alongside activity files.
function loadReadState(profile = getCurrentProfile()): Set<string> {
  return loadProfileActivityReadState({ repoRoot: REPO_ROOT, profile });
}

function saveReadState(ids: Set<string>, profile = getCurrentProfile()) {
  try {
    saveProfileActivityReadState({ repoRoot: REPO_ROOT, profile, ids });
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

function attachActivityConversationLinks(
  profile: string,
  entry: ReturnType<typeof listProfileActivityEntries>[number]['entry'],
): ActivityEntryWithConversationLinks {
  const relatedConversationIds = getActivityConversationLink({
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

function listActivityForCurrentProfile() {
  const profile = getCurrentProfile();
  const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile });
  const read = loadReadState(profile);
  return entries.map(({ entry }) => ({
    ...attachActivityConversationLinks(profile, entry),
    read: read.has(entry.id),
  }));
}

function getActivitySnapshotForCurrentProfile() {
  const entries = listActivityForCurrentProfile();
  return {
    entries,
    unreadCount: entries.filter((entry) => !entry.read).length,
  };
}

function loadTaskStateEntries(): TaskRuntimeEntry[] {
  if (!existsSync(TASK_STATE_FILE)) {
    return [];
  }

  const taskState = JSON.parse(readFileSync(TASK_STATE_FILE, 'utf-8')) as { tasks?: Record<string, unknown> };
  return Object.values(taskState.tasks ?? {}) as TaskRuntimeEntry[];
}

function findCurrentProfileTaskEntry(taskId: string): TaskRuntimeEntry | undefined {
  const currentProfile = getCurrentProfile();
  return loadTaskStateEntries().find((task) => task.id === taskId && taskBelongsToProfile(task, currentProfile));
}

function listTasksForCurrentProfile() {
  const currentProfile = getCurrentProfile();

  return loadTaskStateEntries()
    .filter((task) => taskBelongsToProfile(task, currentProfile))
    .map((task) => {
      try {
        const metadata = readScheduledTaskFileMetadata(task.filePath);
        return {
          ...task,
          enabled: metadata.enabled,
          cron: metadata.cron,
          prompt: metadata.prompt,
          model: metadata.model,
        };
      } catch {
        return {
          ...task,
          enabled: true,
          prompt: '',
        };
      }
    });
}

function getSessionLastActivityAt(sessionFile: string, fallback: string): string {
  try {
    return new Date(statSync(sessionFile).mtimeMs).toISOString();
  } catch {
    return fallback;
  }
}

function listUnreadConversationActivityEntries(profile = getCurrentProfile()) {
  return listActivityForCurrentProfile()
    .filter((entry) => !entry.read && entry.relatedConversationIds && entry.relatedConversationIds.length > 0)
    .map((entry) => ({
      id: entry.id,
      createdAt: entry.createdAt,
      relatedConversationIds: entry.relatedConversationIds ?? [],
    }));
}

function decorateSessionsWithAttention<T extends {
  id: string;
  file: string;
  timestamp: string;
  messageCount: number;
}>(profile: string, sessions: T[]) {
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
    };
  });
}

function listConversationSessionsSnapshot() {
  const profile = getCurrentProfile();
  const jsonl = decorateSessionsWithAttention(profile, listSessions());
  const live = getLiveSessions();
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
  return listConversationSessionsSnapshot().find((session) => session.id === conversationId)?.file;
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

function defaultCheckpointTitleFromAnchor(anchorPreview: string, anchorTimestamp: string): string {
  const normalizedPreview = anchorPreview.trim();
  if (normalizedPreview.length > 0 && normalizedPreview !== 'Checkpoint anchor') {
    return normalizedPreview.length > 80 ? `${normalizedPreview.slice(0, 79).trimEnd()}…` : normalizedPreview;
  }

  const date = new Date(Date.parse(anchorTimestamp));
  if (Number.isFinite(date.getTime())) {
    return `Checkpoint ${date.toISOString().slice(0, 16).replace('T', ' ')}`;
  }

  return 'Checkpoint';
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
    throw new Error('Cannot create a checkpoint from an empty conversation. Send at least one prompt first.');
  }

  const anchorMessageId = resolveAnchorMessageId(
    messageEntries.map((entry) => entry.message.id),
    requestedAnchorMessageId,
  );

  if (!anchorMessageId) {
    throw new Error('Unable to resolve checkpoint anchor message.');
  }

  const anchorEntry = messageEntries.find((entry) => entry.message.id === anchorMessageId);
  if (!anchorEntry) {
    throw new Error(`Checkpoint anchor message ${anchorMessageId} not found.`);
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

function listLinkedProjectConversations(projectId: string): ProjectLinkedConversation[] {
  const profile = getCurrentProfile();
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

function buildProjectTimeline(detail: ProjectDetail): ProjectTimelineEntry[] {
  const activityEntries = listActivityForCurrentProfile()
    .filter((entry) => (entry.relatedProjectIds ?? []).includes(detail.project.id));

  const timeline: ProjectTimelineEntry[] = [];

  if (detail.brief) {
    timeline.push({
      id: `brief:${detail.project.id}`,
      kind: 'brief',
      createdAt: detail.brief.updatedAt,
      title: 'Project brief updated',
      description: detail.brief.content.split('\n').find((line) => line.trim().length > 0)?.trim(),
      href: '#project-brief',
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

function readProjectDetailForCurrentProfile(projectId: string): ProjectDetail {
  const detail = readProjectDetailFromProject({
    repoRoot: REPO_ROOT,
    profile: getCurrentProfile(),
    projectId,
  });
  const linkedConversations = listLinkedProjectConversations(projectId);
  const enriched: ProjectDetail = {
    ...detail,
    linkedConversations,
    timeline: [],
  };
  enriched.timeline = buildProjectTimeline(enriched);
  return enriched;
}

var processingDeferredResumes = false;

async function flushLiveDeferredResumes(): Promise<void> {
  if (processingDeferredResumes) {
    return;
  }

  processingDeferredResumes = true;

  try {
    // Deferred resumes should only inject prompts into conversations that are already live.
    // Dormant conversations stay dormant until the user explicitly reopens them, at which
    // point the normal resume route calls this same flush path again.
    const liveSessions = getLiveSessions().filter((session) => session.sessionFile);
    if (liveSessions.length === 0) {
      return;
    }

    const state = loadDeferredResumeState();
    const now = new Date();
    let mutated = false;

    for (const session of liveSessions) {
      const activated = activateDueDeferredResumes(state, {
        at: now,
        sessionFile: session.sessionFile,
      });
      if (activated.length > 0) {
        mutated = true;
        const daemonRoot = resolveDaemonRoot();
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

      const readyEntries = getReadySessionDeferredResumeEntries(state, session.sessionFile);
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

          await promptSession(
            session.id,
            readyEntry.prompt,
            liveEntry.session.isStreaming ? 'followUp' : undefined,
          );
          removeDeferredResume(state, readyEntry.id);
          await completeDeferredResumeConversationRun({
            daemonRoot: resolveDaemonRoot(),
            deferredResumeId: readyEntry.id,
            sessionFile: readyEntry.sessionFile,
            prompt: readyEntry.prompt,
            dueAt: readyEntry.dueAt,
            createdAt: readyEntry.createdAt,
            readyAt: readyEntry.readyAt,
            completedAt: new Date().toISOString(),
            conversationId: session.id,
            cwd: liveEntry.cwd,
          });
          mutated = true;
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
          retryDeferredResume(state, {
            id: readyEntry.id,
            dueAt: retryDueAt,
          });
          await markDeferredResumeConversationRunRetryScheduled({
            daemonRoot: resolveDaemonRoot(),
            deferredResumeId: readyEntry.id,
            sessionFile: readyEntry.sessionFile,
            prompt: readyEntry.prompt,
            dueAt: retryDueAt,
            createdAt: readyEntry.createdAt,
            retryAt: retryDueAt,
            conversationId: session.id,
            cwd: liveEntry.cwd,
            lastError: (error as Error).message,
          });
          mutated = true;
          logWarn(`Deferred resume delivery failed for ${session.id}: ${(error as Error).message}`);
          break;
        }
      }
    }

    if (mutated) {
      saveDeferredResumeState(state);
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
    isLive,
    resumeSession,
    queuePromptContext,
    promptSession,
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

function buildSnapshotEvents(topics: AppEventTopic[]) {
  const uniqueTopics = [...new Set(topics)];
  return uniqueTopics.map((topic) => {
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
      default:
        return null;
    }
  }).filter((event): event is NonNullable<typeof event> => event !== null);
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

  const writeEvent = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  writeEvent({ type: 'connected' });
  for (const event of buildSnapshotEvents(['activity', 'projects', 'sessions', 'tasks'])) {
    writeEvent(event);
  }

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === 'invalidate') {
      for (const snapshotEvent of buildSnapshotEvents(event.topics)) {
        writeEvent(snapshotEvent);
      }
    }
    writeEvent(event);
  });

  req.on('close', () => {
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
    const activities = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile });
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
    const status = message.startsWith('Application restart already in progress')
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
    res.json(restartWebUiServiceAndReadState());
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/web-ui/service/rollback', (req, res) => {
  try {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const snapshot = rollbackWebUiServiceAndReadState({ reason });
    try {
      writeInternalAttentionEntry({
        repoRoot: REPO_ROOT,
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
    const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile });
    const match = entries.find(({ entry }) => entry.id === req.params.id);
    if (!match) { res.status(404).json({ error: 'Not found' }); return; }
    const read = loadReadState(profile);
    res.json({ ...attachActivityConversationLinks(profile, match.entry), read: read.has(match.entry.id) });
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
    const state = loadReadState(profile);
    if (read === false) state.delete(id); else state.add(id);
    saveReadState(state, profile);
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
    const profile = resolveResourceProfile(getCurrentProfile(), { repoRoot: REPO_ROOT });
    const ids = profile.themeEntries
      .map((entry) => basename(entry, '.json').trim())
      .filter((entry) => entry.length > 0);

    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
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

app.get('/api/tools', async (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const details = await inspectAvailableTools(REPO_ROOT, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    const mcpCliBinary = inspectCliBinary({ command: 'mcp-cli', cwd: REPO_ROOT });
    const mcpCliConfig = readMcpCliConfig({ cwd: REPO_ROOT });
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
      mcpCli: {
        binary: mcpCliBinary,
        configPath: mcpCliConfig.path,
        configExists: mcpCliConfig.exists,
        searchedPaths: mcpCliConfig.searchedPaths,
        servers: mcpCliConfig.servers,
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

app.get('/api/tools/mcp/servers/:server', (_req, res) => {
  try {
    const server = _req.params.server;
    if (!server) {
      res.status(400).json({ error: 'server required' });
      return;
    }

    const config = readMcpCliConfig({ cwd: REPO_ROOT });
    const result = inspectMcpCliServer(server, {
      cwd: REPO_ROOT,
      configPath: config.path,
    });

    if (result.exitCode !== 0) {
      res.status(500).json({
        error: result.error ?? (cleanMcpCliStderr(result.stderr) || result.stdout || `mcp-cli exited with code ${result.exitCode}`),
        stdout: result.stdout,
        stderr: cleanMcpCliStderr(result.stderr),
        exitCode: result.exitCode,
      });
      return;
    }

    res.json({
      server,
      stdout: result.stdout,
      stderr: cleanMcpCliStderr(result.stderr),
      exitCode: result.exitCode,
      ...result.info,
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tools/mcp/servers/:server/tools/:tool', (_req, res) => {
  try {
    const { server, tool } = _req.params;
    if (!server || !tool) {
      res.status(400).json({ error: 'server and tool required' });
      return;
    }

    const config = readMcpCliConfig({ cwd: REPO_ROOT });
    const result = inspectMcpCliTool(server, tool, {
      cwd: REPO_ROOT,
      configPath: config.path,
    });

    if (result.exitCode !== 0) {
      res.status(500).json({
        error: result.error ?? (cleanMcpCliStderr(result.stderr) || result.stdout || `mcp-cli exited with code ${result.exitCode}`),
        stdout: result.stdout,
        stderr: cleanMcpCliStderr(result.stderr),
        exitCode: result.exitCode,
      });
      return;
    }

    res.json({
      server,
      tool,
      stdout: result.stdout,
      stderr: cleanMcpCliStderr(result.stderr),
      exitCode: result.exitCode,
      ...result.info,
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

app.patch('/api/tasks/:id', (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const entry = findCurrentProfileTaskEntry(req.params.id);
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    let content = readFileSync(entry.filePath, 'utf-8');
    if (/enabled:\s*(true|false)/.test(content)) {
      content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
    } else {
      content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
    }
    writeFileSync(entry.filePath, content, 'utf-8');
    invalidateAppTopics('tasks');
    res.json({ ok: true });
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

    const metadata = readScheduledTaskFileMetadata(entry.filePath);
    res.json({
      ...entry,
      enabled: metadata.enabled,
      cron: metadata.cron,
      model: metadata.model,
      fileContent: metadata.fileContent,
    });
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

app.get('/api/runs/:id/log', async (req, res) => {
  try {
    const tailRaw = typeof req.query.tail === 'string' ? Number.parseInt(req.query.tail, 10) : undefined;
    const tail = Number.isFinite(tailRaw) && (tailRaw as number) > 0
      ? Math.min(1000, tailRaw as number)
      : 120;

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

app.get('/api/sessions/:id', (req, res) => {
  try {
    const result = readSessionBlocks(req.params.id);
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

// ── Conversation checkpoints ─────────────────────────────────────────────────

app.get('/api/checkpoints', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    res.json({
      checkpoints: listConversationCheckpoints({ profile }),
    });
  } catch (err) {
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/checkpoints/:checkpointId/start', async (req, res) => {
  try {
    const profile = getCurrentProfile();
    const checkpoint = getConversationCheckpoint({
      profile,
      checkpointId: req.params.checkpointId,
    });

    if (!checkpoint) {
      res.status(404).json({ error: 'Checkpoint not found.' });
      return;
    }

    const snapshotFile = resolveConversationCheckpointSnapshotFile({
      profile,
      checkpoint,
    });

    if (!existsSync(snapshotFile)) {
      res.status(409).json({ error: 'Checkpoint snapshot is missing. Delete and recreate this checkpoint.' });
      return;
    }

    const { cwd: requestedCwd } = req.body as { cwd?: string };
    const sourceCwd = checkpoint.source.cwd || DEFAULT_WEB_CWD;
    let nextCwd = resolveRequestedCwd(requestedCwd, sourceCwd);

    if (!nextCwd && !requestedCwd) {
      nextCwd = DEFAULT_WEB_CWD;
    }

    if (!nextCwd) {
      res.status(400).json({ error: 'cwd required' });
      return;
    }

    if ((!existsSync(nextCwd) || !statSync(nextCwd).isDirectory()) && !requestedCwd && nextCwd !== DEFAULT_WEB_CWD) {
      nextCwd = DEFAULT_WEB_CWD;
    }

    if (!existsSync(nextCwd)) {
      res.status(400).json({ error: `Directory does not exist: ${nextCwd}` });
      return;
    }

    if (!statSync(nextCwd).isDirectory()) {
      res.status(400).json({ error: `Not a directory: ${nextCwd}` });
      return;
    }

    const result = await createSessionFromExisting(snapshotFile, nextCwd, {
      ...buildLiveSessionResourceOptions(),
      extensionFactories: buildLiveSessionExtensionFactories(),
    });

    const availableProjectIds = new Set(listProjectIds({ repoRoot: REPO_ROOT, profile }));
    const relatedProjectIds = checkpoint.source.relatedProjectIds.filter((projectId) => availableProjectIds.has(projectId));

    if (relatedProjectIds.length > 0) {
      setConversationProjectLinks({
        profile,
        conversationId: result.id,
        relatedProjectIds,
      });
      invalidateAppTopics('projects', 'sessions');
    }

    res.json({
      checkpointId: checkpoint.id,
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

app.delete('/api/checkpoints/:checkpointId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const deleted = deleteConversationCheckpoint({
      profile,
      checkpointId: req.params.checkpointId,
    });

    if (!deleted) {
      res.status(404).json({ error: 'Checkpoint not found.' });
      return;
    }

    invalidateAppTopics('sessions');
    res.json({ ok: true, checkpointId: req.params.checkpointId, deleted: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Invalid checkpoint id') ? 400 : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.get('/api/conversations/:id/checkpoints', (req, res) => {
  try {
    const profile = getCurrentProfile();
    res.json({
      conversationId: req.params.id,
      checkpoints: listConversationCheckpoints({
        profile,
        conversationId: req.params.id,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('Invalid conversation id') ? 400 : 500;
    logError('request handler error', {
      message,
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(status).json({ error: message });
  }
});

app.post('/api/conversations/:id/checkpoints', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const conversationId = req.params.id;
    if (liveRegistry.get(conversationId)?.session.isStreaming) {
      res.status(409).json({ error: 'Stop the current response before saving a checkpoint.' });
      return;
    }

    const sessionFile = resolveConversationSessionFile(conversationId);
    if (!sessionFile || !existsSync(sessionFile)) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const {
      title,
      note,
      summary,
      anchorMessageId,
    } = req.body as {
      title?: string;
      note?: string;
      summary?: string;
      anchorMessageId?: string;
    };

    const snapshot = buildCheckpointSnapshotFromSessionFile(sessionFile, anchorMessageId);
    const sourceSession = listConversationSessionsSnapshot().find((session) => session.id === conversationId);
    const relatedProjectIds = getConversationProjectLink({
      profile,
      conversationId,
    })?.relatedProjectIds ?? [];

    const checkpoint = saveConversationCheckpoint({
      profile,
      title: title?.trim() || defaultCheckpointTitleFromAnchor(snapshot.anchor.preview, snapshot.anchor.timestamp),
      note,
      summary,
      source: {
        conversationId,
        conversationTitle: sourceSession?.title,
        cwd: sourceSession?.cwd,
        relatedProjectIds,
      },
      anchor: snapshot.anchor,
      snapshotContent: snapshot.snapshotContent,
      snapshotMessageCount: snapshot.snapshotMessageCount,
      snapshotLineCount: snapshot.snapshotLineCount,
    });

    invalidateAppTopics('sessions');
    res.json({ conversationId, checkpoint });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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

// ── Live sessions (Pi SDK) ────────────────────────────────────────────────────

/** List all in-process live sessions */
app.get('/api/live-sessions', (_req, res) => {
  res.json(getLiveSessions());
});

/** Create a new live session */
app.post('/api/live-sessions', async (req, res) => {
  try {
    const body = req.body as { cwd?: string; referencedProjectIds?: string[]; text?: string };
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
      defaultCwd: DEFAULT_WEB_CWD,
      referencedProjectIds,
    });
    const result = await createSession(cwd, {
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
    const result = await resumeSession(sessionFile, {
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

app.post('/api/conversations/:id/recover', async (req, res) => {
  try {
    const conversationId = req.params.id;
    if (!conversationId) {
      res.status(400).json({ error: 'conversation id required' });
      return;
    }

    if (isLive(conversationId)) {
      res.json({
        conversationId,
        live: true,
        recovered: false,
        replayedPendingOperation: false,
        usedFallbackPrompt: false,
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
    const resumed = await resumeSession(sessionFile, {
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

    if (!pendingOperation) {
      res.json({
        conversationId: resumed.id,
        live: true,
        recovered: true,
        replayedPendingOperation: false,
        usedFallbackPrompt: false,
      });
      return;
    }

    await syncWebLiveConversationRun({
      conversationId: resumed.id,
      sessionFile,
      cwd: effectiveCwd,
      title: effectiveTitle,
      profile: effectiveProfile,
      state: 'running',
      pendingOperation,
    });

    for (const message of pendingOperation.contextMessages ?? []) {
      await queuePromptContext(resumed.id, message.customType, message.content);
    }

    promptSession(
      resumed.id,
      pendingOperation.text,
      pendingOperation.behavior,
      pendingOperation.images,
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
      replayedPendingOperation: true,
      usedFallbackPrompt: false,
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
  const live = isLive(req.params.id);
  if (!live) { res.status(404).json({ live: false }); return; }
  const all = getLiveSessions();
  const entry = all.find(s => s.id === req.params.id);
  res.json({ live: true, ...entry });
});

/** SSE stream for a live session */
app.get('/api/live-sessions/:id/events', (req, res) => {
  const { id } = req.params;
  if (!isLive(id)) { res.status(404).json({ error: 'Not a live session' }); return; }

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send a heartbeat comment every 15s so the connection stays alive
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);

  const unsubscribe = subscribe(id, (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

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
    'Projects are durable cross-conversation hubs. Read the project brief and notes when you need continuity, load the pa-project-hub skill before making durable project file edits, and use the project tool only for conversation reference changes.',
  ].join('\n');
}

/** Send a prompt to a live session */
app.post('/api/live-sessions/:id/prompt', async (req, res) => {
  try {
    const { id } = req.params;
    const { text = '', behavior, images } = req.body as {
      text?: string;
      behavior?: 'steer' | 'followUp';
      images?: Array<{ type?: 'image'; data: string; mimeType: string; name?: string }>;
    };
    if (!text && (!images || images.length === 0)) {
      res.status(400).json({ error: 'text or images required' });
      return;
    }

    const currentProfile = getCurrentProfile();
    const tasks = listTasksForCurrentProfile();
    const memoryDocs = listMemoryDocsForCurrentProfile();
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
    const queuedContextBlocks = [
      relatedProjectIds.length > 0 ? buildReferencedProjectsContext(relatedProjectIds) : '',
      referencedTasks.length > 0 ? buildReferencedTasksContext(referencedTasks, REPO_ROOT) : '',
      referencedMemoryDocs.length > 0 ? buildReferencedMemoryDocsContext(referencedMemoryDocs, REPO_ROOT) : '',
      referencedSkills.length > 0 ? buildReferencedSkillsContext(referencedSkills, REPO_ROOT) : '',
      referencedProfiles.length > 0 ? buildReferencedProfilesContext(referencedProfiles, REPO_ROOT) : '',
    ].filter(Boolean);

    if (queuedContextBlocks.length > 0) {
      await queuePromptContext(id, 'referenced_context', queuedContextBlocks.join('\n\n'));
    }

    const liveEntry = liveRegistry.get(id);
    if (liveEntry?.session.sessionFile) {
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
                  content: queuedContextBlocks.join('\n\n'),
                }],
              }
            : {}),
          enqueuedAt: new Date().toISOString(),
        },
      });
    }

    // Don't await — streaming response goes over SSE
    promptSession(id, text, behavior, images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
      ...(image.name ? { name: image.name } : {}),
    }))).catch(async (err) => {
      if (liveEntry?.session.sessionFile) {
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
    await abortSession(req.params.id);
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

  // cwd: live registry first, then JSONL meta, then session list
  const liveEntry = liveRegistry.get(id);
  const detail = readSessionBlocks(id);
  const allSessions = listSessions();
  const sessionMeta = allSessions.find(s => s.id === id);
  const cwd = liveEntry?.cwd ?? detail?.meta.cwd ?? sessionMeta?.cwd;
  if (!cwd) { res.status(404).json({ error: 'Session not found' }); return; }

  const gitSummary = readGitStatusSummary(cwd);

  // User messages: prefer live in-memory messages (most up-to-date), fall back to JSONL
  let userMessages: { id: string; ts: string; text: string; imageCount: number }[] = [];
  if (liveEntry) {
    userMessages = liveEntry.session.agent.state.messages
      .filter(m => m.role === 'user')
      .slice(-5)
      .map((m, i) => {
        const { text, imageCount } = summarizeUserMessageContent(m.content);
        return { id: String(i), ts: new Date().toISOString(), text: text.slice(0, 300), imageCount };
      });
  } else {
    userMessages = (detail?.blocks ?? [])
      .filter((b) => b.type === 'user')
      .slice(-5)
      .map((b) => ({
        id: b.id,
        ts: b.ts,
        text: 'text' in b ? b.text : '',
        imageCount: 'images' in b && Array.isArray(b.images) ? b.images.length : 0,
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

app.patch('/api/conversations/:id/title', (req, res) => {
  try {
    const { name } = req.body as { name?: string };
    const nextName = name?.trim();
    if (!nextName) {
      res.status(400).json({ error: 'name required' });
      return;
    }

    const conversationId = req.params.id;
    if (isLive(conversationId)) {
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
    const liveEntry = liveRegistry.get(conversationId);
    const sessionDetail = readSessionBlocks(conversationId);
    const currentCwd = liveEntry?.cwd ?? sessionDetail?.meta.cwd;
    const sourceSessionFile = liveEntry?.session.sessionFile ?? sessionDetail?.meta.file;

    if (!currentCwd || !sourceSessionFile) {
      res.status(404).json({ error: 'Conversation not found.' });
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

    const profile = getCurrentProfile();
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
  const usage = getSessionContextUsage(req.params.id);
  if (!usage) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(usage);
});

/** Destroy / close a live session */
app.delete('/api/live-sessions/:id', (req, res) => {
  destroySession(req.params.id);
  res.json({ ok: true });
});

// ── Projects ─────────────────────────────────────────────────────────────────

function listProjectsForCurrentProfile() {
  const profile = getCurrentProfile();
  const ids = listProjectIds({ repoRoot: REPO_ROOT, profile });
  const projects = ids.flatMap((id) => {
    try {
      const paths = resolveProjectPaths({
        repoRoot: REPO_ROOT,
        profile,
        projectId: id,
      });
      return [readProject(paths.projectFile)];
    } catch {
      return [];
    }
  });

  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return projects;
}

function projectErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return /not found/i.test(message) ? 404 : 400;
}

app.get('/api/projects', (_req, res) => {
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

app.get('/api/projects/:id', (req, res) => {
  try {
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch {
    res.status(404).json({ error: 'Project not found' });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const body = req.body as {
      title?: string;
      description?: string;
      repoRoot?: string | null;
      summary?: string;
      status?: string;
      currentFocus?: string | null;
      blockers?: string[];
      recentProgress?: string[];
    };

    const detail = createProjectRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      title: body.title ?? '',
      description: body.description ?? '',
      projectRepoRoot: body.repoRoot,
      summary: body.summary,
      status: body.status,
      currentFocus: body.currentFocus,
      blockers: body.blockers,
      recentProgress: body.recentProgress,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForCurrentProfile(detail.project.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id', (req, res) => {
  try {
    const body = req.body as {
      title?: string;
      description?: string;
      repoRoot?: string | null;
      summary?: string;
      status?: string;
      currentFocus?: string | null;
      currentMilestoneId?: string | null;
      blockers?: string[];
      recentProgress?: string[];
    };

    updateProjectRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      title: body.title,
      description: body.description,
      projectRepoRoot: body.repoRoot,
      summary: body.summary,
      status: body.status,
      currentFocus: body.currentFocus,
      currentMilestoneId: body.currentMilestoneId,
      blockers: body.blockers,
      recentProgress: body.recentProgress,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    const result = deleteProjectRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
    });
    invalidateAppTopics('projects');
    res.json(result);
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/brief', (req, res) => {
  try {
    const body = req.body as { content?: string };
    saveProjectBrief({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      content: body.content ?? '',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/brief/regenerate', async (req, res) => {
  try {
    const detail = readProjectDetailForCurrentProfile(req.params.id);
    const brief = await generateProjectBrief({
      detail,
      linkedConversations: detail.linkedConversations,
      activityEntries: listActivityForCurrentProfile().filter((entry) => (entry.relatedProjectIds ?? []).includes(req.params.id)),
      settingsFile: SETTINGS_FILE,
      authFile: join(AGENT_DIR, 'auth.json'),
    });
    saveProjectBrief({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      content: brief,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/notes', (req, res) => {
  try {
    const body = req.body as { title?: string; kind?: string; body?: string };
    createProjectNoteRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      title: body.title ?? '',
      kind: body.kind ?? 'note',
      body: body.body,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id/notes/:noteId', (req, res) => {
  try {
    const body = req.body as { title?: string; kind?: string; body?: string };
    updateProjectNoteRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      noteId: req.params.noteId,
      title: body.title,
      kind: body.kind,
      body: body.body,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/notes/:noteId', (req, res) => {
  try {
    deleteProjectNoteRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      noteId: req.params.noteId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/files', (req, res) => {
  try {
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
      profile: getCurrentProfile(),
      projectId: req.params.id,
      kind: body.kind ?? 'attachment',
      name: body.name ?? '',
      mimeType: body.mimeType,
      title: body.title,
      description: body.description,
      data: body.data ?? '',
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/projects/:id/files/:kind/:fileId/download', (req, res) => {
  try {
    const download = readProjectFileDownload({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      kind: req.params.kind === 'artifact' ? 'artifact' : 'attachment',
      fileId: req.params.fileId,
    });
    if (download.file.mimeType) {
      res.type(download.file.mimeType);
    }
    res.setHeader('Content-Disposition', `attachment; filename="${download.file.originalName.replace(/"/g, '')}"`);
    res.sendFile(download.filePath);
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/files/:kind/:fileId', (req, res) => {
  try {
    deleteProjectFileRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      kind: req.params.kind === 'artifact' ? 'artifact' : 'attachment',
      fileId: req.params.fileId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/milestones', (req, res) => {
  try {
    const body = req.body as {
      title?: string;
      status?: string;
      summary?: string;
      makeCurrent?: boolean;
    };

    addProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      title: body.title ?? '',
      status: body.status ?? '',
      summary: body.summary,
      makeCurrent: body.makeCurrent,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id/milestones/:milestoneId', (req, res) => {
  try {
    const body = req.body as {
      title?: string;
      status?: string;
      summary?: string | null;
      makeCurrent?: boolean;
    };

    updateProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
      title: body.title,
      status: body.status,
      summary: body.summary,
      makeCurrent: body.makeCurrent,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/tasks', (req, res) => {
  try {
    const body = req.body as {
      title?: string;
      status?: string;
      milestoneId?: string | null;
    };

    createProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      title: body.title ?? '',
      status: body.status ?? '',
      milestoneId: body.milestoneId,
    });
    invalidateAppTopics('projects');
    res.status(201).json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.patch('/api/projects/:id/tasks/:taskId', (req, res) => {
  try {
    const body = req.body as {
      title?: string;
      status?: string;
      milestoneId?: string | null;
    };

    updateProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      taskId: req.params.taskId,
      title: body.title,
      status: body.status,
      milestoneId: body.milestoneId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/milestones/:milestoneId', (req, res) => {
  try {
    deleteProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/milestones/:milestoneId/move', (req, res) => {
  try {
    const body = req.body as { direction?: 'up' | 'down' };

    moveProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
      direction: body.direction ?? 'up',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/tasks/:taskId', (req, res) => {
  try {
    deleteProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      taskId: req.params.taskId,
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/tasks/:taskId/move', (req, res) => {
  try {
    const body = req.body as { direction?: 'up' | 'down' };

    moveProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      taskId: req.params.taskId,
      direction: body.direction ?? 'up',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/projects/:id/source', (req, res) => {
  try {
    res.json(readProjectSource({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/source', (req, res) => {
  try {
    const body = req.body as { content?: string };
    saveProjectSource({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      content: body.content ?? '',
    });
    invalidateAppTopics('projects');
    res.json(readProjectDetailForCurrentProfile(req.params.id));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ── Shell run ─────────────────────────────────────────────────────────────────

app.post('/api/folder-picker', (req, res) => {
  try {
    const { cwd } = req.body as { cwd?: string };
    const result = pickFolder({
      initialDirectory: resolveRequestedCwd(cwd, DEFAULT_WEB_CWD) ?? DEFAULT_WEB_CWD,
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

app.post('/api/run', (req, res) => {
  try {
    const { command, cwd: runCwd } = req.body as { command: string; cwd?: string };
    if (!command) { res.status(400).json({ error: 'command required' }); return; }
    const resolvedRunCwd = resolveRequestedCwd(runCwd, DEFAULT_WEB_CWD) ?? DEFAULT_WEB_CWD;
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
  updated?: string;
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

function listMemoryDocsForCurrentProfile(): MemoryDocItem[] {
  const profile = getCurrentProfile();
  const memoryDocs: MemoryDocItem[] = [];
  const memDir = join(REPO_ROOT, `profiles/${profile}/agent/memory`);
  if (!existsSync(memDir)) {
    return memoryDocs;
  }

  for (const file of readdirSync(memDir).filter((name) => name.endsWith('.md'))) {
    const filePath = join(memDir, file);
    const fm = parseFrontmatter(filePath);
    const id = file.replace(/\.md$/, '');
    const tags = fm.tags;

    memoryDocs.push({
      id: String(fm.id ?? id),
      title: String(fm.title ?? id),
      summary: String(fm.summary ?? ''),
      tags: Array.isArray(tags) ? tags.map(String) : typeof tags === 'string' ? [tags] : [],
      path: filePath,
      type: typeof fm.type === 'string' ? fm.type : undefined,
      status: typeof fm.status === 'string' ? fm.status : undefined,
      updated: typeof fm.updated === 'string' ? fm.updated : undefined,
      recentSessionCount: 0,
      lastUsedAt: null,
      usedInLastSession: false,
    });
  }

  return memoryDocs;
}

function listSkillsForCurrentProfile(): SkillItem[] {
  const profile = getCurrentProfile();
  const skills: SkillItem[] = [];
  const skillSources = profile === 'shared' ? ['shared'] : ['shared', profile];

  for (const src of skillSources) {
    const dir = join(REPO_ROOT, `profiles/${src}/agent/skills`);
    if (!existsSync(dir)) {
      continue;
    }

    for (const name of readdirSync(dir)) {
      const skillMd = join(dir, name, 'SKILL.md');
      if (!existsSync(skillMd)) {
        continue;
      }

      const fm = parseFrontmatter(skillMd);
      skills.push({
        source: src,
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

function listProfileAgentItems(): AgentsItem[] {
  const items: AgentsItem[] = [];

  for (const profile of listAvailableProfiles()) {
    const filePath = join(REPO_ROOT, `profiles/${profile}/agent/AGENTS.md`);
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

app.get('/api/memory', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const sharedPath  = join(REPO_ROOT, 'profiles/shared/agent/AGENTS.md');
    const profilePath = join(REPO_ROOT, `profiles/${profile}/agent/AGENTS.md`);
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

    const skills = listSkillsForCurrentProfile();
    const memoryDocs = listMemoryDocsForCurrentProfile();

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
    logError('request handler error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/memory/file', (req, res) => {
  try {
    const filePath = req.query.path as string;
    if (!filePath) { res.status(400).json({ error: 'path required' }); return; }
    if (!filePath.startsWith(REPO_ROOT) || !filePath.endsWith('.md')) {
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
    if (!filePath.startsWith(REPO_ROOT) || !filePath.endsWith('.md')) {
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
    cwd: DEFAULT_WEB_CWD,
    dist: DIST_DIR,
  });
});
