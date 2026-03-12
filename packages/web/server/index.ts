import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listSessions, readSessionBlocks } from './sessions.js';
import { invalidateAppTopics, startAppEventMonitor, subscribeAppEvents, type AppEventTopic } from './appEvents.js';
import { resolveConversationCwd, resolveRequestedCwd } from './conversationCwd.js';
import { readGitStatusSummary } from './gitStatus.js';
import {
  installGatewayAndReadState,
  readGatewayState,
  restartGatewayAndReadState,
  startGatewayAndReadState,
  stopGatewayAndReadState,
  uninstallGatewayAndReadState,
} from './gateway.js';
import {
  installDaemonServiceAndReadState,
  readDaemonState,
  restartDaemonServiceAndReadState,
  startDaemonServiceAndReadState,
  stopDaemonServiceAndReadState,
  uninstallDaemonServiceAndReadState,
} from './daemon.js';
import { readSavedModelPreferences, writeSavedModelPreferences } from './modelPreferences.js';
import { readSavedThemePreferences, writeSavedThemePreferences, type ThemeMode } from './themePreferences.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from './webUiPreferences.js';
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
import {
  createSession,
  resumeSession,
  getLiveSessions,
  getSessionStats,
  getSessionContextUsage,
  getAvailableModels,
  isLive,
  subscribe,
  promptSession,
  queuePromptContext,
  compactSession,
  reloadSessionResources,
  exportSessionHtml,
  renameSession,
  abortSession,
  destroySession,
  forkSession,
  registry as liveRegistry,
} from './liveSessions.js';
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
  ensureConversationAttentionBaselines,
  getActivityConversationLink,
  getConversationProjectLink,
  listProfileActivityEntries,
  listProjectIds,
  loadProfileActivityReadState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  readProject,
  removeConversationProjectLink,
  resolveProjectPaths,
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
} from './projects.js';

const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const DEFAULT_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? DEFAULT_REPO_ROOT;
const DEFAULT_WEB_CWD = process.cwd();
const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const SESSIONS_DIR = join(AGENT_DIR, 'sessions');
const TASK_STATE_FILE = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
const PROFILE_CONFIG_FILE = getProfileConfigFilePath();

function listAvailableProfiles(): string[] {
  return listProfiles({ repoRoot: REPO_ROOT });
}

function materializeWebProfile(profile: string): void {
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
    await syncDaemonTaskScopeToProfile({
      profile,
      repoRoot: REPO_ROOT,
    });
  } catch (error) {
    console.warn(`[web] failed to sync daemon task scope for ${profile}: ${(error as Error).message}`);
  }
}

try {
  materializeWebProfile(currentProfile);
} catch (error) {
  console.warn(`[web] failed to materialize initial profile ${currentProfile}: ${(error as Error).message}`);
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
  ];
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

startAppEventMonitor({
  repoRoot: REPO_ROOT,
  sessionsDir: SESSIONS_DIR,
  taskStateFile: TASK_STATE_FILE,
  getCurrentProfile,
});

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
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Gateway ──────────────────────────────────────────────────────────────────

