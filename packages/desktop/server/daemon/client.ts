import { randomUUID } from 'crypto';
import { createConnection } from 'net';

import type { DaemonConfig } from '../config.js';
import { loadDaemonConfig } from '../config.js';
import { resolveDaemonPaths } from '../paths.js';
import { publishAppEvent } from '../shared/appEvents.js';
import { logWarn } from '../shared/logging.js';
import { DEFAULT_COMPANION_HOST } from './companion/types.js';
import { createDaemonEvent } from './events.js';
import { getDaemonClientTransportOverride } from './in-process-client.js';
import type {
  CancelDurableRunResult,
  DaemonEvent,
  DaemonEventInput,
  DaemonStatus,
  FollowUpDurableRunResult,
  GetDurableRunResult,
  ListDurableRunsResult,
  ListRecoverableWebLiveConversationRunsResult,
  ReplayDurableRunResult,
  StartBackgroundRunRequestInput,
  StartBackgroundRunResult,
  StartScheduledTaskRunResult,
  SyncWebLiveConversationRunRequestInput,
  SyncWebLiveConversationRunResult,
} from './types.js';

interface RequestEnvelope {
  id: string;
  type: string;
  [key: string]: unknown;
}

interface ResponseEnvelope {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

const DEFAULT_SOCKET_TIMEOUT_MS = 5000;

function getSocketPath(config?: DaemonConfig): string {
  const effectiveConfig = config ?? loadDaemonConfig();
  const paths = resolveDaemonPaths(effectiveConfig.ipc.socketPath);
  return paths.socketPath;
}

async function sendRequest<T>(request: RequestEnvelope, config?: DaemonConfig): Promise<T> {
  const socketPath = getSocketPath(config);

  return new Promise<T>((resolve, reject) => {
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

    socket.on('data', (chunk: Buffer | string) => {
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

      const parsed = JSON.parse(line) as ResponseEnvelope;

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
        resolve(parsed.result as T);
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

export async function pingDaemon(config?: DaemonConfig): Promise<boolean> {
  const transport = getTransport();
  if (transport) {
    try {
      return await transport.ping(config);
    } catch {
      return false;
    }
  }

  try {
    const result = await sendRequest<{ pong: true }>(
      {
        id: `req_${randomUUID()}`,
        type: 'ping',
      },
      config,
    );

    return result.pong === true;
  } catch {
    return false;
  }
}

export async function getDaemonStatus(config?: DaemonConfig): Promise<DaemonStatus> {
  const transport = getTransport();
  if (transport) {
    return transport.getStatus(config);
  }

  return sendRequest<DaemonStatus>(
    {
      id: `req_${randomUUID()}`,
      type: 'status',
    },
    config,
  );
}

export async function getCompanionUrl(config?: DaemonConfig): Promise<string | null> {
  const transport = getTransport();
  if (transport?.getCompanionUrl) {
    return transport.getCompanionUrl(config);
  }

  const resolvedConfig = config ?? loadDaemonConfig();
  if (resolvedConfig.companion?.enabled === false) {
    return null;
  }

  const host = resolvedConfig.companion?.host ?? DEFAULT_COMPANION_HOST;
  const port = resolvedConfig.companion?.port ?? 3843;
  const formattedHost = host.includes(':') ? `[${host}]` : host;
  return `http://${formattedHost}:${String(port)}`;
}

export async function updateCompanionConfig(
  input: { enabled?: boolean; host?: string; port?: number },
  config?: DaemonConfig,
): Promise<{ url: string | null }> {
  const transport = getTransport();
  if (transport?.updateCompanionConfig) {
    return transport.updateCompanionConfig(input, config);
  }

  return sendRequest<{ url: string | null }>(
    {
      id: `req_${randomUUID()}`,
      type: 'companion.updateConfig',
      input,
    },
    config,
  );
}

export async function stopDaemon(config?: DaemonConfig): Promise<void> {
  const transport = getTransport();
  if (transport) {
    await transport.stop(config);
    return;
  }

  await sendRequest<{ stopping: boolean }>(
    {
      id: `req_${randomUUID()}`,
      type: 'stop',
    },
    config,
  );
}

export async function listDurableRuns(config?: DaemonConfig): Promise<ListDurableRunsResult> {
  const transport = getTransport();
  if (transport) {
    return transport.listDurableRuns(config);
  }

  return sendRequest<ListDurableRunsResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.list',
    },
    config,
  );
}

export async function getDurableRun(runId: string, config?: DaemonConfig): Promise<GetDurableRunResult> {
  const transport = getTransport();
  if (transport) {
    return transport.getDurableRun(runId, config);
  }

  return sendRequest<GetDurableRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.get',
      runId,
    },
    config,
  );
}

export async function startScheduledTaskRun(taskId: string, config?: DaemonConfig): Promise<StartScheduledTaskRunResult> {
  const transport = getTransport();
  if (transport) {
    return transport.startScheduledTaskRun(taskId, config);
  }

  return sendRequest<StartScheduledTaskRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.startTask',
      taskId,
    },
    config,
  );
}

