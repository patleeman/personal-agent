import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { createServer, type Server } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDefaultDaemonConfig } from './config.js';
import {
  cancelDurableRun,
  emitDaemonEvent,
  emitDaemonEventNonFatal,
  followUpDurableRun,
  getDaemonStatus,
  getDurableRun,
  listDurableRuns,
  listRecoverableWebLiveConversationRunsFromDaemon,
  pingDaemon,
  rerunDurableRun,
  startBackgroundRun,
  startScheduledTaskRun,
  stopDaemon,
  syncWebLiveConversationRunState,
} from './client.js';
import type { DaemonConfig } from './config.js';

const originalEnv = process.env;
const tempDirs: string[] = [];
const servers: Server[] = [];

type MockDaemonRequest = Record<string, unknown>;
type MockDaemonResponse = 'close' | 'empty' | { ok: boolean; result?: unknown; error?: string };

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function startMockDaemonServer(
  handler: (request: MockDaemonRequest) => Promise<MockDaemonResponse> | MockDaemonResponse,
): Promise<{ config: DaemonConfig; requests: MockDaemonRequest[] }> {
  const requests: MockDaemonRequest[] = [];
  const socketPath = join(createTempDir('personal-agent-daemon-client-'), 'daemon.sock');
  const server = createServer((socket) => {
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) {
        return;
      }

      const line = buffer.slice(0, buffer.indexOf('\n')).trim();
      buffer = '';
      const request = JSON.parse(line) as MockDaemonRequest;
      requests.push(request);

      const response = await handler(request);
      if (response === 'close') {
        socket.end();
        return;
      }

      if (response === 'empty') {
        socket.write('\n');
        socket.end();
        return;
      }

      socket.write(`${JSON.stringify({ id: request.id, ...response })}\n`);
      socket.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => resolve());
  });

  servers.push(server);

  const config = getDefaultDaemonConfig();
  config.ipc.socketPath = socketPath;
  return { config, requests };
}