app.get('/api/gateway', (_req, res) => {
  try {
    res.json(readGatewayState(getCurrentProfile()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/restart', (_req, res) => {
  try {
    res.json(restartGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/install', (_req, res) => {
  try {
    res.json(installGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/start', (_req, res) => {
  try {
    res.json(startGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/stop', (_req, res) => {
  try {
    res.json(stopGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/gateway/service/uninstall', (_req, res) => {
  try {
    res.json(uninstallGatewayAndReadState(getCurrentProfile()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Daemon ───────────────────────────────────────────────────────────────────

app.get('/api/daemon', async (_req, res) => {
  try {
    res.json(await readDaemonState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/install', async (_req, res) => {
  try {
    res.json(await installDaemonServiceAndReadState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/start', async (_req, res) => {
  try {
    res.json(await startDaemonServiceAndReadState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/restart', async (_req, res) => {
  try {
    res.json(await restartDaemonServiceAndReadState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/stop', async (_req, res) => {
  try {
    res.json(await stopDaemonServiceAndReadState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/daemon/service/uninstall', async (_req, res) => {
  try {
    res.json(await uninstallDaemonServiceAndReadState());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Activity ─────────────────────────────────────────────────────────────────

app.get('/api/activity', (_req, res) => {
  try {
    res.json(listActivityForCurrentProfile());
  } catch (err) {
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
  { id: 'gpt-4o',             provider: 'openai',       name: 'GPT-4o',              context: 128_000 },
  // Google
  { id: 'gemini-2.5-pro',     provider: 'google',       name: 'Gemini 2.5 Pro',      context: 1_000_000 },
  { id: 'gemini-3.1-pro-high',provider: 'google',       name: 'Gemini 3.1 Pro High', context: 1_000_000 },
];

const SETTINGS_FILE = join(homedir(), '.local/state/personal-agent/pi-agent/settings.json');

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

    writeSavedModelPreferences({ model, thinkingLevel }, SETTINGS_FILE, listAvailableModelDefinitions());
    res.json({ ok: true });
  } catch (err) {
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

    writeSavedThemePreferences({ themeMode, themeDark, themeLight }, SETTINGS_FILE);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/web-ui/open-conversations', (_req, res) => {
  try {
    const saved = readSavedWebUiPreferences(SETTINGS_FILE);
    res.json({ sessionIds: saved.openConversationIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/web-ui/open-conversations', (req, res) => {
  try {
    const { sessionIds } = req.body as { sessionIds?: string[] };
    if (!Array.isArray(sessionIds)) {
      res.status(400).json({ error: 'sessionIds array required' });
      return;
    }

    const saved = writeSavedWebUiPreferences({ openConversationIds: sessionIds }, SETTINGS_FILE);
    res.json({ ok: true, sessionIds: saved.openConversationIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/api/tasks', (_req, res) => {
  try {
    res.json(listTasksForCurrentProfile());
  } catch (err) {
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
    res.status(500).json({ error: String(err) });
  }
});

/** Run a task immediately — creates a live session with the task's prompt */
app.post('/api/tasks/:id/run', async (req, res) => {
  try {
    const entry = findCurrentProfileTaskEntry(req.params.id);
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    const metadata = readScheduledTaskFileMetadata(entry.filePath);
    const fileContent = metadata.fileContent;
    const afterFrontmatter = fileContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    if (!afterFrontmatter) { res.status(400).json({ error: 'Task has no prompt body' }); return; }

    const { id: sessionId } = await createSession(
      resolveRequestedCwd(metadata.cwd, DEFAULT_WEB_CWD) ?? DEFAULT_WEB_CWD,
      {
        extensionFactories: buildLiveSessionExtensionFactories(),
      },
    );
    void promptSession(sessionId, afterFrontmatter);
    res.json({ ok: true, sessionId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Sessions (read-only JSONL) ────────────────────────────────────────────────

app.get('/api/sessions', (_req, res) => {
  try {
    res.json(decorateSessionsWithAttention(getCurrentProfile(), listSessions()));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sessions/:id', (req, res) => {
  try {
    const result = readSessionBlocks(req.params.id);
    if (!result) { res.status(404).json({ error: 'Session not found' }); return; }
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
    const cwd = resolveConversationCwd({
      repoRoot: REPO_ROOT,
      profile,
      explicitCwd: body.cwd,
      defaultCwd: DEFAULT_WEB_CWD,
      referencedProjectIds: body.referencedProjectIds && body.referencedProjectIds.length > 0
        ? body.referencedProjectIds
        : inferredReferencedProjectIds,
    });
    const result = await createSession(cwd, {
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Resume an existing session file into a live session */
app.post('/api/live-sessions/resume', async (req, res) => {
  try {
    const { sessionFile } = req.body as { sessionFile: string };
    if (!sessionFile) { res.status(400).json({ error: 'sessionFile required' }); return; }
    const result = await resumeSession(sessionFile, {
      extensionFactories: buildLiveSessionExtensionFactories(),
    });
    res.json(result);
  } catch (err) {
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
      const project = readProject(paths.projectFile);
      if (project.repoRoot) {
        lineParts.push(`  repoRoot: ${project.repoRoot}`);
      }
    } catch {
      // Ignore malformed project metadata in the lightweight reference summary.
    }

    return lineParts.join('\n');
  });

  return [
    'Referenced projects for this conversation:',
    ...lines,
    'These are durable project files. Read and update them when the user asks you to track or change project state.',
  ].join('\n');
}

/** Send a prompt to a live session */
app.post('/api/live-sessions/:id/prompt', async (req, res) => {
  try {
    const { id } = req.params;
    const { text = '', behavior, images } = req.body as {
      text?: string;
      behavior?: 'steer' | 'followUp';
      images?: Array<{ type?: 'image'; data: string; mimeType: string }>;
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

    // Don't await — streaming response goes over SSE
    promptSession(id, text, behavior, images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
    }))).catch(err => {
      console.error(`[live] prompt error for ${id}:`, err);
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
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/compact', async (req, res) => {
  try {
    const { customInstructions } = req.body as { customInstructions?: string };
    const result = await compactSession(req.params.id, customInstructions?.trim() || undefined);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/reload', async (req, res) => {
  try {
    await reloadSessionResources(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/export', async (req, res) => {
  try {
    const { outputPath } = req.body as { outputPath?: string };
    const path = await exportSessionHtml(req.params.id, outputPath?.trim() || undefined);
    res.json({ ok: true, path });
  } catch (err) {
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
    res.status(500).json({ error: String(err) });
  }
});

/** Abort a running agent */
app.post('/api/live-sessions/:id/abort', async (req, res) => {
  try {
    await abortSession(req.params.id);
    res.json({ ok: true });
  } catch (err) {
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

app.get('/api/conversations/:id/projects', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const relatedProjectIds = getConversationProjectLink({
      profile,
      conversationId: req.params.id,
    })?.relatedProjectIds ?? [];
    res.json({ conversationId: req.params.id, relatedProjectIds });
  } catch (err) {
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

    res.json({ conversationId: req.params.id, relatedProjectIds: document.relatedProjectIds });
  } catch (err) {
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

    res.json({ conversationId: req.params.id, relatedProjectIds: document.relatedProjectIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
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
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/live-sessions/:id/fork-entries', (req, res) => {
  const liveEntry = liveRegistry.get(req.params.id);
  if (!liveEntry) { res.status(404).json({ error: 'Session not live' }); return; }
  try {
    res.json(liveEntry.session.getUserMessagesForForking());
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/live-sessions/:id/fork', async (req, res) => {
  try {
    const { entryId, preserveSource } = req.body as { entryId: string; preserveSource?: boolean };
    if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
    res.json(await forkSession(req.params.id, entryId, {
      preserveSource,
      extensionFactories: buildLiveSessionExtensionFactories(),
    }));
  } catch (err) {
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
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    res.json(readProjectDetailFromProject({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
    }));
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

    res.status(201).json(createProjectRecord({
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
    }));
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

    res.json(updateProjectRecord({
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
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id', (req, res) => {
  try {
    res.json(deleteProjectRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
    }));
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

    res.status(201).json(addProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      title: body.title ?? '',
      status: body.status ?? '',
      summary: body.summary,
      makeCurrent: body.makeCurrent,
    }));
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

    res.json(updateProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
      title: body.title,
      status: body.status,
      summary: body.summary,
      makeCurrent: body.makeCurrent,
    }));
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

    res.status(201).json(createProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      title: body.title ?? '',
      status: body.status ?? '',
      milestoneId: body.milestoneId,
    }));
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

    res.json(updateProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      taskId: req.params.taskId,
      title: body.title,
      status: body.status,
      milestoneId: body.milestoneId,
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/milestones/:milestoneId', (req, res) => {
  try {
    res.json(deleteProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/milestones/:milestoneId/move', (req, res) => {
  try {
    const body = req.body as { direction?: 'up' | 'down' };

    res.json(moveProjectMilestone({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      milestoneId: req.params.milestoneId,
      direction: body.direction ?? 'up',
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete('/api/projects/:id/tasks/:taskId', (req, res) => {
  try {
    res.json(deleteProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      taskId: req.params.taskId,
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/projects/:id/tasks/:taskId/move', (req, res) => {
  try {
    const body = req.body as { direction?: 'up' | 'down' };

    res.json(moveProjectTaskRecord({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      taskId: req.params.taskId,
      direction: body.direction ?? 'up',
    }));
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
    res.json(saveProjectSource({
      repoRoot: REPO_ROOT,
      profile: getCurrentProfile(),
      projectId: req.params.id,
      content: body.content ?? '',
    }));
  } catch (error) {
    res.status(projectErrorStatus(error)).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// ── Shell run ─────────────────────────────────────────────────────────────────

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
  console.log(`\n  personal-agent web UI`);
  console.log(`  → http://localhost:${PORT}\n`);
  console.log(`  profile : ${getCurrentProfile()}`);
  console.log(`  repo    : ${REPO_ROOT}`);
  console.log(`  cwd     : ${DEFAULT_WEB_CWD}`);
  console.log(`  dist    : ${DIST_DIR}`);
  console.log();
});
