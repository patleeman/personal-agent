import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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

function configureStateEnv(stateRoot: string): void {
  process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
  process.env.PERSONAL_AGENT_VAULT_ROOT = join(stateRoot, 'sync');
  process.env.PERSONAL_AGENT_PROFILES_ROOT = join(stateRoot, 'sync', '_profiles');
}

function createTestRepo(stateRoot: string = process.env.PERSONAL_AGENT_STATE_ROOT ?? ''): string {
  const repo = createTempDir('personal-agent-cli-repo-');

  writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
  writeFile(
    join(repo, 'defaults/agent/settings.json'),
    JSON.stringify({
      defaultProvider: 'test-provider',
      defaultModel: 'test-model',
      defaultThinkingLevel: 'off',
    }),
  );

  if (stateRoot) {
    writeFile(join(stateRoot, 'sync', '_profiles', 'datadog.json'), '{"title":"Datadog"}\n');
    writeFile(join(stateRoot, 'sync', '_profiles', 'datadog', 'AGENTS.md'), '# Datadog\n');
  }

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
  const configDir = createTempDir('personal-agent-cli-config-');
  const configPath = join(configDir, 'config.json');
  const stateRoot = createTempDir('personal-agent-cli-state-');
  writeFileSync(configPath, JSON.stringify({ defaultProfile: 'shared' }));

  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_NO_DAEMON_PROMPT: '1',
    PERSONAL_AGENT_CONFIG_FILE: configPath,
    PERSONAL_AGENT_LOCAL_PROFILE_DIR: createTempDir('personal-agent-cli-local-'),
    PERSONAL_AGENT_STATE_ROOT: stateRoot,
    PERSONAL_AGENT_VAULT_ROOT: join(stateRoot, 'sync'),
    PERSONAL_AGENT_PROFILES_ROOT: join(stateRoot, 'sync', '_profiles'),
    PI_SESSION_DIR: createTempDir('pi-session-')
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('CLI command flows', () => {
  it('persists selected profile and reuses it for run', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const runLogDir = createTempDir('personal-agent-cli-log-');

    const configPath = join(configDir, 'config.json');
    const argsLogPath = join(runLogDir, 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    configureStateEnv(stateRoot);
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['profile', 'use', 'datadog'])).toBe(0);

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { defaultProfile: string };
    expect(config.defaultProfile).toBe('datadog');

    expect(await runCli(['tui', '--', '-p', 'Say ok'])).toBe(0);

    const runtimeAgentsPath = join(stateRoot, 'pi-agent-runtime', 'AGENTS.md');
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
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const runLogDir = createTempDir('personal-agent-cli-log-');

    const configPath = join(configDir, 'config.json');
    const argsLogPath = join(runLogDir, 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    configureStateEnv(stateRoot);
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['profile', 'use', 'shared'])).toBe(0);
    expect(await runCli(['tui', '--profile', 'datadog', '--', '-p', 'override test'])).toBe(0);

    const runtimeAgentsPath = join(stateRoot, 'pi-agent-runtime', 'AGENTS.md');
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

  it('shows home with no args, root help with --help, and rejects unknown top-level args', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const runLogDir = createTempDir('personal-agent-cli-log-');
    const argsLogPath = join(runLogDir, 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);
    const logs: string[] = [];
    const errors: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      logs.push(String(chunk ?? ''));
      return true;
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(await runCli([])).toBe(0);
    expect(logs.join('\n')).toContain('Commands');

    logs.length = 0;
    expect(await runCli(['--help'])).toBe(0);
    expect(logs.join('\n')).toContain('Usage: pa');
    expect(logs.join('\n')).toContain('Commands');
    expect(logs.join('\n')).toContain('Global options');
    expect(logs.join('\n')).toContain('mcp [list|info|grep|call|auth|logout|help]');

    expect(await runCli(['-p', 'hello from pa'])).toBe(1);
    expect(await runCli(['--profile', 'shared', '-p', 'hello from pa'])).toBe(1);
    expect(await runCli(['unknown'])).toBe(1);
    expect(errors.some((line) => line.includes("Use 'pa tui ...' to pass arguments to Pi."))).toBe(true);
    expect(existsSync(argsLogPath)).toBe(false);

    logSpy.mockRestore();
    writeSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns non-zero for invalid profile usage and rejects doctor --profile flag', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const fakePiBinDir = createFakePiBinary(join(createTempDir('personal-agent-cli-log-'), 'pi-args.log'));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    configureStateEnv(stateRoot);

    expect(await runCli(['profile', 'use'])).toBe(1);
    expect(await runCli(['doctor', '--profile', 'datadog'])).toBe(1);
    expect(await runCli(['tui', '--profile'])).toBe(1);
    expect(await runCli(['tui', '--profile='])).toBe(1);
  });

  it('runs doctor success and failure paths based on configured profile', async () => {
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
    const configDir = createTempDir('personal-agent-cli-config-');
    const fakePiBinDir = createFakePiBinary(join(createTempDir('personal-agent-cli-log-'), 'pi-args.log'));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    configureStateEnv(stateRoot);
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
    expect(logs.some((line) => line.includes('Socket'))).toBe(true);

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

  it('treats unsupported tasks CLI as an unknown command', async () => {
    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    expect(await runCli(['tasks', 'list'])).toBe(1);
    expect(errors.some((line) => line.includes('Unknown top-level command or option: tasks'))).toBe(true);

    errorSpy.mockRestore();
  });


});