afterEach(async () => {
  process.env = originalEnv;
  await Promise.allSettled(servers.splice(0).map((server) => closeServer(server)));
  await Promise.allSettled(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('client daemon ipc helpers', () => {
  it('round-trips daemon requests across the exported client helpers', async () => {
    const status = { pid: 42, startedAt: '2026-04-09T00:00:00.000Z' };
    const runsList = { scannedAt: '2026-04-09T00:00:00.000Z', runs: [], summary: { total: 0 } };
    const recoverableRuns = { runs: [{ runId: 'web-live-1' }] };
    const durableRun = { scannedAt: '2026-04-09T00:00:00.000Z', run: { id: 'run-1' } };
    const { config, requests } = await startMockDaemonServer((request) => {
      switch (request.type) {
        case 'ping':
          return { ok: true, result: { pong: true } };
        case 'status':
          return { ok: true, result: status };
        case 'stop':
          return { ok: true, result: { stopping: true } };
        case 'runs.list':
          return { ok: true, result: runsList };
        case 'runs.get':
          return { ok: true, result: durableRun };
        case 'runs.startTask':
          return { ok: true, result: { accepted: true, runId: 'task-run-1' } };
        case 'runs.startBackground':
          return { ok: true, result: { accepted: true, runId: 'background-run-1' } };
        case 'runs.cancel':
          return { ok: true, result: { cancelled: true, runId: request.runId } };
        case 'runs.rerun':
          return { ok: true, result: { accepted: true, runId: 'rerun-1', sourceRunId: request.runId } };
        case 'runs.followUp':
          return { ok: true, result: { accepted: true, runId: 'follow-up-1', sourceRunId: request.runId } };
        case 'conversations.sync':
          return { ok: true, result: { runId: 'web-live-1' } };
        case 'conversations.recoverable':
          return { ok: true, result: recoverableRuns };
        case 'emit':
          return { ok: true, result: { accepted: true } };
        default:
          throw new Error(`Unexpected request type: ${String(request.type)}`);
      }
    });

    await expect(pingDaemon(config)).resolves.toBe(true);
    await expect(getDaemonStatus(config)).resolves.toEqual(status);
    await expect(stopDaemon(config)).resolves.toBeUndefined();
    await expect(listDurableRuns(config)).resolves.toEqual(runsList);
    await expect(getDurableRun('run-1', config)).resolves.toEqual(durableRun);
    await expect(startScheduledTaskRun('task-1', config)).resolves.toEqual({ accepted: true, runId: 'task-run-1' });
    await expect(
      startBackgroundRun(
        {
          taskSlug: 'repo-test-backfill',
          cwd: '/tmp/worktree',
          argv: ['npm', 'test'],
          source: { type: 'cli', id: 'manual' },
        },
        config,
      ),
    ).resolves.toEqual({ accepted: true, runId: 'background-run-1' });
    await expect(cancelDurableRun('run-1', config)).resolves.toEqual({ cancelled: true, runId: 'run-1' });
    await expect(rerunDurableRun('run-1', config)).resolves.toEqual({ accepted: true, runId: 'rerun-1', sourceRunId: 'run-1' });
    await expect(followUpDurableRun('run-1', '  continue this run  ', config)).resolves.toEqual({
      accepted: true,
      runId: 'follow-up-1',
      sourceRunId: 'run-1',
    });
    await expect(followUpDurableRun('run-2', '   ', config)).resolves.toEqual({
      accepted: true,
      runId: 'follow-up-1',
      sourceRunId: 'run-2',
    });
    await expect(
      syncWebLiveConversationRunState(
        {
          conversationId: 'conv-1',
          sessionFile: '/tmp/session.jsonl',
          cwd: '/tmp/worktree',
          state: 'running',
        },
        config,
      ),
    ).resolves.toEqual({ runId: 'web-live-1' });
    await expect(listRecoverableWebLiveConversationRunsFromDaemon(config)).resolves.toEqual(recoverableRuns);
    await expect(emitDaemonEvent({ type: 'pi.run.completed', source: 'cli' }, config)).resolves.toBe(true);

    expect(requests.map((request) => request.type)).toEqual([
      'ping',
      'status',
      'stop',
      'runs.list',
      'runs.get',
      'runs.startTask',
      'runs.startBackground',
      'runs.cancel',
      'runs.rerun',
      'runs.followUp',
      'runs.followUp',
      'conversations.sync',
      'conversations.recoverable',
      'emit',
    ]);
    expect(requests[9]).toMatchObject({ type: 'runs.followUp', runId: 'run-1', prompt: 'continue this run' });
    expect(requests[10]).toMatchObject({ type: 'runs.followUp', runId: 'run-2' });
    expect(requests[10]).not.toHaveProperty('prompt');
    expect(requests[13]).toMatchObject({
      type: 'emit',
      event: expect.objectContaining({ type: 'pi.run.completed', source: 'cli' }),
    });
  });

  it('returns false when ping cannot connect to the daemon', async () => {
    const config = getDefaultDaemonConfig();
    config.ipc.socketPath = join(tmpdir(), `missing-personal-agentd-${Date.now()}.sock`);

    await expect(pingDaemon(config)).resolves.toBe(false);
  });

  it('surfaces daemon error, empty, and closed responses', async () => {
    let requestCount = 0;
    const { config } = await startMockDaemonServer(() => {
      requestCount += 1;

      if (requestCount === 1) {
        return { ok: false, error: 'status unavailable' };
      }

      if (requestCount === 2) {
        return 'empty';
      }

      return 'close';
    });

    await expect(getDaemonStatus(config)).rejects.toThrow('status unavailable');
    await expect(stopDaemon(config)).rejects.toThrow('Daemon returned empty response');
    await expect(listDurableRuns(config)).rejects.toThrow('Daemon connection closed without response');
  });
});

describe('emitDaemonEventNonFatal', () => {
  it('prints actionable warning when daemon socket is missing', async () => {
    process.env = { ...originalEnv };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = getDefaultDaemonConfig();
    config.ipc.socketPath = join(tmpdir(), `missing-personal-agentd-${Date.now()}.sock`);

    await emitDaemonEventNonFatal(
      {
        type: 'pi.run.completed',
        source: 'cli',
      },
      config,
    );

    expect(warn).toHaveBeenCalledTimes(1);

    const message = String(warn.mock.calls[0]?.[0] ?? '');
    expect(message).toContain('daemon is not running');
    expect(message).toContain('pa daemon start');
  });

  it('warns when the daemon event queue is full', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { config } = await startMockDaemonServer(() => ({ ok: true, result: { accepted: false } }));

    await emitDaemonEventNonFatal(
      {
        type: 'pi.run.completed',
        source: 'cli',
      },
      config,
    );

    expect(warn).toHaveBeenCalledWith('daemon queue is full; dropped event type=pi.run.completed');
  });

  it('does nothing when daemon events are disabled', async () => {
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    };

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const config = getDefaultDaemonConfig();
    config.ipc.socketPath = join(tmpdir(), `missing-personal-agentd-${Date.now()}.sock`);

    await emitDaemonEventNonFatal(
      {
        type: 'pi.run.completed',
        source: 'cli',
      },
      config,
    );

    expect(warn).not.toHaveBeenCalled();
  });
});
