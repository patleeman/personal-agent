import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listSessions, readSessionBlocks } from './sessions.js';
import { readSavedModelPreferences } from './modelPreferences.js';
import {
  getProfileConfigFilePath,
  readSavedProfilePreferences,
  resolveActiveProfile,
  writeSavedProfilePreferences,
} from './profilePreferences.js';
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
  addConversationWorkstreamLink,
  createProjectScaffold,
  createProjectTask,
  createProjectTaskSummary,
  getConversationWorkstreamLink,
  listProfileActivityEntries,
  listProjectIds,
  listProjectTaskIds,
  listWorkstreamIds,
  readProjectDocument,
  readProjectPlan,
  readProjectTask,
  readProjectTaskSummary,
  readWorkstreamPlan,
  readWorkstreamSummary,
  removeConversationWorkstreamLink,
  resolveProjectPaths,
  resolveProjectTaskFilePath,
  resolveProjectTaskSummaryFilePath,
  resolveWorkstreamPaths,
  writeProjectDocument,
  writeProjectPlan,
  writeProjectTask,
  writeProjectTaskSummary,
} from '@personal-agent/core';
import {
  listProfiles,
  materializeProfileToAgentDir,
  resolveResourceProfile,
} from '@personal-agent/resources';

const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
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

try {
  materializeWebProfile(currentProfile);
} catch (error) {
  console.warn(`[web] failed to materialize initial profile ${currentProfile}: ${(error as Error).message}`);
}

function getCurrentProfile(): string {
  return currentProfile;
}

function setCurrentProfile(profile: string): string {
  const availableProfiles = listAvailableProfiles();
  if (!availableProfiles.includes(profile)) {
    throw new Error(`Unknown profile: ${profile}`);
  }

  materializeWebProfile(profile);
  currentProfile = profile;
  writeSavedProfilePreferences(profile, PROFILE_CONFIG_FILE);
  return currentProfile;
}

// ── Activity read-state ───────────────────────────────────────────────────────
// Stored as a simple JSON set alongside activity files.
function resolveReadStateFile(profile = getCurrentProfile()): string {
  return join(REPO_ROOT, `profiles/${profile}/agent/activity/.read-state.json`);
}

