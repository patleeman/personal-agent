import { EventEmitter } from 'events';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedTaskDefinition } from './tasks-parser.js';

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  buildPiResourceArgs: vi.fn(),
  materializeProfileToAgentDir: vi.fn(),
  resolveResourceProfile: vi.fn(),
  bootstrapStateOrThrow: vi.fn(),
  preparePiAgentDir: vi.fn(),
  resolveChildProcessEnv: vi.fn(),
  resolveStatePaths: vi.fn(),
  validateStatePathsOutsideRepo: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: mocks.spawn,
}));

vi.mock('@personal-agent/resources', () => ({
  buildPiResourceArgs: mocks.buildPiResourceArgs,
  materializeProfileToAgentDir: mocks.materializeProfileToAgentDir,
  resolveResourceProfile: mocks.resolveResourceProfile,
}));

vi.mock('@personal-agent/core', () => ({
  bootstrapStateOrThrow: mocks.bootstrapStateOrThrow,
  preparePiAgentDir: mocks.preparePiAgentDir,
  resolveChildProcessEnv: mocks.resolveChildProcessEnv,
  resolveStatePaths: mocks.resolveStatePaths,
  validateStatePathsOutsideRepo: mocks.validateStatePathsOutsideRepo,
}));

import { runTaskInIsolatedPi } from './tasks-runner.js';

interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createMockChildProcess(): MockChildProcess {
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function createTask(overrides: Partial<ParsedTaskDefinition> = {}): ParsedTaskDefinition {
  return {
    key: 'task.md',
    filePath: '/tmp/task.md',
    fileName: 'task.md',
    id: 'nightly-run',
    enabled: true,
    schedule: {
      type: 'cron',
      expression: '* * * * *',
      parsed: {
        raw: '* * * * *',
        minute: { values: new Set<number>(), wildcard: true },
        hour: { values: new Set<number>(), wildcard: true },
        dayOfMonth: { values: new Set<number>(), wildcard: true },
        month: { values: new Set<number>(), wildcard: true },
        dayOfWeek: { values: new Set<number>(), wildcard: true },
      },
    },
    prompt: 'Run nightly checks',
    profile: 'shared',
    timeoutSeconds: 60,
    ...overrides,
  };
}

async function waitForCondition(check: () => boolean, maxTicks = 2_000): Promise<void> {
  for (let tick = 0; tick < maxTicks; tick += 1) {
    if (check()) {
      return;
    }

    await Promise.resolve();
  }

  throw new Error('Timed out waiting for condition');
}

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();

  mocks.resolveStatePaths.mockReturnValue({
    root: '/tmp/state-root',
    authFile: '/tmp/auth.json',
  });
  mocks.bootstrapStateOrThrow.mockResolvedValue(undefined);
  mocks.preparePiAgentDir.mockResolvedValue({ agentDir: '/tmp/pi-agent' });
  mocks.resolveChildProcessEnv.mockImplementation((overrides: Record<string, string>) => ({
    ...process.env,
    ...overrides,
    PATH: '/interactive/bin:/usr/bin',
  }));
  mocks.materializeProfileToAgentDir.mockReturnValue(undefined);
  mocks.buildPiResourceArgs.mockReturnValue(['--profile', 'shared']);
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runTaskInIsolatedPi', () => {
  it('returns cancellation result when signal is already aborted before spawn', async () => {
    const repoRoot = createTempDir('tasks-runner-repo-');
    const runsRoot = createTempDir('tasks-runner-runs-');

    mocks.resolveResourceProfile.mockReturnValue({
      name: 'shared',
      repoRoot,
    });

    const controller = new AbortController();
    controller.abort();

    const result = await runTaskInIsolatedPi({
      task: createTask({ profile: 'shared' }),
      attempt: 1,
      runsRoot,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      success: false,
      cancelled: true,
      timedOut: false,
      exitCode: 1,
      error: 'Task run cancelled before spawn',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(existsSync(result.logPath)).toBe(true);
  });

  it('runs pi with profile args, captures output, and succeeds on exit code 0', async () => {
    const repoRoot = createTempDir('tasks-runner-repo-');
    const runsRoot = createTempDir('tasks-runner-runs-');

    const localPiCli = join(repoRoot, 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js');
    mkdirSync(join(repoRoot, 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist'), { recursive: true });
    writeFileSync(localPiCli, 'console.log("pi")');

    mocks.resolveResourceProfile.mockReturnValue({
      name: 'shared',
      repoRoot,
    });

    const child = createMockChildProcess();
    mocks.spawn.mockReturnValue(child);

    const promise = runTaskInIsolatedPi({
      task: createTask({ modelRef: 'provider/model-a', cwd: repoRoot }),
      attempt: 2,
      runsRoot,
    });

    await waitForCondition(() => mocks.spawn.mock.calls.length === 1);
    await waitForCondition(() => child.listenerCount('close') > 0 && child.listenerCount('error') > 0);

    child.stdout.emit('data', 'stdout line\n');
    child.stderr.emit('data', 'stderr line\n');
    child.emit('close', 0, null);

    const result = await promise;

    expect(result).toMatchObject({
      success: true,
      exitCode: 0,
      timedOut: false,
      cancelled: false,
      error: undefined,
    });
    expect(result.outputText).toContain('stdout line');
    expect(result.outputText).toContain('stderr line');

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.spawn).toHaveBeenCalledWith(
      process.execPath,
      expect.arrayContaining([
        localPiCli,
        '--profile',
        'shared',
        '--model',
        'provider/model-a',
        '-p',
        'Run nightly checks',
      ]),
      expect.objectContaining({
        cwd: repoRoot,
        env: expect.objectContaining({
          PI_CODING_AGENT_DIR: '/tmp/pi-agent',
          PERSONAL_AGENT_ACTIVE_PROFILE: 'shared',
          PERSONAL_AGENT_REPO_ROOT: repoRoot,
          PATH: '/interactive/bin:/usr/bin',
        }),
      }),
    );
    expect(mocks.resolveChildProcessEnv).toHaveBeenCalledWith({
      PI_CODING_AGENT_DIR: '/tmp/pi-agent',
      PERSONAL_AGENT_ACTIVE_PROFILE: 'shared',
      PERSONAL_AGENT_REPO_ROOT: repoRoot,
    });

    expect(mocks.validateStatePathsOutsideRepo).toHaveBeenCalledWith(
      expect.anything(),
      repoRoot,
    );
    expect(mocks.materializeProfileToAgentDir).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'shared' }),
      '/tmp/pi-agent',
    );

    const log = readFileSync(result.logPath, 'utf-8');
    expect(log).toContain('# task=nightly-run');
    expect(log).toContain('# success=true');
  });

  it('returns process error when spawn emits error', async () => {
    const repoRoot = createTempDir('tasks-runner-repo-');
    const runsRoot = createTempDir('tasks-runner-runs-');

    mocks.resolveResourceProfile.mockReturnValue({
      name: 'shared',
      repoRoot,
    });

    const child = createMockChildProcess();
    mocks.spawn.mockReturnValue(child);

    const promise = runTaskInIsolatedPi({
      task: createTask(),
      attempt: 1,
      runsRoot,
    });

    await waitForCondition(() => mocks.spawn.mock.calls.length === 1);
    await waitForCondition(() => child.listenerCount('error') > 0);

    child.emit('error', new Error('spawn failed'));

    const result = await promise;

    expect(result).toMatchObject({
      success: false,
      exitCode: 1,
      error: 'spawn failed',
    });
  });

  it('marks task as timed out and reports timeout error when execution exceeds timeout', async () => {
    vi.useFakeTimers();

    const repoRoot = createTempDir('tasks-runner-repo-');
    const runsRoot = createTempDir('tasks-runner-runs-');

    mocks.resolveResourceProfile.mockReturnValue({
      name: 'shared',
      repoRoot,
    });

    const child = createMockChildProcess();
    child.kill.mockImplementation((_signal?: string) => {
      child.emit('close', null, 'SIGTERM');
      return true;
    });
    mocks.spawn.mockReturnValue(child);

    const promise = runTaskInIsolatedPi({
      task: createTask({ timeoutSeconds: 0.01 }),
      attempt: 1,
      runsRoot,
    });

    await waitForCondition(() => mocks.spawn.mock.calls.length === 1);
    await waitForCondition(() => child.listenerCount('close') > 0);

    await vi.advanceTimersByTimeAsync(20);
    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result).toMatchObject({
      success: false,
      timedOut: true,
      cancelled: false,
      error: 'Task timed out after 0.01s',
    });
  });

  it('cancels an active task run when abort signal fires', async () => {
    const repoRoot = createTempDir('tasks-runner-repo-');
    const runsRoot = createTempDir('tasks-runner-runs-');

    mocks.resolveResourceProfile.mockReturnValue({
      name: 'shared',
      repoRoot,
    });

    const child = createMockChildProcess();
    child.kill.mockImplementation((_signal?: string) => {
      child.emit('close', null, 'SIGTERM');
      return true;
    });
    mocks.spawn.mockReturnValue(child);

    const controller = new AbortController();

    const promise = runTaskInIsolatedPi({
      task: createTask(),
      attempt: 1,
      runsRoot,
      signal: controller.signal,
    });

    await waitForCondition(() => mocks.spawn.mock.calls.length === 1);
    await waitForCondition(() => child.listenerCount('close') > 0);

    controller.abort();

    const result = await promise;

    expect(result).toMatchObject({
      success: false,
      cancelled: true,
      timedOut: false,
      error: 'Task run cancelled',
    });
  });

  it('returns fatal error when profile resolution fails before spawn', async () => {
    const runsRoot = createTempDir('tasks-runner-runs-');
    mocks.resolveResourceProfile.mockImplementation(() => {
      throw new Error('profile not found');
    });

    const result = await runTaskInIsolatedPi({
      task: createTask(),
      attempt: 1,
      runsRoot,
    });

    expect(result).toMatchObject({
      success: false,
      exitCode: 1,
      error: 'profile not found',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('truncates captured output to keep result payload bounded', async () => {
    const repoRoot = createTempDir('tasks-runner-repo-');
    const runsRoot = createTempDir('tasks-runner-runs-');

    mocks.resolveResourceProfile.mockReturnValue({
      name: 'shared',
      repoRoot,
    });

    const child = createMockChildProcess();
    mocks.spawn.mockReturnValue(child);

    const promise = runTaskInIsolatedPi({
      task: createTask(),
      attempt: 1,
      runsRoot,
    });

    await waitForCondition(() => mocks.spawn.mock.calls.length === 1);
    await waitForCondition(() => child.listenerCount('close') > 0 && child.listenerCount('error') > 0);

    child.stdout.emit('data', 'x'.repeat(17_000));
    child.emit('close', 1, null);

    const result = await promise;

    expect(result.outputText).toBeDefined();
    expect(result.outputText).toContain('[output truncated]');
    expect(result.error).toBe('pi exited with code 1');
  });
});
