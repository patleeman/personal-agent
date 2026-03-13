import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DaemonConfig } from './config.js';
import { resolveDaemonPaths } from './paths.js';
import { resolveDurableRunsRoot, scanDurableRun } from './runs/store.js';
import type { TaskRunRequest, TaskRunResult } from './modules/tasks-runner.js';

const tempDirs: string[] = [];
const originalEnv = { ...process.env };

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function waitForCondition(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!check()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function createTestConfig(socketPath: string, taskDir: string): DaemonConfig {
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
        enabled: true,
        taskDir,
        tickIntervalSeconds: 30,
        maxRetries: 1,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };
}

function createTaskRunResult(
  request: TaskRunRequest,
  input: {
    success: boolean;
    cancelled?: boolean;
    error?: string;
    outputText?: string;
  },
): TaskRunResult {
  const nowIso = new Date().toISOString();
  const logPath = join(request.runsRoot, `${request.task.id}-attempt-${request.attempt}.log`);
  mkdirSync(request.runsRoot, { recursive: true });
  writeFileSync(logPath, `${input.outputText ?? input.error ?? 'task run'}\n`);

  return {
    success: input.success,
    startedAt: nowIso,
    endedAt: nowIso,
    exitCode: input.success ? 0 : 1,
    signal: input.cancelled ? 'SIGTERM' : null,
    timedOut: false,
    cancelled: input.cancelled ?? false,
    logPath,
    error: input.error,
    outputText: input.outputText,
  };
}

type DaemonServerModule = typeof import('./server.js');
type DaemonClientModule = typeof import('./client.js');

async function loadDaemonModules(taskRunnerMock: ReturnType<typeof vi.fn>): Promise<{
  server: DaemonServerModule;
  client: DaemonClientModule;
}> {
  vi.resetModules();
  vi.doMock('./modules/tasks-runner.js', () => ({
    runTaskInIsolatedPi: taskRunnerMock,
  }));

  const [server, client] = await Promise.all([
    import('./server.js'),
    import('./client.js'),
  ]);

  return { server, client };
}

describe('daemon scheduled-task recovery integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.doUnmock('./modules/tasks-runner.js');
    vi.resetModules();
    process.env = { ...originalEnv };
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('recovers an interrupted daemon-requested task run after daemon restart', async () => {
    const workspaceRoot = createTempDir('daemon-task-recovery-');
    const repoRoot = join(workspaceRoot, 'repo');
    const taskDir = join(repoRoot, 'profiles', 'datadog', 'agent', 'tasks');
    const stateRoot = join(workspaceRoot, 'state');
    const socketPath = join(workspaceRoot, 'daemon.sock');
    const taskPath = join(taskDir, 'recover-me.task.md');

    mkdirSync(taskDir, { recursive: true });
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
    };

    writeFileSync(taskPath, `---
id: recover-me
at: "2099-01-01T00:00:00.000Z"
profile: datadog
---
Recover me after daemon restart
`);

    const config = createTestConfig(socketPath, taskDir);
    const taskRunnerMock = vi.fn(async (request: TaskRunRequest) => {
      if (request.signal?.aborted) {
        return createTaskRunResult(request, {
          success: false,
          cancelled: true,
          error: 'Task run cancelled during shutdown',
          outputText: 'cancelled during shutdown',
        });
      }

      return new Promise<TaskRunResult>((resolve) => {
        request.signal?.addEventListener('abort', () => {
          resolve(createTaskRunResult(request, {
            success: false,
            cancelled: true,
            error: 'Task run cancelled during shutdown',
            outputText: 'cancelled during shutdown',
          }));
        }, { once: true });
      });
    });

    const { server, client } = await loadDaemonModules(taskRunnerMock);

    const daemon1 = new server.PersonalAgentDaemon(config);
    await daemon1.start();

    const firstRun = await client.startScheduledTaskRun(taskPath, config);
    expect(firstRun).toMatchObject({
      accepted: true,
      runId: expect.any(String),
    });

    await waitForCondition(() => taskRunnerMock.mock.calls.length === 1);
    await daemon1.stop();

    const daemonPaths = resolveDaemonPaths(config.ipc.socketPath);
    const runsRoot = resolveDurableRunsRoot(daemonPaths.root);
    const interruptedRun = scanDurableRun(runsRoot, firstRun.runId);
    expect(interruptedRun).toMatchObject({
      runId: firstRun.runId,
      recoveryAction: 'rerun',
      status: expect.objectContaining({
        status: 'interrupted',
      }),
    });

    const interruptedTaskState = JSON.parse(readFileSync(join(daemonPaths.root, 'task-state.json'), 'utf-8')) as {
      tasks: Record<string, { activeRunId?: string; lastRunId?: string; lastStatus?: string }>;
    };
    expect(interruptedTaskState.tasks[taskPath]).toMatchObject({
      activeRunId: firstRun.runId,
      lastRunId: firstRun.runId,
      lastStatus: 'skipped',
    });

    taskRunnerMock.mockReset();
    taskRunnerMock.mockImplementation(async (request: TaskRunRequest) => createTaskRunResult(request, {
      success: true,
      outputText: 'recovered successfully',
    }));

    const daemon2 = new server.PersonalAgentDaemon(config);
    await daemon2.start();

    await waitForCondition(() => taskRunnerMock.mock.calls.length === 1);

    const runIds = readdirSync(runsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(runIds).toContain(firstRun.runId);
    expect(runIds.length).toBeGreaterThanOrEqual(2);

    const recoveredRunId = runIds.find((runId) => runId !== firstRun.runId);
    expect(recoveredRunId).toBeDefined();

    const recoveredRun = scanDurableRun(runsRoot, recoveredRunId as string);
    expect(recoveredRun).toMatchObject({
      runId: recoveredRunId,
      recoveryAction: 'none',
      status: expect.objectContaining({
        status: 'completed',
      }),
    });

    const recoveredTaskState = JSON.parse(readFileSync(join(daemonPaths.root, 'task-state.json'), 'utf-8')) as {
      tasks: Record<string, {
        activeRunId?: string;
        lastRunId?: string;
        oneTimeResolvedStatus?: string;
        lastStatus?: string;
      }>;
    };
    expect(recoveredTaskState.tasks[taskPath]?.activeRunId).toBeUndefined();
    expect(recoveredTaskState.tasks[taskPath]?.lastRunId).toBe(recoveredRunId);
    expect(recoveredTaskState.tasks[taskPath]?.oneTimeResolvedStatus).toBe('success');
    expect(recoveredTaskState.tasks[taskPath]?.lastStatus).toBe('success');

    await daemon2.stop();
  });
});