function loadReadState(profile = getCurrentProfile()): Set<string> {
  try { return new Set(JSON.parse(readFileSync(resolveReadStateFile(profile), 'utf-8')) as string[]); } catch { return new Set(); }
}
function saveReadState(ids: Set<string>, profile = getCurrentProfile()) {
  try {
    const readStateFile = resolveReadStateFile(profile);
    mkdirSync(dirname(readStateFile), { recursive: true });
    writeFileSync(readStateFile, JSON.stringify([...ids]));
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

const DIST_DIR =
  process.env.PA_WEB_DIST ??
  join(dirname(fileURLToPath(import.meta.url)), '../dist');

const app = express();
app.use(express.json({ limit: '25mb' }));

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

app.patch('/api/profiles/current', (req, res) => {
  try {
    const { profile } = req.body as { profile?: string };
    if (!profile) { res.status(400).json({ error: 'profile required' }); return; }
    res.json({ ok: true, currentProfile: setCurrentProfile(profile) });
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
    const workstreamIds = listWorkstreamIds({ repoRoot: REPO_ROOT, profile });
    res.json({
      profile,
      repoRoot: REPO_ROOT,
      activityCount: activities.length,
      workstreamCount: workstreamIds.length,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Activity ─────────────────────────────────────────────────────────────────

app.get('/api/activity', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile });
    const read = loadReadState(profile);
    res.json(entries.map(({ entry }) => ({ ...entry, read: read.has(entry.id) })));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/activity/count', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile });
    const read = loadReadState(profile);
    const unread = entries.filter(({ entry }) => !read.has(entry.id)).length;
    res.json({ count: unread });
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
    res.json({ ...match.entry, read: read.has(match.entry.id) });
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

app.get('/api/models', (_req, res) => {
  try {
    const saved = readSavedModelPreferences(SETTINGS_FILE);
    let currentModel = saved.currentModel;
    const currentThinkingLevel = saved.currentThinkingLevel;
    // Live model list from SDK registry (available = have auth configured)
    let models = BUILT_IN_MODELS;
    try {
      const live = getAvailableModels();
      if (live.length > 0) models = live;
    } catch { /* fall back to built-in list */ }
    if (!currentModel && models.length > 0) currentModel = models[0].id;
    res.json({ currentModel, currentThinkingLevel, models });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/models/current', (req, res) => {
  try {
    const { model } = req.body as { model: string };
    if (!model) { res.status(400).json({ error: 'model required' }); return; }
    let settings: Record<string, unknown> = {};
    if (existsSync(SETTINGS_FILE)) {
      settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8')) as Record<string, unknown>;
    }
    settings.defaultModel = model;
    writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/api/tasks', (_req, res) => {
  try {
    const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
    let taskState: Record<string, unknown> = {};
    if (existsSync(stateFile)) {
      taskState = JSON.parse(readFileSync(stateFile, 'utf-8')) as Record<string, unknown>;
    }
    const tasks = (taskState as { tasks?: Record<string, unknown> }).tasks ?? {};

    // Parse task markdown files to get schedule + prompt
    const enriched = Object.values(tasks).map((t) => {
      const task = t as {
        id: string; filePath: string; scheduleType: string; running: boolean;
        lastStatus?: string; lastRunAt?: string; lastSuccessAt?: string;
        lastScheduledMinute?: string; lastAttemptCount?: number; lastLogPath?: string;
      };
      let enabled = true; let cron: string | undefined; let prompt = ''; let model: string | undefined;
      try {
        const md = readFileSync(task.filePath, 'utf-8');
        const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          if (/enabled:\s*false/.test(fm)) enabled = false;
          cron  = fm.match(/cron:\s*"?([^"\n]+)"?/)?.[1]?.trim();
          model = fm.match(/model:\s*"?([^"\n]+)"?/)?.[1]?.trim();
        }
        prompt = md.replace(/^---[\s\S]*?---\n?/, '').trim().split('\n')[0].slice(0, 120);
      } catch { /* ignore */ }
      return { ...task, enabled, cron, prompt, model };
    });

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/tasks/:id', (req, res) => {
  try {
    const { enabled } = req.body as { enabled: boolean };
    const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
    if (!existsSync(stateFile)) { res.status(404).json({ error: 'No task state' }); return; }
    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as { tasks?: Record<string, unknown> };
    const entry = Object.values(state.tasks ?? {}).find(
      t => (t as { id: string }).id === req.params.id
    ) as { id: string; filePath: string } | undefined;
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    let content = readFileSync(entry.filePath, 'utf-8');
    if (/enabled:\s*(true|false)/.test(content)) {
      content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
    } else {
      // Inject into frontmatter after opening ---
      content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
    }
    writeFileSync(entry.filePath, content, 'utf-8');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/tasks/:id/log', (req, res) => {
  try {
    const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
    if (!existsSync(stateFile)) { res.status(404).json({ error: 'No task state' }); return; }
    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as { tasks?: Record<string, unknown> };
    const entry = Object.values(state.tasks ?? {}).find(
      t => (t as { id: string }).id === req.params.id
    ) as { id: string; lastLogPath?: string } | undefined;
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
    const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
    if (!existsSync(stateFile)) { res.status(404).json({ error: 'No task state' }); return; }
    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as { tasks?: Record<string, unknown> };
    const entry = Object.values(state.tasks ?? {}).find(
      (t) => (t as { id: string }).id === req.params.id
    ) as { id: string; filePath: string; running: boolean; lastStatus?: string; lastRunAt?: string; lastLogPath?: string } | undefined;
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    let fileContent = '';
    let enabled = true; let cron: string | undefined; let model: string | undefined;
    try {
      fileContent = readFileSync(entry.filePath, 'utf-8');
      const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const fm = fmMatch[1];
        if (/enabled:\s*false/.test(fm)) enabled = false;
        cron  = fm.match(/cron:\s*"?([^"\n]+)"?/)?.[1]?.trim();
        model = fm.match(/model:\s*"?([^"\n]+)"?/)?.[1]?.trim();
      }
    } catch { /* ignore */ }

    res.json({ ...entry, enabled, cron, model, fileContent });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** Run a task immediately — creates a live session with the task's prompt */
app.post('/api/tasks/:id/run', async (req, res) => {
  try {
    const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
    if (!existsSync(stateFile)) { res.status(404).json({ error: 'No task state' }); return; }
    const state = JSON.parse(readFileSync(stateFile, 'utf-8')) as { tasks?: Record<string, unknown> };
    const entry = Object.values(state.tasks ?? {}).find(
      (t) => (t as { id: string }).id === req.params.id
    ) as { id: string; filePath: string } | undefined;
    if (!entry) { res.status(404).json({ error: 'Task not found' }); return; }

    // Parse prompt from file (body after frontmatter)
    const fileContent = readFileSync(entry.filePath, 'utf-8');
    const afterFm = fileContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    if (!afterFm) { res.status(400).json({ error: 'Task has no prompt body' }); return; }

    const { id: sessionId } = await createSession(REPO_ROOT);
    // Send prompt asynchronously — don't block the response
    void promptSession(sessionId, afterFm);
    res.json({ ok: true, sessionId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Sessions (read-only JSONL) ────────────────────────────────────────────────

app.get('/api/sessions', (_req, res) => {
  try {
    res.json(listSessions());
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
    const cwd = (req.body as { cwd?: string }).cwd ?? REPO_ROOT;
    const result = await createSession(cwd);
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
    const result = await resumeSession(sessionFile);
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
    // Don't await — streaming response goes over SSE
    promptSession(id, text, behavior, images?.map((image) => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType,
    }))).catch(err => {
      console.error(`[live] prompt error for ${id}:`, err);
    });
    res.json({ ok: true });
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

  // Git branch
  let branch: string | null = null;
  try {
    branch = execSync('git branch --show-current', { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
      .toString().trim() || null;
  } catch { /* not a git repo */ }

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

  const relatedWorkstreamIds = getConversationWorkstreamLink({
    repoRoot: REPO_ROOT,
    profile: getCurrentProfile(),
    conversationId: id,
  })?.relatedWorkstreamIds ?? [];

  res.json({ cwd, branch, userMessages, relatedWorkstreamIds });
});

app.get('/api/conversations/:id/workstreams', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const relatedWorkstreamIds = getConversationWorkstreamLink({
      repoRoot: REPO_ROOT,
      profile,
      conversationId: req.params.id,
    })?.relatedWorkstreamIds ?? [];
    res.json({ conversationId: req.params.id, relatedWorkstreamIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/conversations/:id/workstreams', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const { workstreamId } = req.body as { workstreamId?: string };
    if (!workstreamId) { res.status(400).json({ error: 'workstreamId required' }); return; }

    const document = addConversationWorkstreamLink({
      repoRoot: REPO_ROOT,
      profile,
      conversationId: req.params.id,
      workstreamId,
    });

    res.json({ conversationId: req.params.id, relatedWorkstreamIds: document.relatedWorkstreamIds });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.delete('/api/conversations/:id/workstreams/:workstreamId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const document = removeConversationWorkstreamLink({
      repoRoot: REPO_ROOT,
      profile,
      conversationId: req.params.id,
      workstreamId: req.params.workstreamId,
    });

    res.json({ conversationId: req.params.id, relatedWorkstreamIds: document.relatedWorkstreamIds });
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
    const { entryId } = req.body as { entryId: string };
    if (!entryId) { res.status(400).json({ error: 'entryId required' }); return; }
    res.json(await forkSession(req.params.id, entryId));
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

function normalizeStringList(input: unknown): string[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const values = input
    .map((value) => String(value ?? '').trim())
    .filter((value) => value.length > 0);

  return values.length > 0 ? values : [];
}

function slugifyId(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return slug.length > 0 ? slug : fallback;
}

function allocateProjectId(projectsDir: string, title: string): string {
  const base = slugifyId(title, 'project');
  let candidate = base;
  let counter = 2;

  while (existsSync(join(projectsDir, candidate))) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

function allocateProjectTaskId(tasksDir: string, title: string): string {
  const base = slugifyId(title, 'task');
  let candidate = base;
  let counter = 2;

  while (existsSync(join(tasksDir, `${candidate}.md`)) || existsSync(join(tasksDir, `${candidate}.summary.md`))) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }

  return candidate;
}

// ── Projects ─────────────────────────────────────────────────────────────────

app.get('/api/projects', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const ids = listProjectIds({ repoRoot: REPO_ROOT, profile });
    const projects = ids.flatMap((id) => {
      try {
        const paths = resolveProjectPaths({
          repoRoot: REPO_ROOT,
          profile,
          projectId: id,
        });
        return [readProjectDocument(paths.projectFile)];
      } catch {
        return [];
      }
    });

    projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/projects', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const body = req.body as { title?: string; objective?: string; projectId?: string };
    const title = String(body.title ?? '').trim();
    const objective = String(body.objective ?? '').trim();
    if (!title || !objective) {
      res.status(400).json({ error: 'title and objective are required' });
      return;
    }

    const projectsDir = resolveProjectPaths({
      repoRoot: REPO_ROOT,
      profile,
      projectId: 'placeholder',
    }).projectsDir;
    const projectId = body.projectId?.trim() || allocateProjectId(projectsDir, title);

    const result = createProjectScaffold({
      repoRoot: REPO_ROOT,
      profile,
      projectId,
      title,
      objective,
    });
    const project = readProjectDocument(result.paths.projectFile);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/projects/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const paths = resolveProjectPaths({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
    });
    const project = readProjectDocument(paths.projectFile);
    const plan = readProjectPlan(paths.planFile);
    const taskIds = listProjectTaskIds({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
    });
    const tasks = taskIds.map((taskId) => {
      const task = readProjectTask(resolveProjectTaskFilePath({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        taskId,
      }));
      const summaryPath = resolveProjectTaskSummaryFilePath({
        repoRoot: REPO_ROOT,
        profile,
        projectId: req.params.id,
        taskId,
      });

      return {
        ...task,
        summary: existsSync(summaryPath) ? readProjectTaskSummary(summaryPath) : undefined,
      };
    });

    const artifactCount = existsSync(paths.artifactsDir)
      ? readdirSync(paths.artifactsDir).filter((f) => f.endsWith('.md')).length
      : 0;

    res.json({ id: req.params.id, project, plan, tasks, artifactCount });
  } catch {
    res.status(404).json({ error: 'Project not found' });
  }
});

app.patch('/api/projects/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const paths = resolveProjectPaths({ repoRoot: REPO_ROOT, profile, projectId: req.params.id });
    const project = readProjectDocument(paths.projectFile);
    const body = req.body as {
      title?: string;
      status?: string;
      objective?: string;
      currentStatus?: string;
      blockers?: string;
      nextActions?: string;
      relatedConversationIds?: string[];
    };

    if (body.title !== undefined) project.title = String(body.title).trim();
    if (body.status !== undefined) project.status = String(body.status).trim();
    if (body.objective !== undefined) project.objective = String(body.objective).trim();
    if (body.currentStatus !== undefined) project.currentStatus = String(body.currentStatus).trim();
    if (body.blockers !== undefined) {
      const next = String(body.blockers).trim();
      project.blockers = next.length > 0 ? next : undefined;
    }
    if (body.nextActions !== undefined) {
      const next = String(body.nextActions).trim();
      project.nextActions = next.length > 0 ? next : undefined;
    }
    if (body.relatedConversationIds !== undefined) project.relatedConversationIds = normalizeStringList(body.relatedConversationIds);
    project.updatedAt = new Date().toISOString();

    if (!project.title || !project.objective || !project.currentStatus) {
      res.status(400).json({ error: 'title, objective, and currentStatus must not be empty' });
      return;
    }

    writeProjectDocument(paths.projectFile, project);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/projects/:id/plan', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const paths = resolveProjectPaths({ repoRoot: REPO_ROOT, profile, projectId: req.params.id });
    const plan = readProjectPlan(paths.planFile);
    const body = req.body as {
      objective?: string;
      steps?: Array<{ text: string; completed: boolean }>;
    };

    if (body.objective !== undefined) {
      plan.objective = String(body.objective).trim();
    }

    if (body.steps !== undefined) {
      const steps = Array.isArray(body.steps)
        ? body.steps
          .map((step) => ({ text: String(step?.text ?? '').trim(), completed: Boolean(step?.completed) }))
          .filter((step) => step.text.length > 0)
        : [];

      if (steps.length === 0) {
        res.status(400).json({ error: 'plan must include at least one step' });
        return;
      }

      plan.steps = steps;
    }

    if (!plan.objective) {
      res.status(400).json({ error: 'objective must not be empty' });
      return;
    }

    plan.updatedAt = new Date().toISOString();
    writeProjectPlan(paths.planFile, plan);
    res.json(plan);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/projects/:id/tasks', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const paths = resolveProjectPaths({ repoRoot: REPO_ROOT, profile, projectId: req.params.id });
    const body = req.body as {
      title?: string;
      objective?: string;
      status?: string;
      acceptanceCriteria?: string[];
      dependencies?: string[];
      notes?: string;
      relatedConversationIds?: string[];
    };

    const title = String(body.title ?? '').trim();
    const objective = String(body.objective ?? '').trim();
    if (!title || !objective) {
      res.status(400).json({ error: 'title and objective are required' });
      return;
    }

    const taskId = allocateProjectTaskId(paths.tasksDir, title);
    const now = new Date().toISOString();
    const task = createProjectTask({
      id: taskId,
      createdAt: now,
      updatedAt: now,
      status: body.status,
      title,
      objective,
      acceptanceCriteria: normalizeStringList(body.acceptanceCriteria),
      dependencies: normalizeStringList(body.dependencies),
      notes: body.notes ? String(body.notes) : undefined,
      relatedConversationIds: normalizeStringList(body.relatedConversationIds),
    });

    writeProjectTask(resolveProjectTaskFilePath({ repoRoot: REPO_ROOT, profile, projectId: req.params.id, taskId }), task);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/projects/:id/tasks/:taskId', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const taskPath = resolveProjectTaskFilePath({ repoRoot: REPO_ROOT, profile, projectId: req.params.id, taskId: req.params.taskId });
    const task = readProjectTask(taskPath);
    const body = req.body as {
      title?: string;
      objective?: string;
      status?: string;
      acceptanceCriteria?: string[];
      dependencies?: string[];
      notes?: string;
      relatedConversationIds?: string[];
    };

    if (body.title !== undefined) task.title = String(body.title).trim();
    if (body.objective !== undefined) task.objective = String(body.objective).trim();
    if (body.status !== undefined) task.status = String(body.status).trim();
    if (body.acceptanceCriteria !== undefined) task.acceptanceCriteria = normalizeStringList(body.acceptanceCriteria);
    if (body.dependencies !== undefined) task.dependencies = normalizeStringList(body.dependencies);
    if (body.notes !== undefined) {
      const next = String(body.notes).trim();
      task.notes = next.length > 0 ? next : undefined;
    }
    if (body.relatedConversationIds !== undefined) task.relatedConversationIds = normalizeStringList(body.relatedConversationIds);
    task.updatedAt = new Date().toISOString();

    if (!task.title || !task.objective) {
      res.status(400).json({ error: 'title and objective must not be empty' });
      return;
    }

    writeProjectTask(taskPath, task);
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.patch('/api/projects/:id/tasks/:taskId/summary', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const summaryPath = resolveProjectTaskSummaryFilePath({
      repoRoot: REPO_ROOT,
      profile,
      projectId: req.params.id,
      taskId: req.params.taskId,
    });
    const existing = existsSync(summaryPath) ? readProjectTaskSummary(summaryPath) : undefined;
    const body = req.body as {
      outcome?: string;
      summary?: string;
      criteriaValidation?: Array<{ criterion: string; status: 'pass' | 'fail' | 'pending'; evidence: string }>;
      keyChanges?: string[];
      artifacts?: string[];
      followUps?: string[];
    };

    const now = new Date().toISOString();
    const outcome = String(body.outcome ?? existing?.outcome ?? '').trim();
    const summaryText = String(body.summary ?? existing?.summary ?? '').trim();

    if (!outcome || !summaryText) {
      res.status(400).json({ error: 'outcome and summary are required' });
      return;
    }

    const summary = createProjectTaskSummary({
      taskId: req.params.taskId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      outcome,
      summary: summaryText,
      criteriaValidation: Array.isArray(body.criteriaValidation)
        ? body.criteriaValidation
          .map((entry) => ({
            criterion: String(entry?.criterion ?? '').trim(),
            status: entry?.status,
            evidence: String(entry?.evidence ?? '').trim(),
          }))
          .filter((entry) => entry.criterion.length > 0)
        : existing?.criteriaValidation,
      keyChanges: body.keyChanges !== undefined ? normalizeStringList(body.keyChanges) : existing?.keyChanges,
      artifacts: body.artifacts !== undefined ? normalizeStringList(body.artifacts) : existing?.artifacts,
      followUps: body.followUps !== undefined ? normalizeStringList(body.followUps) : existing?.followUps,
    });

    writeProjectTaskSummary(summaryPath, summary);
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ── Workstreams ───────────────────────────────────────────────────────────────

app.get('/api/workstreams', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const ids = listWorkstreamIds({ repoRoot: REPO_ROOT, profile });
    const summaries = ids.flatMap((id) => {
      try {
        const paths = resolveWorkstreamPaths({
          repoRoot: REPO_ROOT,
          profile,
          workstreamId: id,
        });
        return [readWorkstreamSummary(paths.summaryFile)];
      } catch {
        return [];
      }
    });
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    res.json(summaries);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/workstreams/:id', (req, res) => {
  try {
    const profile = getCurrentProfile();
    const paths = resolveWorkstreamPaths({
      repoRoot: REPO_ROOT,
      profile,
      workstreamId: req.params.id,
    });
    const summary = readWorkstreamSummary(paths.summaryFile);
    const plan = readWorkstreamPlan(paths.planFile);
    const todoCount = existsSync(paths.todosDir)
      ? readdirSync(paths.todosDir).filter((f) => f.endsWith('.md')).length
      : 0;
    const artifactCount = existsSync(paths.artifactsDir)
      ? readdirSync(paths.artifactsDir).filter((f) => f.endsWith('.md')).length
      : 0;
    res.json({ id: req.params.id, summary, plan, todoCount, artifactCount });
  } catch {
    res.status(404).json({ error: 'Workstream not found' });
  }
});

// ── Shell run ─────────────────────────────────────────────────────────────────

app.post('/api/run', (req, res) => {
  try {
    const { command, cwd: runCwd } = req.body as { command: string; cwd?: string };
    if (!command) { res.status(400).json({ error: 'command required' }); return; }
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(command, {
        cwd: runCwd ?? REPO_ROOT,
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

interface SkillItem  { source: string; name: string; description: string; path: string }
interface MemoryDocItem { id: string; title: string; summary: string; tags: string[]; path: string }
interface AgentsItem { source: string; path: string; exists: boolean }

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

app.get('/api/memory', (_req, res) => {
  try {
    const profile = getCurrentProfile();
    const sharedPath  = join(REPO_ROOT, 'profiles/shared/agent/AGENTS.md');
    const profilePath = join(REPO_ROOT, `profiles/${profile}/agent/AGENTS.md`);
    const agentsMd: AgentsItem[] = [{ source: 'shared', path: sharedPath, exists: existsSync(sharedPath) }];
    if (profile !== 'shared') {
      agentsMd.push({ source: profile, path: profilePath, exists: existsSync(profilePath) });
    }

    const skills: SkillItem[] = [];
    const skillSources = profile === 'shared' ? ['shared'] : ['shared', profile];
    for (const src of skillSources) {
      const dir = join(REPO_ROOT, `profiles/${src}/agent/skills`);
      if (!existsSync(dir)) continue;
      for (const name of readdirSync(dir)) {
        const skillMd = join(dir, name, 'SKILL.md');
        if (!existsSync(skillMd)) continue;
        const fm = parseFrontmatter(skillMd);
        skills.push({
          source: src,
          name: String(fm.name ?? name),
          description: String(fm.description ?? ''),
          path: skillMd,
        });
      }
    }

    const memoryDocs: MemoryDocItem[] = [];
    const memDir = join(REPO_ROOT, `profiles/${profile}/agent/memory`);
    if (existsSync(memDir)) {
      for (const file of readdirSync(memDir).filter(f => f.endsWith('.md'))) {
        const fp = join(memDir, file);
        const fm = parseFrontmatter(fp);
        const id = file.replace(/\.md$/, '');
        const tags = fm.tags;
        memoryDocs.push({
          id:      String(fm.id ?? id),
          title:   String(fm.title ?? id),
          summary: String(fm.summary ?? ''),
          tags:    Array.isArray(tags) ? tags.map(String) : typeof tags === 'string' ? [tags] : [],
          path:    fp,
        });
      }
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
  console.log(`  dist    : ${DIST_DIR}`);
  console.log();
});
