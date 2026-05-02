/**
 * P0: Daemon server request handling integration tests
 * Tests IPC request/response flows including malformed requests
 */

import { loadDeferredResumeState } from '@personal-agent/core';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { createConnection } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import { listPendingBackgroundRunResults } from './runs/background-run-deferred-resumes.js';
import {
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
} from './runs/store.js';
import { PersonalAgentDaemon } from './server.js';

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
    saveDurableRunManifest(
      runPaths.manifestPath,
      createDurableRunManifest({
        id: 'run-continue',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      runPaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'run-continue',
        status: 'running',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 2,
      }),
    );

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
    saveDurableRunManifest(
      runPaths.manifestPath,
      createDurableRunManifest({
        id: 'run-rerun',
        kind: 'scheduled-task',
        resumePolicy: 'rerun',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      runPaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'run-rerun',
        status: 'interrupted',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 1,
      }),
    );

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
      taskId: 'run-now',
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

    await waitFor(() => {
      const run = scanDurableRun(runsRoot, runId);
      return run?.status?.status === 'completed' && existsSync(run.paths.resultPath);
    });

    const run = scanDurableRun(runsRoot, runId);
    // argv runs are now stored as 'raw-shell' kind
    expect(run?.manifest?.kind).toMatch(/^(background-run|raw-shell)$/);
    expect(run?.status?.status).toBe('completed');
    expect(readFileSync(run?.paths.outputLogPath as string, 'utf-8')).toContain('hello from durable run');
    expect(existsSync(run?.paths.resultPath as string)).toBe(true);
  });

  it('reruns a stopped durable shell run', async () => {
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const firstResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startBackground',
      input: {
        taskSlug: 'rerun-shell-test',
        cwd: createTempDir('bg-run-rerun-cwd-'),
        argv: [process.execPath, '-e', "console.log('rerun-me')"],
        source: {
          type: 'test',
          id: 'rerun-shell-test',
        },
      },
    });

    expect(firstResponse.ok).toBe(true);
    const sourceRunId = (firstResponse.result as { runId: string }).runId;
    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths(config.ipc.socketPath).root);
    await waitFor(() => scanDurableRun(runsRoot, sourceRunId)?.status?.status === 'completed');

    const rerunResponse = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.rerun',
      runId: sourceRunId,
    });

    expect(rerunResponse.ok).toBe(true);
    expect(rerunResponse.result).toMatchObject({
      accepted: true,
      sourceRunId,
      runId: expect.any(String),
      logPath: expect.any(String),
    });

    const rerunId = (rerunResponse.result as { runId: string }).runId;
    expect(rerunId).not.toBe(sourceRunId);
    await waitFor(() => scanDurableRun(runsRoot, rerunId)?.status?.status === 'completed');
    expect(readFileSync(scanDurableRun(runsRoot, rerunId)?.paths.outputLogPath as string, 'utf-8')).toContain('rerun-me');
  });

  it('surfaces a pending background-run result when a resumable background run finishes', async () => {
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
    await waitFor(() => listPendingBackgroundRunResults({ runsRoot, sessionFile }).length === 1);

    const results = listPendingBackgroundRunResults({ runsRoot, sessionFile });
    expect(results).toHaveLength(1);
    expect(Object.values(loadDeferredResumeState().resumes)).toHaveLength(0);
    expect(results[0]?.runIds).toEqual([runId]);
    expect(results[0]?.prompt).toContain(runId);
    expect(results[0]?.prompt).toContain('Use run get/logs');

    const run = scanDurableRun(runsRoot, runId);
    const payload = run?.checkpoint?.payload as Record<string, unknown> | undefined;
    expect((payload?.backgroundRunResume as { batchId?: string } | undefined)?.batchId).toBe(results[0]?.id);
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
    expect(listPendingBackgroundRunResults({ runsRoot, sessionFile })).toEqual([]);

    await waitFor(() => scanDurableRun(runsRoot, slowRunId)?.status?.status === 'completed');
    await waitFor(() => listPendingBackgroundRunResults({ runsRoot, sessionFile }).length === 1);

    const results = listPendingBackgroundRunResults({ runsRoot, sessionFile });
    expect(results).toHaveLength(1);
    expect(results[0]?.prompt).toContain(slowRunId);
    expect(results[0]?.prompt).toContain(fastRunId);
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

  it('returns quickly from runs.startTask even when the event bus is slow', async () => {
    // The tasks module is disabled in the default config, so the event is published
    // but no handler picks it up.  The key assertion is that the IPC handler
    // returns within the client-side socket timeout (5 s) — it must not block
    // on `bus.waitForIdle()` while event handlers run.
    daemon = new PersonalAgentDaemon(config);
    await daemon.start();

    const startedAt = Date.now();
    const response = await sendRequest(socketPath, {
      id: `req_${randomUUID()}`,
      type: 'runs.startTask',
      taskId: 'slow-task',
    });
    const elapsed = Date.now() - startedAt;

    expect(response.ok).toBe(true);
    expect(elapsed).toBeLessThan(2000);
    expect(response.result).toMatchObject({
      accepted: false,
      runId: expect.any(String),
      reason: 'task run was not started',
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
