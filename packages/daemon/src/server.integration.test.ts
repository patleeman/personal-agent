/**
 * P0: Daemon server request handling integration tests
 * Tests IPC request/response flows including malformed requests
 */

import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnection } from 'net';
import { randomUUID } from 'crypto';
import { PersonalAgentDaemon } from './server.js';
import type { DaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import { createDurableRunManifest, createInitialDurableRunStatus, resolveDurableRunsRoot, resolveDurableRunPaths, saveDurableRunManifest, saveDurableRunStatus } from './runs/store.js';

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(socketPath: string): DaemonConfig {
  return {
    logLevel: 'error',
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

interface ResponseEnvelope {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

async function sendRequest(socketPath: string, request: unknown): Promise<ResponseEnvelope> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let buffer = '';

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();

      if (buffer.includes('\n')) {
        const line = buffer.slice(0, buffer.indexOf('\n')).trim();
        buffer = buffer.slice(buffer.indexOf('\n') + 1);

        try {
          const parsed = JSON.parse(line) as ResponseEnvelope;
          resolve(parsed);
          socket.end();
        } catch (error) {
          reject(error);
          socket.end();
        }
      }
    });

    socket.on('error', reject);
  });
}

describe('daemon IPC integration', () => {
  let daemon: PersonalAgentDaemon | null = null;
  let socketPath: string;
  let config: DaemonConfig;

  beforeEach(async () => {
    const tempDir = createTempDir('daemon-test-');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: join(tempDir, 'state'),
    };
    socketPath = join(tempDir, 'test.sock');
    config = createTestConfig(socketPath);
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    if (daemon) {
      await daemon.stop();
      daemon = null;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('responds to ping request', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ pong: true });
  });

  it('responds to status request', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'status',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      running: true,
      pid: expect.any(Number),
      socketPath: socketPath,
    });
    expect(response.result).toHaveProperty('startedAt');
    expect(response.result).toHaveProperty('queue');
    expect(response.result).toHaveProperty('modules');
  });

  it('lists durable runs with recovery metadata', async () => {
    const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
    const runsRoot = resolveDurableRunsRoot(daemonPaths.root);
    const runPaths = resolveDurableRunPaths(runsRoot, 'run-continue');
    mkdirSync(runPaths.root, { recursive: true, mode: 0o700 });
    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: 'run-continue',
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
      runId: 'run-continue',
      status: 'running',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 2,
    }));

    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.list',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      scannedAt: expect.any(String),
      summary: {
        total: 1,
        recoveryActions: {
          resume: 1,
        },
      },
      runs: [
        expect.objectContaining({
          runId: 'run-continue',
          recoveryAction: 'resume',
          problems: [],
        }),
      ],
    });
  });

  it('returns one durable run by id', async () => {
    const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
    const runsRoot = resolveDurableRunsRoot(daemonPaths.root);
    const runPaths = resolveDurableRunPaths(runsRoot, 'run-rerun');
    mkdirSync(runPaths.root, { recursive: true, mode: 0o700 });
    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: 'run-rerun',
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
      runId: 'run-rerun',
      status: 'interrupted',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 1,
    }));

    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.get',
      runId: 'run-rerun',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      scannedAt: expect.any(String),
      run: expect.objectContaining({
        runId: 'run-rerun',
        recoveryAction: 'rerun',
        problems: [],
      }),
    });
  });

  it('returns a not-started result when no tasks module handles runs.startTask', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startTask',
      filePath: '/tmp/run-now.task.md',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      accepted: false,
      runId: expect.any(String),
      reason: 'task run was not started',
    });
  });

  it('syncs and lists recoverable web live conversation runs', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const syncResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'conversations.sync',
      input: {
        conversationId: 'conv-123',
        sessionFile: '/tmp/conv-123.jsonl',
        cwd: '/tmp/workspace',
        profile: 'datadog',
        title: 'Recover this conversation',
        state: 'interrupted',
        pendingOperation: {
          type: 'prompt',
          text: 'keep going',
          enqueuedAt: '2026-03-12T17:00:00.000Z',
        },
      },
    });

    expect(syncResponse.ok).toBe(true);
    expect(syncResponse.result).toMatchObject({
      runId: 'conversation-live-conv-123',
    });

    const recoverableResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'conversations.recoverable',
    });

    expect(recoverableResponse.ok).toBe(true);
    expect(recoverableResponse.result).toMatchObject({
      runs: [
        expect.objectContaining({
          runId: 'conversation-live-conv-123',
          conversationId: 'conv-123',
          sessionFile: '/tmp/conv-123.jsonl',
          cwd: '/tmp/workspace',
          state: 'interrupted',
          pendingOperation: expect.objectContaining({
            type: 'prompt',
            text: 'keep going',
          }),
        }),
      ],
    });
  });

  it('returns an error when a durable run is missing', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.get',
      runId: 'missing-run',
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Run not found: missing-run');
  });

  it('responds to emit request with valid event', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: {
        id: `evt_${randomUUID()}`,
        version: 1,
        type: 'test.event',
        source: 'test',
        timestamp: new Date().toISOString(),
        payload: {},
      },
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      accepted: true,
    });
  });

  it('rejects emit request with invalid event envelope', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: {
        // Missing required fields: id, timestamp
        type: 'test.event',
        source: 'test',
      },
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Invalid event envelope');
  });

  it('pulls queued gateway notifications', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const emitResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'emit',
      event: {
        id: `evt_${randomUUID()}`,
        version: 1,
        type: 'gateway.notification',
        source: 'module:tasks',
        timestamp: new Date().toISOString(),
        payload: {
          gateway: 'telegram',
          destinationId: '123',
          messageThreadId: 22,
          message: 'Hello from task',
          taskId: 'daily-status',
          status: 'success',
        },
      },
    });

    expect(emitResponse.ok).toBe(true);

    let pullResponse: ResponseEnvelope | undefined;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      pullResponse = await sendRequest(socketPath, {
        id: `req_${randomUUID()}`,
        type: 'notifications.pull',
        gateway: 'telegram',
      });

      const notifications = (pullResponse.result as { notifications?: unknown[] } | undefined)?.notifications ?? [];
      if (notifications.length > 0) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(pullResponse?.ok).toBe(true);
    const pulled = (pullResponse?.result as { notifications: Array<Record<string, unknown>> }).notifications;
    expect(pulled.length).toBe(1);
    expect(pulled[0]).toMatchObject({
      gateway: 'telegram',
      destinationId: '123',
      messageThreadId: 22,
      message: 'Hello from task',
      taskId: 'daily-status',
      status: 'success',
    });

    const secondPull = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'notifications.pull',
      gateway: 'telegram',
    });

    expect(secondPull.ok).toBe(true);
    expect((secondPull.result as { notifications: unknown[] }).notifications).toEqual([]);
  });

  it('handles malformed JSON gracefully', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await new Promise<ResponseEnvelope>((resolve, reject) => {
      const socket = createConnection(socketPath);
      let buffer = '';

      socket.on('connect', () => {
        socket.write('this is not json\n');
      });

      socket.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();

        if (buffer.includes('\n')) {
          const line = buffer.slice(0, buffer.indexOf('\n')).trim();
          try {
            const parsed = JSON.parse(line) as ResponseEnvelope;
            resolve(parsed);
            socket.end();
          } catch (error) {
            reject(error);
            socket.end();
          }
        }
      });

      socket.on('error', reject);
    });

    expect(response.ok).toBe(false);
    expect(response.error).toBeDefined();
  });

  it('handles invalid request envelope', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      // Missing required fields: id, type
      foo: 'bar',
    });

    expect(response.ok).toBe(false);
    expect(response.error).toContain('Invalid request envelope');
  });

  it('creates and removes pid file on startup/shutdown', async () => {
    const configWithPidPath = {
      ...config,
      ipc: { socketPath: join(createTempDir('daemon-test-'), 'test.sock') },
    };

    const daemonPaths = resolveDaemonPaths(configWithPidPath.ipc.socketPath);
    const pidPath = daemonPaths.pidFile;

    daemon = new PersonalAgentDaemon(configWithPidPath);
    await daemon.start();

    expect(existsSync(pidPath)).toBe(true);
    const pidContent = readFileSync(pidPath, 'utf-8');
    expect(Number(pidContent)).toBe(process.pid);

    await daemon.stop();
    daemon = null;

    expect(existsSync(pidPath)).toBe(false);
  });

  it('removes stale socket on startup', async () => {
    const tempDir = createTempDir('daemon-test-');
    const staleSocketPath = join(tempDir, 'stale.sock');

    // Create a stale socket file
    writeFileSync(staleSocketPath, '');
    expect(existsSync(staleSocketPath)).toBe(true);

    const staleConfig: DaemonConfig = {
      ...config,
      ipc: { socketPath: staleSocketPath },
    };

    daemon = new PersonalAgentDaemon(staleConfig);
    await daemon.start();

    // Daemon should have removed the stale socket and created a new one
    expect(existsSync(staleSocketPath)).toBe(true); // New socket is a file now

    // Verify it's actually a socket by trying to connect
    const response = await sendRequest(staleSocketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(response.ok).toBe(true);
  });

  it('daemon remains stable after multiple malformed requests', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    // Send several malformed requests
    for (let i = 0; i < 5; i++) {
      const response = await sendRequest(socketPath, {
        id: `req_${randomUUID()}`,
        type: 'emit',
        event: { invalid: true }, // Missing required fields
      });
      expect(response.ok).toBe(false);
    }

    // Daemon should still respond to valid requests
    const validResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(validResponse.ok).toBe(true);
    expect(validResponse.result).toEqual({ pong: true });
  });
});
