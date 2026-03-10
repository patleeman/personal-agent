import { existsSync, readdirSync } from 'node:fs';
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
