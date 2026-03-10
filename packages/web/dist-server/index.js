import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { listSessions, readSessionBlocks } from './sessions.js';
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
app.get('/api/models', (_req, res) => {
    try {
        const settingsFile = join(homedir(), '.local/state/personal-agent/pi-agent/settings.json');
        let currentModel = 'gpt-5.4';
        if (existsSync(settingsFile)) {
            const s = JSON.parse(readFileSync(settingsFile, 'utf-8'));
            if (s.defaultModel)
                currentModel = s.defaultModel;
        }
        res.json({ currentModel, models: BUILT_IN_MODELS });
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
// ── Sessions ──────────────────────────────────────────────────────────────────
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
