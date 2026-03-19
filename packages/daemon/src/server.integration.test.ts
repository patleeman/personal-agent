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
import { loadDeferredResumeState } from '@personal-agent/core';
import { PersonalAgentDaemon } from './server.js';
import type { DaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import { createDurableRunManifest, createInitialDurableRunStatus, resolveDurableRunsRoot, resolveDurableRunPaths, saveDurableRunManifest, saveDurableRunStatus, scanDurableRun } from './runs/store.js';

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

async function sendRequestAndDisconnect(socketPath: string, request: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      callback();
    };

    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`, () => {
        finish(() => {
          socket.destroy();
          resolve();
        });
      });
    });

    socket.on('error', (error) => {
      finish(() => {
        reject(error);
      });
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function createSessionFile(conversationId: string): string {
  const sessionDir = createTempDir('sessions-');
  const sessionFile = join(sessionDir, `${conversationId}.jsonl`);
  writeFileSync(sessionFile, `${JSON.stringify({ type: 'session', id: conversationId })}\n`, 'utf-8');
  return sessionFile;
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

  it('starts a durable background run and persists output', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        taskSlug: 'echo-test',
        cwd: createTempDir('bg-run-cwd-'),
        argv: [process.execPath, '-e', "console.log('hello from durable run')"],
        source: {
          type: 'test',
          id: 'echo-test',
        },
      },
    });

    expect(response.ok).toBe(true);
    expect(response.result).toMatchObject({
      accepted: true,
      runId: expect.stringContaining('run-echo-test-'),
      logPath: expect.any(String),
    });

    const runId = (response.result as { runId: string }).runId;
    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths(config.ipc.socketPath).root);

    await waitFor(() => scanDurableRun(runsRoot, runId)?.status?.status === 'completed');

    const run = scanDurableRun(runsRoot, runId);
    expect(run?.manifest?.kind).toBe('background-run');
    expect(run?.status?.status).toBe('completed');
    expect(readFileSync(run?.paths.outputLogPath as string, 'utf-8')).toContain('hello from durable run');
    expect(existsSync(run?.paths.resultPath as string)).toBe(true);
  });

  it('creates a ready deferred resume when a resumable background run finishes', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const sessionFile = createSessionFile('conv-run-resume');
    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        taskSlug: 'resume-test',
        cwd: createTempDir('bg-run-resume-cwd-'),
        argv: [process.execPath, '-e', "console.log('resume-ready')"],
        source: {
          type: 'tool',
          id: 'conv-run-resume',
          filePath: sessionFile,
        },
        checkpointPayload: {
          resumeParentOnExit: true,
        },
      },
    });

    expect(response.ok).toBe(true);
    const runId = (response.result as { runId: string }).runId;
    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths(config.ipc.socketPath).root);

    await waitFor(() => scanDurableRun(runsRoot, runId)?.status?.status === 'completed');
    await waitFor(() => Object.values(loadDeferredResumeState().resumes).some((entry) => entry.sessionFile === sessionFile && entry.status === 'ready'));

    const resumes = Object.values(loadDeferredResumeState().resumes)
      .filter((entry) => entry.sessionFile === sessionFile);

    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toMatchObject({
      sessionFile,
      status: 'ready',
    });
    expect(resumes[0]?.prompt).toContain(runId);
    expect(resumes[0]?.prompt).toContain('Use run get/logs');

    const run = scanDurableRun(runsRoot, runId);
    const payload = run?.checkpoint?.payload as Record<string, unknown> | undefined;
    expect((payload?.backgroundRunResume as { deferredResumeId?: string } | undefined)?.deferredResumeId).toBe(resumes[0]?.id);
  });

  it('creates a delegate-style deferred resume for gateway delegate runs', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const sessionFile = createSessionFile('conv-gateway-resume');
    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        taskSlug: 'delegate-review',
        cwd: createTempDir('bg-run-gateway-cwd-'),
        argv: [process.execPath, '-e', "console.log('delegate-ready')"],
        source: {
          type: 'gateway-delegate',
          id: 'telegram-1',
          filePath: sessionFile,
        },
        checkpointPayload: {
          resumeParentOnExit: true,
          notifyMode: 'resume',
          taskPrompt: 'Review the failing build and summarize the fix.',
        },
      },
    });

    expect(response.ok).toBe(true);
    await waitFor(() => Object.values(loadDeferredResumeState().resumes).some((entry) => entry.sessionFile === sessionFile && entry.status === 'ready'));

    const resumes = Object.values(loadDeferredResumeState().resumes)
      .filter((entry) => entry.sessionFile === sessionFile);

    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.prompt).toContain('Original delegated task:');
    expect(resumes[0]?.prompt).toContain('Review the failing build and summarize the fix.');
    expect(resumes[0]?.prompt).toContain('Use delegate get/logs');
  });

  it('batches resumable background runs until the last active run for the session stops', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const sessionFile = createSessionFile('conv-run-batch');
    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths(config.ipc.socketPath).root);
    const commonInput = {
      cwd: createTempDir('bg-run-batch-cwd-'),
      source: {
        type: 'tool',
        id: 'conv-run-batch',
        filePath: sessionFile,
      },
      checkpointPayload: {
        resumeParentOnExit: true,
      },
    };

    const slowResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        ...commonInput,
        taskSlug: 'slow-batch',
        argv: [process.execPath, '-e', "setTimeout(() => console.log('slow-ready'), 300)"],
      },
    });
    const fastResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        ...commonInput,
        taskSlug: 'fast-batch',
        argv: [process.execPath, '-e', "console.log('fast-ready')"],
      },
    });

    expect(slowResponse.ok).toBe(true);
    expect(fastResponse.ok).toBe(true);

    const slowRunId = (slowResponse.result as { runId: string }).runId;
    const fastRunId = (fastResponse.result as { runId: string }).runId;

    await waitFor(() => scanDurableRun(runsRoot, fastRunId)?.status?.status === 'completed');
    expect(Object.values(loadDeferredResumeState().resumes)).toHaveLength(0);

    await waitFor(() => scanDurableRun(runsRoot, slowRunId)?.status?.status === 'completed');
    await waitFor(() => Object.values(loadDeferredResumeState().resumes).some((entry) => entry.sessionFile === sessionFile && entry.status === 'ready'));

    const resumes = Object.values(loadDeferredResumeState().resumes)
      .filter((entry) => entry.sessionFile === sessionFile);

    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.prompt).toContain(slowRunId);
    expect(resumes[0]?.prompt).toContain(fastRunId);
  });

  it('cancels a durable background run', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        taskSlug: 'sleep-test',
        cwd: createTempDir('bg-run-sleep-cwd-'),
        argv: [process.execPath, '-e', 'setTimeout(() => {}, 10_000)'],
        source: {
          type: 'test',
          id: 'sleep-test',
        },
      },
    });

    expect(response.ok).toBe(true);
    const runId = (response.result as { runId: string }).runId;

    const cancelResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.cancel',
      runId,
    });

    expect(cancelResponse.ok).toBe(true);
    expect(cancelResponse.result).toMatchObject({
      cancelled: true,
      runId,
    });

    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths(config.ipc.socketPath).root);
    await waitFor(() => scanDurableRun(runsRoot, runId)?.status?.status === 'cancelled');
    expect(scanDurableRun(runsRoot, runId)?.status?.status).toBe('cancelled');
  });

  it('remains stable when an IPC client disconnects before a response is written', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    await sendRequestAndDisconnect(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        taskSlug: 'disconnect-test',
        cwd: createTempDir('bg-run-disconnect-cwd-'),
        argv: [process.execPath, '-e', "console.log('disconnect-safe')"],
        source: {
          type: 'test',
          id: 'disconnect-test',
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'ping',
    });

    expect(response.ok).toBe(true);
    expect(response.result).toEqual({ pong: true });
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
