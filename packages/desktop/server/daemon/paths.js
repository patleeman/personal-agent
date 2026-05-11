import { resolveStatePaths } from '@personal-agent/core';
import { mkdirSync } from 'fs';
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
export function resolveDaemonPaths(explicitSocketPath) {
    const statePaths = resolveStatePaths();
    const root = join(statePaths.root, 'daemon');
    const socketPath = explicitSocketPath ? resolve(expandHome(explicitSocketPath)) : join(root, 'personal-agentd.sock');
    return {
        stateRoot: statePaths.root,
        root,
        socketPath,
        pidFile: join(root, 'personal-agentd.pid'),
        logDir: join(root, 'logs'),
        logFile: join(root, 'logs', 'daemon.log'),
    };
}
export function ensureDaemonDirectories(paths) {
    mkdirSync(paths.root, { recursive: true, mode: 0o700 });
    mkdirSync(paths.logDir, { recursive: true, mode: 0o700 });
}
