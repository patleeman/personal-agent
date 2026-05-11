import { randomUUID } from 'crypto';
import { createConnection } from 'net';
import { loadDaemonConfig } from './config.js';
import { createDaemonEvent } from './events.js';
import { getDaemonClientTransportOverride } from './in-process-client.js';
import { resolveDaemonPaths } from './paths.js';
const DEFAULT_SOCKET_TIMEOUT_MS = 5000;
function getSocketPath(config) {
    const effectiveConfig = config ?? loadDaemonConfig();
    const paths = resolveDaemonPaths(effectiveConfig.ipc.socketPath);
    return paths.socketPath;
}
async function sendRequest(request, config) {
    const socketPath = getSocketPath(config);
    return new Promise((resolve, reject) => {
        const socket = createConnection(socketPath);
        let buffer = '';
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                socket.destroy();
                reject(new Error(`Daemon connection timed out after ${DEFAULT_SOCKET_TIMEOUT_MS}ms`));
            }
        }, DEFAULT_SOCKET_TIMEOUT_MS);
        socket.on('connect', () => {
            socket.write(`${JSON.stringify(request)}\n`);
        });
        socket.on('data', (chunk) => {
            buffer += chunk.toString();
            if (!buffer.includes('\n')) {
                return;
            }
            const line = buffer.slice(0, buffer.indexOf('\n')).trim();
            buffer = '';
            if (!line) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error('Daemon returned empty response'));
                }
                socket.end();
                return;
            }
            const parsed = JSON.parse(line);
            if (!parsed.ok) {
                if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    reject(new Error(parsed.error ?? 'Daemon request failed'));
                }
                socket.end();
                return;
            }
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(parsed.result);
            }
            socket.end();
        });
        socket.on('error', (error) => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(error);
            }
        });
        socket.on('close', () => {
            if (!settled) {
                settled = true;
                clearTimeout(timeout);
                reject(new Error('Daemon connection closed without response'));
            }
        });
    });
}
function getTransport() {
    return getDaemonClientTransportOverride();
}
export async function pingDaemon(config) {
    const transport = getTransport();
    if (transport) {
        try {
            return await transport.ping(config);
        }
        catch {
            return false;
        }
    }
    try {
        const result = await sendRequest({
            id: `req_${randomUUID()}`,
            type: 'ping',
        }, config);
        return result.pong === true;
    }
    catch {
        return false;
    }
}
export async function getDaemonStatus(config) {
    const transport = getTransport();
    if (transport) {
        return transport.getStatus(config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'status',
    }, config);
}
export async function stopDaemon(config) {
    const transport = getTransport();
    if (transport) {
        await transport.stop(config);
        return;
    }
    await sendRequest({
        id: `req_${randomUUID()}`,
        type: 'stop',
    }, config);
}
export async function listDurableRuns(config) {
    const transport = getTransport();
    if (transport) {
        return transport.listDurableRuns(config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.list',
    }, config);
}
export async function getDurableRun(runId, config) {
    const transport = getTransport();
    if (transport) {
        return transport.getDurableRun(runId, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.get',
        runId,
    }, config);
}
export async function startScheduledTaskRun(taskId, config) {
    const transport = getTransport();
    if (transport) {
        return transport.startScheduledTaskRun(taskId, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.startTask',
        taskId,
    }, config);
}
export async function startBackgroundRun(input, config) {
    const transport = getTransport();
    if (transport) {
        return transport.startBackgroundRun(input, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.startBackground',
        input,
    }, config);
}
export async function cancelDurableRun(runId, config) {
    const transport = getTransport();
    if (transport) {
        return transport.cancelDurableRun(runId, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.cancel',
        runId,
    }, config);
}
export async function rerunDurableRun(runId, config) {
    const transport = getTransport();
    if (transport) {
        return transport.rerunDurableRun(runId, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.rerun',
        runId,
    }, config);
}
export async function followUpDurableRun(runId, prompt, config) {
    const normalizedPrompt = typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
    const transport = getTransport();
    if (transport) {
        return transport.followUpDurableRun(runId, normalizedPrompt, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'runs.followUp',
        runId,
        ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
    }, config);
}
export async function syncWebLiveConversationRunState(input, config) {
    const transport = getTransport();
    if (transport) {
        return transport.syncWebLiveConversationRunState(input, config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'conversations.sync',
        input,
    }, config);
}
export async function listRecoverableWebLiveConversationRunsFromDaemon(config) {
    const transport = getTransport();
    if (transport) {
        return transport.listRecoverableWebLiveConversationRuns(config);
    }
    return sendRequest({
        id: `req_${randomUUID()}`,
        type: 'conversations.recoverable',
    }, config);
}
async function emitDaemonEnvelope(event, config) {
    const transport = getTransport();
    if (transport) {
        return transport.emitEvent(event, config);
    }
    const result = await sendRequest({
        id: `req_${randomUUID()}`,
        type: 'emit',
        event,
    }, config);
    return result.accepted;
}
export async function emitDaemonEvent(input, config) {
    return emitDaemonEnvelope(createDaemonEvent(input), config);
}
function getErrorCode(error) {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const code = error.code;
    return typeof code === 'string' ? code : undefined;
}
function formatDaemonUnavailableWarning(error, config) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
        const socketPath = getSocketPath(config);
        return 'daemon is not running; background events are disabled. ' + `Start it with: pa daemon start (socket: ${socketPath})`;
    }
    const message = error instanceof Error ? error.message : String(error);
    return `daemon unavailable; continuing without background event (${message})`;
}
export async function emitDaemonEventNonFatal(input, config) {
    if (process.env.PERSONAL_AGENT_DISABLE_DAEMON_EVENTS === '1') {
        return;
    }
    try {
        const accepted = await emitDaemonEvent(input, config);
        if (!accepted) {
            console.warn(`daemon queue is full; dropped event type=${input.type}`);
        }
    }
    catch (error) {
        console.warn(formatDaemonUnavailableWarning(error, config));
    }
}
