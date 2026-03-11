import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listSessions, readSessionBlocks } from './sessions.js';
import { readSavedModelPreferences } from './modelPreferences.js';
import { getProfileConfigFilePath, readSavedProfilePreferences, resolveActiveProfile, writeSavedProfilePreferences, } from './profilePreferences.js';
import { createSession, resumeSession, getLiveSessions, getSessionStats, getSessionContextUsage, getAvailableModels, isLive, subscribe, promptSession, compactSession, reloadSessionResources, exportSessionHtml, renameSession, abortSession, destroySession, forkSession, registry as liveRegistry, } from './liveSessions.js';
import { addConversationWorkstreamLink, getConversationWorkstreamLink, listProfileActivityEntries, listWorkstreamIds, readWorkstreamPlan, readWorkstreamSummary, removeConversationWorkstreamLink, resolveWorkstreamPaths, } from '@personal-agent/core';
import { listProfiles, materializeProfileToAgentDir, resolveResourceProfile, } from '@personal-agent/resources';
const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
const AGENT_DIR = join(homedir(), '.local/state/personal-agent/pi-agent');
const PROFILE_CONFIG_FILE = getProfileConfigFilePath();
function listAvailableProfiles() {
    return listProfiles({ repoRoot: REPO_ROOT });
}
function materializeWebProfile(profile) {
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
}
catch (error) {
    console.warn(`[web] failed to materialize initial profile ${currentProfile}: ${error.message}`);
}
function getCurrentProfile() {
    return currentProfile;
}
function setCurrentProfile(profile) {
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
function resolveReadStateFile(profile = getCurrentProfile()) {
    return join(REPO_ROOT, `profiles/${profile}/agent/activity/.read-state.json`);
}
function loadReadState(profile = getCurrentProfile()) {
    try {
        return new Set(JSON.parse(readFileSync(resolveReadStateFile(profile), 'utf-8')));
    }
    catch {
        return new Set();
    }
}
function saveReadState(ids, profile = getCurrentProfile()) {
    try {
        const readStateFile = resolveReadStateFile(profile);
        mkdirSync(dirname(readStateFile), { recursive: true });
        writeFileSync(readStateFile, JSON.stringify([...ids]));
    }
    catch { /* ignore */ }
}
function summarizeUserMessageContent(content) {
    const blocks = Array.isArray(content)
        ? content
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
const DIST_DIR = process.env.PA_WEB_DIST ??
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
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.patch('/api/profiles/current', (req, res) => {
    try {
        const { profile } = req.body;
        if (!profile) {
            res.status(400).json({ error: 'profile required' });
            return;
        }
        res.json({ ok: true, currentProfile: setCurrentProfile(profile) });
    }
    catch (err) {
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
    }
    catch (err) {
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
    }
    catch (err) {
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
    }
    catch {
        res.json({ count: 0 });
    }
});
app.get('/api/activity/:id', (req, res) => {
    try {
        const profile = getCurrentProfile();
        const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile });
        const match = entries.find(({ entry }) => entry.id === req.params.id);
        if (!match) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        const read = loadReadState(profile);
        res.json({ ...match.entry, read: read.has(match.entry.id) });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Mark an activity item as read */
app.patch('/api/activity/:id', (req, res) => {
    try {
        const profile = getCurrentProfile();
        const { id } = req.params;
        const { read } = req.body;
        const state = loadReadState(profile);
        if (read === false)
            state.delete(id);
        else
            state.add(id);
        saveReadState(state, profile);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ── Models ────────────────────────────────────────────────────────────────────
const BUILT_IN_MODELS = [
    // Anthropic
    { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6', context: 200_000 },
    { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', context: 200_000 },
    { id: 'claude-haiku-4-6', provider: 'anthropic', name: 'Claude Haiku 4.6', context: 200_000 },
    // OpenAI / Codex
    { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', context: 128_000 },
    { id: 'gpt-5.2', provider: 'openai-codex', name: 'GPT-5.2', context: 128_000 },
    { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', context: 128_000 },
    // Google
    { id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', context: 1_000_000 },
    { id: 'gemini-3.1-pro-high', provider: 'google', name: 'Gemini 3.1 Pro High', context: 1_000_000 },
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
            if (live.length > 0)
                models = live;
        }
        catch { /* fall back to built-in list */ }
        if (!currentModel && models.length > 0)
            currentModel = models[0].id;
        res.json({ currentModel, currentThinkingLevel, models });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.patch('/api/models/current', (req, res) => {
    try {
        const { model } = req.body;
        if (!model) {
            res.status(400).json({ error: 'model required' });
            return;
        }
        let settings = {};
        if (existsSync(SETTINGS_FILE)) {
            settings = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
        }
        settings.defaultModel = model;
        writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', (_req, res) => {
    try {
        const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
        let taskState = {};
        if (existsSync(stateFile)) {
            taskState = JSON.parse(readFileSync(stateFile, 'utf-8'));
        }
        const tasks = taskState.tasks ?? {};
        // Parse task markdown files to get schedule + prompt
        const enriched = Object.values(tasks).map((t) => {
            const task = t;
            let enabled = true;
            let cron;
            let prompt = '';
            let model;
            try {
                const md = readFileSync(task.filePath, 'utf-8');
                const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
                if (fmMatch) {
                    const fm = fmMatch[1];
                    if (/enabled:\s*false/.test(fm))
                        enabled = false;
                    cron = fm.match(/cron:\s*"?([^"\n]+)"?/)?.[1]?.trim();
                    model = fm.match(/model:\s*"?([^"\n]+)"?/)?.[1]?.trim();
                }
                prompt = md.replace(/^---[\s\S]*?---\n?/, '').trim().split('\n')[0].slice(0, 120);
            }
            catch { /* ignore */ }
            return { ...task, enabled, cron, prompt, model };
        });
        res.json(enriched);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.patch('/api/tasks/:id', (req, res) => {
    try {
        const { enabled } = req.body;
        const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
        if (!existsSync(stateFile)) {
            res.status(404).json({ error: 'No task state' });
            return;
        }
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const entry = Object.values(state.tasks ?? {}).find(t => t.id === req.params.id);
        if (!entry) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        let content = readFileSync(entry.filePath, 'utf-8');
        if (/enabled:\s*(true|false)/.test(content)) {
            content = content.replace(/enabled:\s*(true|false)/, `enabled: ${enabled}`);
        }
        else {
            // Inject into frontmatter after opening ---
            content = content.replace(/^---\n/, `---\nenabled: ${enabled}\n`);
        }
        writeFileSync(entry.filePath, content, 'utf-8');
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/tasks/:id/log', (req, res) => {
    try {
        const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
        if (!existsSync(stateFile)) {
            res.status(404).json({ error: 'No task state' });
            return;
        }
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const entry = Object.values(state.tasks ?? {}).find(t => t.id === req.params.id);
        if (!entry?.lastLogPath || !existsSync(entry.lastLogPath)) {
            res.status(404).json({ error: 'No log available' });
            return;
        }
        const log = readFileSync(entry.lastLogPath, 'utf-8');
        res.json({ log, path: entry.lastLogPath });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/tasks/:id', (req, res) => {
    try {
        const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
        if (!existsSync(stateFile)) {
            res.status(404).json({ error: 'No task state' });
            return;
        }
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const entry = Object.values(state.tasks ?? {}).find((t) => t.id === req.params.id);
        if (!entry) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        let fileContent = '';
        let enabled = true;
        let cron;
        let model;
        try {
            fileContent = readFileSync(entry.filePath, 'utf-8');
            const fmMatch = fileContent.match(/^---\n([\s\S]*?)\n---/);
            if (fmMatch) {
                const fm = fmMatch[1];
                if (/enabled:\s*false/.test(fm))
                    enabled = false;
                cron = fm.match(/cron:\s*"?([^"\n]+)"?/)?.[1]?.trim();
                model = fm.match(/model:\s*"?([^"\n]+)"?/)?.[1]?.trim();
            }
        }
        catch { /* ignore */ }
        res.json({ ...entry, enabled, cron, model, fileContent });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Run a task immediately — creates a live session with the task's prompt */
app.post('/api/tasks/:id/run', async (req, res) => {
    try {
        const stateFile = join(homedir(), '.local/state/personal-agent/daemon/task-state.json');
        if (!existsSync(stateFile)) {
            res.status(404).json({ error: 'No task state' });
            return;
        }
        const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
        const entry = Object.values(state.tasks ?? {}).find((t) => t.id === req.params.id);
        if (!entry) {
            res.status(404).json({ error: 'Task not found' });
            return;
        }
        // Parse prompt from file (body after frontmatter)
        const fileContent = readFileSync(entry.filePath, 'utf-8');
        const afterFm = fileContent.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
        if (!afterFm) {
            res.status(400).json({ error: 'Task has no prompt body' });
            return;
        }
        const { id: sessionId } = await createSession(REPO_ROOT);
        // Send prompt asynchronously — don't block the response
        void promptSession(sessionId, afterFm);
        res.json({ ok: true, sessionId });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ── Sessions (read-only JSONL) ────────────────────────────────────────────────
app.get('/api/sessions', (_req, res) => {
    try {
        res.json(listSessions());
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/sessions/:id', (req, res) => {
    try {
        const result = readSessionBlocks(req.params.id);
        if (!result) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        res.json(result);
    }
    catch (err) {
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
        const cwd = req.body.cwd ?? REPO_ROOT;
        const result = await createSession(cwd);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Resume an existing session file into a live session */
app.post('/api/live-sessions/resume', async (req, res) => {
    try {
        const { sessionFile } = req.body;
        if (!sessionFile) {
            res.status(400).json({ error: 'sessionFile required' });
            return;
        }
        const result = await resumeSession(sessionFile);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Check if a session is live */
app.get('/api/live-sessions/:id', (req, res) => {
    const live = isLive(req.params.id);
    if (!live) {
        res.status(404).json({ live: false });
        return;
    }
    const all = getLiveSessions();
    const entry = all.find(s => s.id === req.params.id);
    res.json({ live: true, ...entry });
});
/** SSE stream for a live session */
app.get('/api/live-sessions/:id/events', (req, res) => {
    const { id } = req.params;
    if (!isLive(id)) {
        res.status(404).json({ error: 'Not a live session' });
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
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
        const { text = '', behavior, images } = req.body;
        if (!text && (!images || images.length === 0)) {
            res.status(400).json({ error: 'text or images required' });
            return;
        }
        // Don't await — streaming response goes over SSE
        promptSession(id, text, behavior, images?.map((image) => ({
            type: 'image',
            data: image.data,
            mimeType: image.mimeType,
        }))).catch(err => {
            console.error(`[live] prompt error for ${id}:`, err);
        });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.post('/api/live-sessions/:id/compact', async (req, res) => {
    try {
        const { customInstructions } = req.body;
        const result = await compactSession(req.params.id, customInstructions?.trim() || undefined);
        res.json({ ok: true, result });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.post('/api/live-sessions/:id/reload', async (req, res) => {
    try {
        await reloadSessionResources(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.post('/api/live-sessions/:id/export', async (req, res) => {
    try {
        const { outputPath } = req.body;
        const path = await exportSessionHtml(req.params.id, outputPath?.trim() || undefined);
        res.json({ ok: true, path });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.patch('/api/live-sessions/:id/name', async (req, res) => {
    try {
        const { name } = req.body;
        const nextName = name?.trim();
        if (!nextName) {
            res.status(400).json({ error: 'name required' });
            return;
        }
        renameSession(req.params.id, nextName);
        res.json({ ok: true, name: nextName });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Abort a running agent */
app.post('/api/live-sessions/:id/abort', async (req, res) => {
    try {
        await abortSession(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
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
    if (!cwd) {
        res.status(404).json({ error: 'Session not found' });
        return;
    }
    // Git branch
    let branch = null;
    try {
        branch = execSync('git branch --show-current', { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
            .toString().trim() || null;
    }
    catch { /* not a git repo */ }
    // User messages: prefer live in-memory messages (most up-to-date), fall back to JSONL
    let userMessages = [];
    if (liveEntry) {
        userMessages = liveEntry.session.agent.state.messages
            .filter(m => m.role === 'user')
            .slice(-5)
            .map((m, i) => {
            const { text, imageCount } = summarizeUserMessageContent(m.content);
            return { id: String(i), ts: new Date().toISOString(), text: text.slice(0, 300), imageCount };
        });
    }
    else {
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
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.post('/api/conversations/:id/workstreams', (req, res) => {
    try {
        const profile = getCurrentProfile();
        const { workstreamId } = req.body;
        if (!workstreamId) {
            res.status(400).json({ error: 'workstreamId required' });
            return;
        }
        const document = addConversationWorkstreamLink({
            repoRoot: REPO_ROOT,
            profile,
            conversationId: req.params.id,
            workstreamId,
        });
        res.json({ conversationId: req.params.id, relatedWorkstreamIds: document.relatedWorkstreamIds });
    }
    catch (err) {
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
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/live-sessions/:id/fork-entries', (req, res) => {
    const liveEntry = liveRegistry.get(req.params.id);
    if (!liveEntry) {
        res.status(404).json({ error: 'Session not live' });
        return;
    }
    try {
        res.json(liveEntry.session.getUserMessagesForForking());
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.post('/api/live-sessions/:id/fork', async (req, res) => {
    try {
        const { entryId } = req.body;
        if (!entryId) {
            res.status(400).json({ error: 'entryId required' });
            return;
        }
        res.json(await forkSession(req.params.id, entryId));
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/live-sessions/:id/stats', (req, res) => {
    const stats = getSessionStats(req.params.id);
    if (!stats) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(stats);
});
app.get('/api/live-sessions/:id/context-usage', (req, res) => {
    const usage = getSessionContextUsage(req.params.id);
    if (!usage) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(usage);
});
/** Destroy / close a live session */
app.delete('/api/live-sessions/:id', (req, res) => {
    destroySession(req.params.id);
    res.json({ ok: true });
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
            }
            catch {
                return [];
            }
        });
        summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        res.json(summaries);
    }
    catch (err) {
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
    }
    catch {
        res.status(404).json({ error: 'Workstream not found' });
    }
});
// ── Shell run ─────────────────────────────────────────────────────────────────
app.post('/api/run', (req, res) => {
    try {
        const { command, cwd: runCwd } = req.body;
        if (!command) {
            res.status(400).json({ error: 'command required' });
            return;
        }
        let output = '';
        let exitCode = 0;
        try {
            output = execSync(command, {
                cwd: runCwd ?? REPO_ROOT,
                timeout: 30_000,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        catch (err) {
            const e = err;
            output = (e.stdout ?? '') + (e.stderr ?? e.message ?? '');
            exitCode = e.status ?? 1;
        }
        res.json({ output: output.slice(0, 50_000), exitCode });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
function parseFrontmatter(filePath) {
    try {
        const raw = readFileSync(filePath, 'utf-8');
        const m = raw.match(/^---\n([\s\S]*?)\n---/);
        if (!m)
            return {};
        const fm = m[1];
        const result = {};
        const lines = fm.split('\n');
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            const kv = line.match(/^([\w-]+):\s*(.*)/);
            if (!kv) {
                i++;
                continue;
            }
            const key = kv[1];
            const val = kv[2].trim();
            if (val === '') {
                const items = [];
                i++;
                while (i < lines.length && /^\s+-\s+/.test(lines[i])) {
                    items.push(lines[i].replace(/^\s+-\s+/, '').trim());
                    i++;
                }
                result[key] = items;
                continue;
            }
            else if (val.startsWith('[')) {
                result[key] = val.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
            }
            else {
                result[key] = val.replace(/^["']|["']$/g, '');
            }
            i++;
        }
        return result;
    }
    catch {
        return {};
    }
}
app.get('/api/memory', (_req, res) => {
    try {
        const profile = getCurrentProfile();
        const sharedPath = join(REPO_ROOT, 'profiles/shared/agent/AGENTS.md');
        const profilePath = join(REPO_ROOT, `profiles/${profile}/agent/AGENTS.md`);
        const agentsMd = [{ source: 'shared', path: sharedPath, exists: existsSync(sharedPath) }];
        if (profile !== 'shared') {
            agentsMd.push({ source: profile, path: profilePath, exists: existsSync(profilePath) });
        }
        const skills = [];
        const skillSources = profile === 'shared' ? ['shared'] : ['shared', profile];
        for (const src of skillSources) {
            const dir = join(REPO_ROOT, `profiles/${src}/agent/skills`);
            if (!existsSync(dir))
                continue;
            for (const name of readdirSync(dir)) {
                const skillMd = join(dir, name, 'SKILL.md');
                if (!existsSync(skillMd))
                    continue;
                const fm = parseFrontmatter(skillMd);
                skills.push({
                    source: src,
                    name: String(fm.name ?? name),
                    description: String(fm.description ?? ''),
                    path: skillMd,
                });
            }
        }
        const memoryDocs = [];
        const memDir = join(REPO_ROOT, `profiles/${profile}/agent/memory`);
        if (existsSync(memDir)) {
            for (const file of readdirSync(memDir).filter(f => f.endsWith('.md'))) {
                const fp = join(memDir, file);
                const fm = parseFrontmatter(fp);
                const id = file.replace(/\.md$/, '');
                const tags = fm.tags;
                memoryDocs.push({
                    id: String(fm.id ?? id),
                    title: String(fm.title ?? id),
                    summary: String(fm.summary ?? ''),
                    tags: Array.isArray(tags) ? tags.map(String) : typeof tags === 'string' ? [tags] : [],
                    path: fp,
                });
            }
        }
        res.json({ profile, agentsMd, skills, memoryDocs });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/memory/file', (req, res) => {
    try {
        const filePath = req.query.path;
        if (!filePath) {
            res.status(400).json({ error: 'path required' });
            return;
        }
        if (!filePath.startsWith(REPO_ROOT) || !filePath.endsWith('.md')) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        if (!existsSync(filePath)) {
            res.status(404).json({ error: 'File not found' });
            return;
        }
        const content = readFileSync(filePath, 'utf-8');
        res.json({ content, path: filePath });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.post('/api/memory/file', (req, res) => {
    try {
        const { path: filePath, content } = req.body;
        if (!filePath || content === undefined) {
            res.status(400).json({ error: 'path and content required' });
            return;
        }
        if (!filePath.startsWith(REPO_ROOT) || !filePath.endsWith('.md')) {
            res.status(403).json({ error: 'Access denied' });
            return;
        }
        writeFileSync(filePath, content, 'utf-8');
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ── Static + SPA fallback ─────────────────────────────────────────────────────
if (existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
        res.sendFile(join(DIST_DIR, 'index.html'));
    });
}
else {
    app.get('/', (_req, res) => {
        res.send('<pre style="font-family:monospace;padding:2rem;background:#07090e;color:#bfcfee">' +
            'personal-agent web UI\n\n' +
            'SPA not built yet.\n' +
            'Run: npm run build in packages/web\n' +
            '</pre>');
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
