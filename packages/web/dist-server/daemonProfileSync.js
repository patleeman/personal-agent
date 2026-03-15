import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getProfilesRoot } from '@personal-agent/core';
import { getDaemonConfigFilePath, getDaemonStatus, pingDaemon, startDaemonDetached, stopDaemonGracefully, } from '@personal-agent/daemon';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizePath(value) {
    return resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}
export function resolveProfileTaskDir(_repoRoot, profile) {
    return resolve(getProfilesRoot(), profile, 'agent', 'tasks');
}
export function classifyRepoManagedTaskDir(taskDir, repoRoot) {
    if (!taskDir || taskDir.trim().length === 0) {
        return 'missing';
    }
    const normalizedTaskDir = normalizePath(taskDir);
    const candidateProfilesRoots = [...new Set([
            normalizePath(getProfilesRoot()),
            normalizePath(join(repoRoot, 'profiles')),
        ])];
    for (const profilesRoot of candidateProfilesRoots) {
        if (normalizedTaskDir === profilesRoot) {
            return 'profiles-root';
        }
        const relativeToProfiles = normalizedTaskDir.startsWith(`${profilesRoot}/`)
            ? normalizedTaskDir.slice(profilesRoot.length + 1)
            : undefined;
        if (relativeToProfiles && /^[^/]+\/agent\/tasks(?:\/.*)?$/.test(relativeToProfiles)) {
            return 'profile-task-dir';
        }
    }
    return 'other';
}
function readJsonObject(filePath) {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
        throw new Error(`Daemon config at ${filePath} must contain a JSON object`);
    }
    return parsed;
}
function writeJsonObject(filePath, value) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}
export function normalizeDaemonTaskDirOverride(options) {
    const daemonConfigFile = options.daemonConfigFile ?? getDaemonConfigFilePath();
    if (!existsSync(daemonConfigFile)) {
        return { changed: false };
    }
    const config = readJsonObject(daemonConfigFile);
    const modules = isRecord(config.modules) ? { ...config.modules } : undefined;
    const tasks = modules && isRecord(modules.tasks) ? { ...modules.tasks } : undefined;
    const taskDir = typeof tasks?.taskDir === 'string' ? tasks.taskDir : undefined;
    const scope = classifyRepoManagedTaskDir(taskDir, options.repoRoot);
    if (scope !== 'profiles-root' && scope !== 'profile-task-dir') {
        return { changed: false };
    }
    if (!modules || !tasks || !('taskDir' in tasks)) {
        return { changed: false };
    }
    delete tasks.taskDir;
    if (Object.keys(tasks).length > 0) {
        modules.tasks = tasks;
    }
    else {
        delete modules.tasks;
    }
    const nextConfig = {
        ...config,
    };
    if (Object.keys(modules).length > 0) {
        nextConfig.modules = modules;
    }
    else {
        delete nextConfig.modules;
    }
    writeJsonObject(daemonConfigFile, nextConfig);
    return { changed: true };
}
export function readRunningDaemonTaskDir(status) {
    const tasksModule = status.modules.find((module) => module.name === 'tasks');
    const detail = tasksModule?.detail;
    if (!detail || typeof detail.taskDir !== 'string' || detail.taskDir.trim().length === 0) {
        return undefined;
    }
    return resolve(detail.taskDir);
}
export async function syncDaemonTaskScopeToProfile(options, dependencies = {}) {
    const resolvedDependencies = {
        pingDaemon,
        getDaemonStatus,
        stopDaemonGracefully,
        startDaemonDetached,
        ...dependencies,
    };
    const desiredTaskDir = resolveProfileTaskDir(options.repoRoot, options.profile);
    const { changed: configUpdated } = normalizeDaemonTaskDirOverride({
        repoRoot: options.repoRoot,
        daemonConfigFile: options.daemonConfigFile,
    });
    const daemonWasRunning = await resolvedDependencies.pingDaemon();
    if (!daemonWasRunning) {
        return {
            configUpdated,
            daemonWasRunning: false,
            daemonRestarted: false,
            desiredTaskDir,
        };
    }
    const status = await resolvedDependencies.getDaemonStatus();
    const runningTaskDir = readRunningDaemonTaskDir(status);
    const runningScope = classifyRepoManagedTaskDir(runningTaskDir, options.repoRoot);
    const daemonRestarted = Boolean(runningTaskDir
        && normalizePath(runningTaskDir) !== normalizePath(desiredTaskDir)
        && (runningScope === 'profiles-root' || runningScope === 'profile-task-dir'));
    if (daemonRestarted) {
        await resolvedDependencies.stopDaemonGracefully();
        await resolvedDependencies.startDaemonDetached();
    }
    return {
        configUpdated,
        daemonWasRunning,
        daemonRestarted,
        desiredTaskDir,
        runningTaskDir,
    };
}
