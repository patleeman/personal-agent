import { getDurableTasksDir, getMachineConfigFilePath, readMachineConfigSection } from '@personal-agent/core';
import { homedir } from 'os';
import { join, resolve } from 'path';
function expandHome(path) {
    if (path === '~') {
        return homedir();
    }
    if (path.startsWith('~/')) {
        return join(homedir(), path.slice(2));
    }
    return path;
}
function getDefaultTasksDir() {
    return getDurableTasksDir();
}
function expandConfigPaths(config) {
    return {
        ...config,
        ipc: {
            ...config.ipc,
            socketPath: config.ipc.socketPath ? resolve(expandHome(config.ipc.socketPath)) : undefined,
        },
        modules: {
            ...config.modules,
            tasks: {
                ...config.modules.tasks,
                taskDir: resolve(expandHome(config.modules.tasks.taskDir)),
            },
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function deepMerge(base, overlay) {
    const output = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        if (Array.isArray(value)) {
            output[key] = [...value];
            continue;
        }
        if (isRecord(value)) {
            const current = output[key];
            if (isRecord(current)) {
                output[key] = deepMerge(current, value);
            }
            else {
                output[key] = deepMerge({}, value);
            }
            continue;
        }
        output[key] = value;
    }
    return output;
}
function readConfigOverride(path) {
    const section = readMachineConfigSection('daemon', { filePath: path });
    if (section === undefined) {
        return {};
    }
    if (!isRecord(section)) {
        throw new Error(`Invalid daemon config at ${path}: daemon section must be an object`);
    }
    return section;
}
export function getDaemonConfigFilePath() {
    const explicit = process.env.PERSONAL_AGENT_DAEMON_CONFIG;
    if (explicit && explicit.trim().length > 0) {
        return resolve(expandHome(explicit.trim()));
    }
    return getMachineConfigFilePath();
}
export function getDefaultDaemonConfig() {
    return {
        logLevel: 'info',
        queue: {
            maxDepth: 1000,
        },
        ipc: {
            socketPath: process.env.PERSONAL_AGENT_DAEMON_SOCKET_PATH,
        },
        modules: {
            maintenance: {
                enabled: true,
                cleanupIntervalMinutes: 60,
            },
            tasks: {
                enabled: true,
                taskDir: getDefaultTasksDir(),
                tickIntervalSeconds: 30,
                maxRetries: 3,
                reapAfterDays: 7,
                defaultTimeoutSeconds: 1800,
            },
        },
    };
}
export function loadDaemonConfig() {
    const defaults = getDefaultDaemonConfig();
    const filePath = getDaemonConfigFilePath();
    const fromDisk = readConfigOverride(filePath);
    const merged = deepMerge(defaults, fromDisk);
    return expandConfigPaths(merged);
}