export async function startBackgroundRun(input: StartBackgroundRunRequestInput, config?: DaemonConfig): Promise<StartBackgroundRunResult> {
  const transport = getTransport();
  if (transport) {
    return transport.startBackgroundRun(input, config);
  }

  return sendRequest<StartBackgroundRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input,
    },
    config,
  );
}

export async function cancelDurableRun(runId: string, config?: DaemonConfig): Promise<CancelDurableRunResult> {
  const transport = getTransport();
  if (transport) {
    return transport.cancelDurableRun(runId, config);
  }

  return sendRequest<CancelDurableRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.cancel',
      runId,
    },
    config,
  );
}

export async function rerunDurableRun(runId: string, config?: DaemonConfig): Promise<ReplayDurableRunResult> {
  const transport = getTransport();
  if (transport) {
    return transport.rerunDurableRun(runId, config);
  }

  return sendRequest<ReplayDurableRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.rerun',
      runId,
    },
    config,
  );
}

export async function followUpDurableRun(runId: string, prompt?: string, config?: DaemonConfig): Promise<FollowUpDurableRunResult> {
  const normalizedPrompt = typeof prompt === 'string' && prompt.trim().length > 0 ? prompt.trim() : undefined;
  const transport = getTransport();
  if (transport) {
    return transport.followUpDurableRun(runId, normalizedPrompt, config);
  }

  return sendRequest<FollowUpDurableRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.followUp',
      runId,
      ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
    },
    config,
  );
}

export async function syncWebLiveConversationRunState(
  input: SyncWebLiveConversationRunRequestInput,
  config?: DaemonConfig,
): Promise<SyncWebLiveConversationRunResult> {
  const transport = getTransport();
  if (transport) {
    return transport.syncWebLiveConversationRunState(input, config);
  }

  return sendRequest<SyncWebLiveConversationRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'conversations.sync',
      input,
    },
    config,
  );
}

export async function listRecoverableWebLiveConversationRunsFromDaemon(
  config?: DaemonConfig,
): Promise<ListRecoverableWebLiveConversationRunsResult> {
  const transport = getTransport();
  if (transport) {
    return transport.listRecoverableWebLiveConversationRuns(config);
  }

  return sendRequest<ListRecoverableWebLiveConversationRunsResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'conversations.recoverable',
    },
    config,
  );
}

async function emitDaemonEnvelope(event: DaemonEvent, config?: DaemonConfig): Promise<boolean> {
  const transport = getTransport();
  if (transport) {
    return transport.emitEvent(event, config);
  }

  const result = await sendRequest<{ accepted: boolean }>(
    {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event,
    },
    config,
  );

  return result.accepted;
}

export async function emitDaemonEvent(input: DaemonEventInput, config?: DaemonConfig): Promise<boolean> {
  return emitDaemonEnvelope(createDaemonEvent(input), config);
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function formatDaemonUnavailableWarning(error: unknown, config?: DaemonConfig): string {
  const code = getErrorCode(error);

  if (code === 'ENOENT') {
    const socketPath = getSocketPath(config);
    return 'daemon is not running; background events are disabled. ' + `Start it with: pa daemon start (socket: ${socketPath})`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `daemon unavailable; continuing without background event (${message})`;
}

export async function emitDaemonEventNonFatal(input: DaemonEventInput, config?: DaemonConfig): Promise<void> {
  if (process.env.PERSONAL_AGENT_DISABLE_DAEMON_EVENTS === '1') {
    return;
  }

  try {
    const accepted = await emitDaemonEvent(input, config);
    if (!accepted) {
      logWarn('daemon queue is full; dropped event', { type: input.type });
      publishAppEvent({
        type: 'notification',
        extensionId: 'core',
        message: `Daemon queue dropped event: ${input.type}`,
        severity: 'warning',
      });
    }
  } catch (error) {
    logWarn('daemon unavailable; continuing without background event', { message: formatDaemonUnavailableWarning(error, config) });
    publishAppEvent({
      type: 'notification',
      extensionId: 'core',
      message: `Daemon unavailable: ${error instanceof Error ? error.message : String(error)}`,
      severity: 'warning',
    });
  }
}
