import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
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

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('tasks command status rendering', () => {
  it('shows completed for one-time tasks that already finished successfully', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const taskDir = createTempDir('personal-agent-cli-tasks-');

    const daemonConfigPath = join(configDir, 'daemon.json');
    writeFile(
      daemonConfigPath,
      JSON.stringify({
        modules: {
          tasks: {
            taskDir,
          },
        },
      }),
    );

    const oneTimeTaskPath = join(taskDir, 'one-time-check.task.md');
    writeFile(
      oneTimeTaskPath,
      `---
id: one-time-check
at: "2026-03-02T18:46:44-05:00"
---
Completed one-time task.
`,
    );

    const recurringTaskPath = join(taskDir, 'recurring-check.task.md');
    writeFile(
      recurringTaskPath,
      `---
id: recurring-check
cron: "0 7 * * *"
---
Recurring task.
`,
    );

    const stateFilePath = join(stateRoot, 'daemon', 'task-state.json');
    writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        tasks: {
          [oneTimeTaskPath]: {
            id: 'one-time-check',
            filePath: oneTimeTaskPath,
            scheduleType: 'at',
            running: false,
            lastStatus: 'success',
            lastRunAt: '2026-03-02T23:59:20.002Z',
            oneTimeResolvedAt: '2026-03-02T23:59:20.002Z',
            oneTimeResolvedStatus: 'success',
            oneTimeCompletedAt: '2026-03-02T23:59:20.002Z',
          },
        },
      }),
    );

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['--plain', 'tasks', 'list']);

    expect(exitCode).toBe(0);

    const oneTimeLine = logs.find((line) => line.includes('one-time-check:'));
    expect(oneTimeLine).toBeDefined();
    expect(oneTimeLine).toContain('[completed]');

    const recurringLine = logs.find((line) => line.includes('recurring-check:'));
    expect(recurringLine).toBeDefined();
    expect(recurringLine).toContain('[active]');

    logSpy.mockRestore();
  });

  it('uses oneTimeResolvedStatus=success as completed fallback for older state files', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const taskDir = createTempDir('personal-agent-cli-tasks-');

    const daemonConfigPath = join(configDir, 'daemon.json');
    writeFile(
      daemonConfigPath,
      JSON.stringify({
        modules: {
          tasks: {
            taskDir,
          },
        },
      }),
    );

    const oneTimeTaskPath = join(taskDir, 'legacy-one-time.task.md');
    writeFile(
      oneTimeTaskPath,
      `---
id: legacy-one-time
at: "2026-03-02T18:46:44-05:00"
---
Legacy one-time task.
`,
    );

    const stateFilePath = join(stateRoot, 'daemon', 'task-state.json');
    writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        tasks: {
          [oneTimeTaskPath]: {
            id: 'legacy-one-time',
            filePath: oneTimeTaskPath,
            scheduleType: 'at',
            running: false,
            lastStatus: 'success',
            lastRunAt: '2026-03-02T23:59:20.002Z',
            oneTimeResolvedAt: '2026-03-02T23:59:20.002Z',
            oneTimeResolvedStatus: 'success',
          },
        },
      }),
    );

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['--plain', 'tasks', 'list']);

    expect(exitCode).toBe(0);

    const oneTimeLine = logs.find((line) => line.includes('legacy-one-time:'));
    expect(oneTimeLine).toBeDefined();
    expect(oneTimeLine).toContain('[completed]');

    logSpy.mockRestore();
  });

  it('supports --status filtering in json output and includes a completed section', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const taskDir = createTempDir('personal-agent-cli-tasks-');

    const daemonConfigPath = join(configDir, 'daemon.json');
    writeFile(
      daemonConfigPath,
      JSON.stringify({
        modules: {
          tasks: {
            taskDir,
          },
        },
      }),
    );

    const completedTaskPath = join(taskDir, 'completed.task.md');
    writeFile(
      completedTaskPath,
      `---
id: completed
at: "2026-03-02T18:46:44-05:00"
---
Completed one-time task.
`,
    );

    const failedTaskPath = join(taskDir, 'failed.task.md');
    writeFile(
      failedTaskPath,
      `---
id: failed
cron: "0 7 * * *"
---
Failed task.
`,
    );

    const stateFilePath = join(stateRoot, 'daemon', 'task-state.json');
    writeFile(
      stateFilePath,
      JSON.stringify({
        version: 1,
        tasks: {
          [completedTaskPath]: {
            id: 'completed',
            filePath: completedTaskPath,
            scheduleType: 'at',
            running: false,
            lastStatus: 'success',
            oneTimeResolvedStatus: 'success',
            oneTimeCompletedAt: '2026-03-02T23:59:20.002Z',
          },
          [failedTaskPath]: {
            id: 'failed',
            filePath: failedTaskPath,
            scheduleType: 'cron',
            running: false,
            lastStatus: 'failed',
          },
        },
      }),
    );

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['tasks', 'list', '--json', '--status', 'error']);
    expect(exitCode).toBe(0);

    const payload = JSON.parse(logs[0] as string) as {
      filters: {
        status: string;
        supportedStatus: string[];
      };
      tasks: Array<{ id: string; status: string }>;
      sections: {
        completed: Array<{ id: string; status: string }>;
      };
    };

    expect(payload.filters.status).toBe('error');
    expect(payload.filters.supportedStatus).toContain('completed');
    expect(payload.tasks).toHaveLength(1);
    expect(payload.tasks[0]).toMatchObject({ id: 'failed', status: 'error' });
    expect(payload.sections.completed).toHaveLength(1);
    expect(payload.sections.completed[0]).toMatchObject({ id: 'completed', status: 'completed' });

    logSpy.mockRestore();
  });

  it('finds task logs from durable run directories when runtime state lacks a lastLogPath', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const taskDir = createTempDir('personal-agent-cli-tasks-');

    const daemonConfigPath = join(configDir, 'daemon.json');
    writeFile(
      daemonConfigPath,
      JSON.stringify({
        modules: {
          tasks: {
            taskDir,
          },
        },
      }),
    );

    const taskPath = join(taskDir, 'nightly.task.md');
    writeFile(
      taskPath,
      `---
id: nightly
cron: "0 7 * * *"
---
Nightly task.
`,
    );

    const runsRoot = resolveDurableRunsRoot(join(stateRoot, 'daemon'));
    const runPaths = resolveDurableRunPaths(runsRoot, 'task-nightly-2026-03-02T10-00-10-000Z-abcd1234');
    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: 'task-nightly-2026-03-02T10-00-10-000Z-abcd1234',
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: '2026-03-02T10:00:00.000Z',
      spec: {
        taskId: 'nightly',
      },
      source: {
        type: 'scheduled-task',
        id: 'nightly',
        filePath: taskPath,
      },
    }));
    saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
      runId: 'task-nightly-2026-03-02T10-00-10-000Z-abcd1234',
      status: 'completed',
      createdAt: '2026-03-02T10:00:00.000Z',
      updatedAt: '2026-03-02T10:00:10.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-02T10:00:01.000Z',
      completedAt: '2026-03-02T10:00:10.000Z',
    }));
    writeFile(runPaths.outputLogPath, 'nightly durable output\n');

    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['--plain', 'tasks', 'logs', 'nightly']);

    expect(exitCode).toBe(0);
    expect(logs.some((line) => line.includes('Task logs: nightly'))).toBe(true);
    expect(logs.some((line) => line.includes(runPaths.outputLogPath))).toBe(true);
    expect(logs.some((line) => line.includes('nightly durable output'))).toBe(true);

    logSpy.mockRestore();
  });

  it('rejects invalid --status values for tasks list', async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    const exitCode = await runCli(['tasks', 'list', '--status', 'not-a-status']);
    expect(exitCode).toBe(1);
    expect(errors.some((line) => line.includes('Usage: pa tasks list'))).toBe(true);

    errorSpy.mockRestore();
  });
});
