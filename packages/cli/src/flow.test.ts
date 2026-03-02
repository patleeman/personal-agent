import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function createTestRepo(): string {
  const repo = createTempDir('personal-agent-cli-repo-');

  writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
  writeFile(
    join(repo, 'profiles/shared/agent/settings.json'),
    JSON.stringify({
      defaultProvider: 'test-provider',
      defaultModel: 'test-model',
      defaultThinkingLevel: 'off',
    }),
  );
  writeFile(join(repo, 'profiles/datadog/agent/AGENTS.md'), '# Datadog\n');

  return repo;
}

function createFakePiBinary(argsLogPath: string): string {
  const binDir = createTempDir('personal-agent-cli-bin-');
  const piScriptPath = join(binDir, 'pi');

  writeFile(
    piScriptPath,
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  echo "pi-test 0.0.1"
  exit 0
fi
printf '%s\n' "$@" >> "${argsLogPath}"
if [ -n "$PI_FAKE_EXIT_CODE" ]; then
  exit "$PI_FAKE_EXIT_CODE"
fi
echo "ok"
`,
  );

  chmodSync(piScriptPath, 0o755);
  return binDir;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_NO_DAEMON_PROMPT: '1',
    PI_SESSION_DIR: createTempDir('pi-session-')
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CLI command flows', () => {
  it('persists selected profile and reuses it for run', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const runLogDir = createTempDir('personal-agent-cli-log-');

    const configPath = join(configDir, 'config.json');
    const argsLogPath = join(runLogDir, 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['profile', 'use', 'datadog'])).toBe(0);

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { defaultProfile: string };
    expect(config.defaultProfile).toBe('datadog');

    expect(await runCli(['tui', '--', '-p', 'Say ok'])).toBe(0);

    const runtimeAgentsPath = join(stateRoot, 'pi-agent', 'AGENTS.md');
    const runtimeAgents = readFileSync(runtimeAgentsPath, 'utf-8');
    expect(runtimeAgents).toContain('Shared');
    expect(runtimeAgents).toContain('Datadog');

    const loggedArgs = readFileSync(argsLogPath, 'utf-8');
    expect(loggedArgs).toContain('--model');
    expect(loggedArgs).toContain('test-provider/test-model');
    expect(loggedArgs).toContain('--thinking');
    expect(loggedArgs).toContain('off');
    expect(loggedArgs).toContain('-p');
    expect(loggedArgs).toContain('Say ok');
  });

  it('allows one-off profile override for tui with --profile', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const runLogDir = createTempDir('personal-agent-cli-log-');

    const configPath = join(configDir, 'config.json');
    const argsLogPath = join(runLogDir, 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['profile', 'use', 'shared'])).toBe(0);
    expect(await runCli(['tui', '--profile', 'datadog', '--', '-p', 'override test'])).toBe(0);

    const runtimeAgentsPath = join(stateRoot, 'pi-agent', 'AGENTS.md');
    const runtimeAgents = readFileSync(runtimeAgentsPath, 'utf-8');
    expect(runtimeAgents).toContain('Shared');
    expect(runtimeAgents).toContain('Datadog');

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { defaultProfile: string };
    expect(config.defaultProfile).toBe('shared');

    const loggedArgs = readFileSync(argsLogPath, 'utf-8');
    expect(loggedArgs).toContain('-p');
    expect(loggedArgs).toContain('override test');
    expect(loggedArgs).not.toContain('--profile');
  });

  it('shows help with no args and passes unknown args through to pi', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const runLogDir = createTempDir('personal-agent-cli-log-');
    const argsLogPath = join(runLogDir, 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(await runCli([])).toBe(0);
    expect(await runCli(['-p', 'hello from pa'])).toBe(0);

    const loggedArgs = readFileSync(argsLogPath, 'utf-8');
    expect(loggedArgs).toContain('--model');
    expect(loggedArgs).toContain('--thinking');
    expect(loggedArgs).toContain('-p');
    expect(loggedArgs).toContain('hello from pa');
  });

  it('returns non-zero for invalid profile usage and rejects doctor --profile flag', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const fakePiBinDir = createFakePiBinary(join(createTempDir('personal-agent-cli-log-'), 'pi-args.log'));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(await runCli(['profile', 'use'])).toBe(1);
    expect(await runCli(['doctor', '--profile', 'datadog'])).toBe(1);
    expect(await runCli(['tui', '--profile'])).toBe(1);
    expect(await runCli(['tui', '--profile='])).toBe(1);
  });

  it('runs doctor success and failure paths based on configured profile', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const fakePiBinDir = createFakePiBinary(join(createTempDir('personal-agent-cli-log-'), 'pi-args.log'));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    expect(await runCli(['profile', 'use', 'datadog'])).toBe(0);
    expect(await runCli(['doctor'])).toBe(0);

    writeFileSync(process.env.PERSONAL_AGENT_CONFIG_FILE, JSON.stringify({ defaultProfile: 'missing' }));
    expect(await runCli(['doctor'])).toBe(1);
  });

  it('prints daemon status for explicit status command', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['daemon', 'status'])).toBe(0);

    expect(logs.some((line) => line.includes('stopped'))).toBe(true);
    expect(logs.some((line) => line.includes('Task directory'))).toBe(true);

    logSpy.mockRestore();
  });

  it('prints daemon status as json when requested', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['daemon', '--json'])).toBe(0);

    expect(logs.some((line) => line.includes('"running": false'))).toBe(true);

    logSpy.mockRestore();
  });

  it('lists scheduled tasks and shows configured task directory', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const daemonConfigPath = join(createTempDir('personal-agent-cli-config-'), 'daemon.json');
    const taskDir = join(createTempDir('personal-agent-cli-tasks-'), 'definitions');

    mkdirSync(taskDir, { recursive: true });
    writeFileSync(
      join(taskDir, 'demo.task.md'),
      `---\nid: demo\nat: "2026-03-02T10:00:00Z"\n---\nRun demo task\n`,
    );

    writeFileSync(
      daemonConfigPath,
      JSON.stringify({
        modules: {
          tasks: {
            taskDir,
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

    expect(await runCli(['tasks', 'list'])).toBe(0);

    expect(logs.some((line) => line.includes(taskDir))).toBe(true);
    expect(logs.some((line) => line.includes('demo'))).toBe(true);

    logSpy.mockRestore();
  });

  it('routes gateway commands through the CLI registry', async () => {
    expect(await runCli(['gateway', 'help'])).toBe(0);
  });
});
