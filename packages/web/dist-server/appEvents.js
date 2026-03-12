import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveActivityReadStatePath, resolveConversationAttentionStatePath, resolveDeferredResumeStateFile, resolveProfileActivityConversationLinksDir, resolveProfileActivityDir, resolveProfileConversationArtifactsDir, resolveProfileProjectsDir, } from '@personal-agent/core';
import { logWarn } from './logging.js';
const DEFAULT_INTERVAL_MS = 2_000;
const listeners = new Set();
let monitorHandle;
let lastProfile = null;
let lastSignatures = null;
function readPathSnapshot(path) {
    if (!existsSync(path)) {
        return 'missing';
    }
    const stats = statSync(path);
    if (!stats.isDirectory()) {
        return `file:${stats.size}:${stats.mtimeMs}`;
    }
    const parts = [];
    const walk = (dirPath, relativePath) => {
        const dirStats = statSync(dirPath);
        parts.push(`d:${relativePath}:${dirStats.mtimeMs}`);
        const entries = readdirSync(dirPath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const entryPath = join(dirPath, entry.name);
            const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                walk(entryPath, entryRelativePath);
                continue;
            }
            const entryStats = statSync(entryPath);
            parts.push(`f:${entryRelativePath}:${entryStats.size}:${entryStats.mtimeMs}`);
        }
    };
    walk(path, '');
    return parts.join('|');
}
function createTopicSignatures(options, profile) {
    const activityDir = resolveProfileActivityDir({ profile });
    const activityConversationLinksDir = resolveProfileActivityConversationLinksDir({ profile });
    const projectsDir = resolveProfileProjectsDir({ repoRoot: options.repoRoot, profile });
    const conversationArtifactsDir = resolveProfileConversationArtifactsDir({ profile });
    const tasksDir = join(options.repoRoot, 'profiles', profile, 'agent', 'tasks');
    const readStateFile = resolveActivityReadStatePath({ profile });
    const conversationAttentionStateFile = resolveConversationAttentionStatePath({ profile });
    const deferredResumeStateFile = resolveDeferredResumeStateFile();
    const activitySignature = `activity:${readPathSnapshot(activityDir)}|links:${readPathSnapshot(activityConversationLinksDir)}|read:${readPathSnapshot(readStateFile)}`;
    return {
        activity: activitySignature,
        projects: `projects:${readPathSnapshot(projectsDir)}`,
        sessions: `sessions:${readPathSnapshot(options.sessionsDir)}|artifacts:${readPathSnapshot(conversationArtifactsDir)}|attention:${readPathSnapshot(conversationAttentionStateFile)}|deferred:${readPathSnapshot(deferredResumeStateFile)}|${activitySignature}`,
        tasks: `tasks:${readPathSnapshot(tasksDir)}|state:${readPathSnapshot(options.taskStateFile)}`,
    };
}
export function diffTopicSignatures(previous, next) {
    if (!previous) {
        return [];
    }
    const changed = [];
    for (const topic of Object.keys(next)) {
        if (previous[topic] !== next[topic]) {
            changed.push(topic);
        }
    }
    return changed;
}
export function publishAppEvent(event) {
    for (const listener of listeners) {
        listener(event);
    }
}
export function invalidateAppTopics(...topics) {
    const uniqueTopics = [...new Set(topics)].sort();
    if (uniqueTopics.length === 0) {
        return;
    }
    publishAppEvent({ type: 'invalidate', topics: uniqueTopics });
}
export function subscribeAppEvents(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function startAppEventMonitor(options) {
    if (monitorHandle) {
        return;
    }
    const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    const tick = () => {
        const profile = options.getCurrentProfile();
        const nextSignatures = createTopicSignatures(options, profile);
        if (lastProfile !== profile) {
            lastProfile = profile;
            lastSignatures = nextSignatures;
            invalidateAppTopics('activity', 'projects', 'sessions', 'tasks');
            return;
        }
        const changedTopics = diffTopicSignatures(lastSignatures, nextSignatures);
        lastSignatures = nextSignatures;
        if (changedTopics.length > 0) {
            invalidateAppTopics(...changedTopics);
        }
    };
    tick();
    monitorHandle = setInterval(() => {
        try {
            tick();
        }
        catch (error) {
            logWarn('app event monitor failed', {
                message: error.message,
            });
        }
    }, intervalMs);
}
