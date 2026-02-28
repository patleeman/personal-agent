import { randomUUID } from 'crypto';
import { createConnection } from 'net';
import { createDaemonEvent } from './events.js';
import type { DaemonConfig } from './config.js';
import { loadDaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import type { DaemonEventInput, DaemonStatus } from './types.js';

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
        reject(new Error('Daemon returned empty response'));
        socket.end();
        return;
      }

      const parsed = JSON.parse(line) as ResponseEnvelope;

      if (!parsed.ok) {
        reject(new Error(parsed.error ?? 'Daemon request failed'));
        socket.end();
        return;
      }

      resolve(parsed.result as T);
      socket.end();
    });

    socket.on('error', (error) => {
      reject(error);
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
    console.warn(`daemon unavailable; continuing without background event (${(error as Error).message})`);
  }
}
