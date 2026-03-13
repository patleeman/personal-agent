import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalAgentDaemon, type DaemonConfig } from '@personal-agent/daemon';
import { runCli } from './index.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(socketPath: string, stateRoot: string): DaemonConfig {
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
        taskDir: join(stateRoot, 'tasks'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };
}

describe('runs CLI lifecycle commands', () => {
  let daemon: PersonalAgentDaemon | null = null;

  beforeEach(async () => {
    const stateRoot = createTempDir('pa-runs-command-state-');
    const socketPath = join(createTempDir('pa-runs-command-socket-'), 'daemon.sock');
    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_CONFIG: join(createTempDir('pa-daemon-config-'), 'daemon.json'),
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
      PI_SESSION_DIR: createTempDir('pi-session-'),
    };

    daemon = new PersonalAgentDaemon(createTestConfig(socketPath, stateRoot));
    await daemon.start();
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (daemon) {
      await daemon.stop();
      daemon = null;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
    vi.restoreAllMocks();
  });

  it('starts durable background runs via pa runs start', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli([
      'runs',
      'start',
      'code-review',
      '--',
      process.execPath,
      '-e',
      "console.log('hello from cli run')",
    ]);

    expect(exitCode).toBe(0);
    const output = logs.join('\n');
    expect(output).toContain('Durable run started');
    expect(output).toContain('Run');
    expect(output).toContain('Log');
  });

  it('cancels durable background runs via pa runs cancel', async () => {
    const startLogs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      startLogs.push(String(message ?? ''));
    });

    const startExitCode = await runCli([
      'runs',
      'start',
      'sleeping-run',
      '--',
      process.execPath,
      '-e',
      'setTimeout(() => {}, 10_000)',
    ]);

    expect(startExitCode).toBe(0);
    const runLine = startLogs.find((line) => line.includes('Run')) ?? '';
    const runId = runLine.split(/\s+/).at(-1) ?? '';
    expect(runId).toContain('run-sleeping-run-');

    const cancelLogs: string[] = [];
    vi.restoreAllMocks();
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      cancelLogs.push(String(message ?? ''));
    });

    const cancelExitCode = await runCli(['runs', 'cancel', runId]);

    expect(cancelExitCode).toBe(0);
    expect(cancelLogs.join('\n')).toContain('Durable run cancelled');
    expect(cancelLogs.join('\n')).toContain(runId);
  });
});
