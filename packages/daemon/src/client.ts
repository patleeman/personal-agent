import { randomUUID } from 'crypto';
import { createConnection } from 'net';
import { createDaemonEvent } from './events.js';
import type { DaemonConfig } from './config.js';
import { loadDaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import type {
  DaemonEventInput,
  DaemonStatus,
  GatewayNotification,
  GatewayNotificationProvider,
  ListDurableRunsResult,
  GetDurableRunResult,
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

export async function pingDaemon(config?: DaemonConfig): Promise<boolean> {
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
  return sendRequest<DaemonStatus>(
    {
      id: `req_${randomUUID()}`,
      type: 'status',
    },
    config,
  );
}

export async function stopDaemon(config?: DaemonConfig): Promise<void> {
  await sendRequest<{ stopping: boolean }>(
    {
      id: `req_${randomUUID()}`,
      type: 'stop',
    },
    config,
  );
}

export async function pullGatewayNotifications(
  input: {
    gateway: GatewayNotificationProvider;
    limit?: number;
  },
  config?: DaemonConfig,
): Promise<GatewayNotification[]> {
  const result = await sendRequest<{ notifications: GatewayNotification[] }>(
    {
      id: `req_${randomUUID()}`,
      type: 'notifications.pull',
      gateway: input.gateway,
      limit: input.limit,
    },
    config,
  );

  return result.notifications;
}

export async function listDurableRuns(config?: DaemonConfig): Promise<ListDurableRunsResult> {
  return sendRequest<ListDurableRunsResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.list',
    },
    config,
  );
}

export async function getDurableRun(runId: string, config?: DaemonConfig): Promise<GetDurableRunResult> {
  return sendRequest<GetDurableRunResult>(
    {
      id: `req_${randomUUID()}`,
      type: 'runs.get',
      runId,
    },
    config,
  );
}

export async function emitDaemonEvent(input: DaemonEventInput, config?: DaemonConfig): Promise<boolean> {
  const event = createDaemonEvent(input);
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
    return (
      'daemon is not running; background events are disabled. ' +
      `Start it with: pa daemon start (socket: ${socketPath})`
    );
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
      console.warn(`daemon queue is full; dropped event type=${input.type}`);
    }
  } catch (error) {
    console.warn(formatDaemonUnavailableWarning(error, config));
  }
}
