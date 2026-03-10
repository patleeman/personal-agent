import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listSessions, readSessionBlocks } from './sessions.js';
import { createSession, resumeSession, getLiveSessions, getSessionStats, isLive, subscribe, promptSession, abortSession, destroySession, } from './liveSessions.js';
import { listProfileActivityEntries, listWorkstreamIds, readWorkstreamPlan, readWorkstreamSummary, resolveWorkstreamPaths, } from '@personal-agent/core';
const PORT = parseInt(process.env.PA_WEB_PORT ?? '3741', 10);
const REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
const PROFILE = process.env.PERSONAL_AGENT_ACTIVE_PROFILE ?? 'shared';
const DIST_DIR = process.env.PA_WEB_DIST ??
    join(dirname(fileURLToPath(import.meta.url)), '../dist');
const app = express();
app.use(express.json());
// ── Status ──────────────────────────────────────────────────────────────────
app.get('/api/status', (_req, res) => {
    try {
        const activities = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile: PROFILE });
        const workstreamIds = listWorkstreamIds({ repoRoot: REPO_ROOT, profile: PROFILE });
        res.json({
            profile: PROFILE,
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
        const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile: PROFILE });
        res.json(entries.map(({ entry }) => entry));
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
app.get('/api/activity/count', (_req, res) => {
    try {
        const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile: PROFILE });
        res.json({ count: entries.length });
    }
    catch {
        res.json({ count: 0 });
    }
});
app.get('/api/activity/:id', (req, res) => {
    try {
        const entries = listProfileActivityEntries({ repoRoot: REPO_ROOT, profile: PROFILE });
        const match = entries.find(({ entry }) => entry.id === req.params.id);
        if (!match) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(match.entry);
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
        let currentModel = 'claude-sonnet-4-6';
        if (existsSync(SETTINGS_FILE)) {
            const s = JSON.parse(readFileSync(SETTINGS_FILE, 'utf-8'));
            if (s.defaultModel)
                currentModel = s.defaultModel;
        }
        res.json({ currentModel, models: BUILT_IN_MODELS });
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
        const { text, behavior } = req.body;
        if (!text) {
            res.status(400).json({ error: 'text required' });
            return;
        }
        // Don't await — streaming response goes over SSE
        promptSession(id, text, behavior).catch(err => {
            console.error(`[live] prompt error for ${id}:`, err);
        });
        res.json({ ok: true });
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
    // Try live session first, then fall back to historical session list
    const liveSessions = getLiveSessions();
    const liveEntry = liveSessions.find(s => s.id === id);
    const detail = readSessionBlocks(id);
    const cwd = liveEntry?.cwd ?? detail?.meta.cwd;
    if (!cwd) {
        res.status(404).json({ error: 'Session not found' });
        return;
    }
    // Git branch for session cwd
    let branch = null;
    try {
        branch = execSync('git branch --show-current', { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 })
            .toString().trim() || null;
    }
    catch { /* not a git repo or git not found */ }
    // Last 5 user messages
    const userMessages = (detail?.blocks ?? [])
        .filter(b => b.type === 'user')
        .slice(-5)
        .map(b => ({ id: b.id, ts: b.ts, text: b.text }));
    res.json({ cwd, branch, userMessages });
});
app.get('/api/live-sessions/:id/stats', (req, res) => {
    const stats = getSessionStats(req.params.id);
    if (!stats) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(stats);
});
/** Destroy / close a live session */
app.delete('/api/live-sessions/:id', (req, res) => {
    destroySession(req.params.id);
    res.json({ ok: true });
});
// ── Workstreams ───────────────────────────────────────────────────────────────
app.get('/api/workstreams', (_req, res) => {
    try {
        const ids = listWorkstreamIds({ repoRoot: REPO_ROOT, profile: PROFILE });
        const summaries = ids.flatMap((id) => {
            try {
                const paths = resolveWorkstreamPaths({
                    repoRoot: REPO_ROOT,
                    profile: PROFILE,
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
        const paths = resolveWorkstreamPaths({
            repoRoot: REPO_ROOT,
            profile: PROFILE,
            workstreamId: req.params.id,
        });
        const summary = readWorkstreamSummary(paths.summaryFile);
        const plan = readWorkstreamPlan(paths.planFile);
        const taskCount = existsSync(paths.tasksDir)
            ? readdirSync(paths.tasksDir).filter((f) => f.endsWith('.md')).length
            : 0;
        const artifactCount = existsSync(paths.artifactsDir)
            ? readdirSync(paths.artifactsDir).filter((f) => f.endsWith('.md')).length
            : 0;
        res.json({ id: req.params.id, summary, plan, taskCount, artifactCount });
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
        const sharedPath = join(REPO_ROOT, 'profiles/shared/agent/AGENTS.md');
        const profilePath = join(REPO_ROOT, `profiles/${PROFILE}/agent/AGENTS.md`);
        const agentsMd = [{ source: 'shared', path: sharedPath, exists: existsSync(sharedPath) }];
        if (PROFILE !== 'shared') {
            agentsMd.push({ source: PROFILE, path: profilePath, exists: existsSync(profilePath) });
        }
        const skills = [];
        const skillSources = PROFILE === 'shared' ? ['shared'] : ['shared', PROFILE];
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
        const memDir = join(REPO_ROOT, `profiles/${PROFILE}/agent/memory`);
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
        res.json({ profile: PROFILE, agentsMd, skills, memoryDocs });
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
    console.log(`  profile : ${PROFILE}`);
    console.log(`  repo    : ${REPO_ROOT}`);
    console.log(`  dist    : ${DIST_DIR}`);
    console.log();
});
