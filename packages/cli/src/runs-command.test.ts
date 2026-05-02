import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
} from '@personal-agent/daemon';
import { runCli } from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createSampleRun(stateRoot: string, runId = 'task-daily-2026-03-12'): string {
  const runsRoot = resolveDurableRunsRoot(join(stateRoot, 'daemon'));
  const runPaths = resolveDurableRunPaths(runsRoot, runId);

  mkdirSync(runPaths.root, { recursive: true, mode: 0o700 });
  saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
    id: runId,
    kind: 'scheduled-task',
    resumePolicy: 'rerun',
    createdAt: '2026-03-12T18:00:00Z',
    source: {
      type: 'scheduled-task',
      id: 'daily-report',
      filePath: '/repo/profiles/datadog/agent/tasks/daily-report.task.md',
    },
  }));
  saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
    runId,
    status: 'completed',
    createdAt: '2026-03-12T18:00:00Z',
    updatedAt: '2026-03-12T18:05:00Z',
    activeAttempt: 1,
    startedAt: '2026-03-12T18:00:05Z',
  }));
  saveDurableRunCheckpoint(runPaths.checkpointPath, {
    version: 1,
    runId,
    updatedAt: '2026-03-12T18:05:00Z',
    step: 'completed',
    cursor: 'batch-4',
    payload: {
      taskId: 'daily-report',
    },
  });
  writeFileSync(runPaths.outputLogPath, 'first line\nsecond line\nthird line\n');

  return runId;
}

beforeEach(() => {
  const stateRoot = createTempDir('pa-cli-runs-state-');
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('runs CLI command', () => {
  it('renders durable runs for pa runs list', async () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const runId = createSampleRun(stateRoot);

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['runs', 'list']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Durable runs'))).toBe(true);
    expect(logs.some((line) => line.includes(runId))).toBe(true);
    expect(logs.some((line) => line.includes('scheduled-task'))).toBe(true);
  });

  it('shows one durable run for pa runs show', async () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const runId = createSampleRun(stateRoot, 'task-nightly-2026-03-12');

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['runs', 'show', runId]);

    expect(exitCode).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain(`Run: ${runId}`);
    expect(output).toContain('Recovery action');
    expect(output).toContain('Output log');
    expect(output).toContain('Checkpoint');
    expect(output).toContain('batch-4');
  });

  it('prints run logs for pa runs logs', async () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const runId = createSampleRun(stateRoot, 'task-logs-2026-03-12');

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['runs', 'logs', runId, '--tail', '3']);

    expect(exitCode).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain(`Run logs: ${runId}`);
    expect(output).toContain('second line');
    expect(output).toContain('third line');
    expect(output).not.toContain('first line');
  });

  it('returns json output for pa runs list --json', async () => {
    const stateRoot = process.env.PERSONAL_AGENT_STATE_ROOT as string;
    const runId = createSampleRun(stateRoot, 'task-json-2026-03-12');

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['runs', 'list', '--json']);

    expect(exitCode).toBe(0);
    const payload = JSON.parse(logs[0] as string) as {
      runs: Array<{ runId: string }>;
      runsRoot: string;
    };
    expect(payload.runs.some((run) => run.runId === runId)).toBe(true);
    expect(payload.runsRoot).toContain(join(stateRoot, 'daemon', 'runs'));
  });
});
