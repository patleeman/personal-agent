import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DaemonConfig } from '../config.js';
import { PersonalAgentDaemon } from './server.js';

const tempDirs: string[] = [];
let daemon: PersonalAgentDaemon | undefined;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(socketPath: string): DaemonConfig {
  return {
    logLevel: 'info',
    queue: { maxDepth: 100 },
    ipc: { socketPath },
    modules: {
      maintenance: {
        enabled: false,
        cleanupIntervalMinutes: 60,
      },
      tasks: {
        enabled: false,
        taskDir: join(createTempDir('tasks-'), 'definitions'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };
}

describe('daemon logging', () => {
  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = undefined;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('writes daemon log lines to both console and configured log sink', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sink = vi.fn();
    const socketPath = join(createTempDir('daemon-logging-'), 'personal-agentd.sock');

    daemon = new PersonalAgentDaemon({ config: createTestConfig(socketPath), stopRequestBehavior: 'reject', logSink: sink });
    await daemon.start();

    const consoleLines = vi.mocked(console.log).mock.calls.map(([line]) => String(line));
    const sinkLines = sink.mock.calls.map(([line]) => String(line));

    expect(consoleLines.some((line) => line.includes('personal-agentd started'))).toBe(true);
    expect(sinkLines.some((line) => line.includes('personal-agentd started'))).toBe(true);
  });

  it('stops even when an IPC client keeps the socket open', async () => {
    const socketPath = join(createTempDir('daemon-stop-open-socket-'), 'personal-agentd.sock');
    daemon = new PersonalAgentDaemon({ config: createTestConfig(socketPath), stopRequestBehavior: 'reject' });
    await daemon.start();

    const socket = createConnection(socketPath);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('error', reject);
    });

    await expect(daemon.stop()).resolves.toBeUndefined();
    expect(daemon.isRunning()).toBe(false);
    socket.destroy();
    daemon = undefined;
  });
});
