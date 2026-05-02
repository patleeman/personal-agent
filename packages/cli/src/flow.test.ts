import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import {
  createProjectActivityEntry,
  getActivityConversationLink,
  setActivityConversationLinks,
  writeProfileActivityEntry,
} from '@personal-agent/core';
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
    writeFile(join(stateRoot, 'profiles/datadog/agent/AGENTS.md'), '# Datadog\n');
  }

  return repo;
}

function writeSessionFile(stateRoot: string, relativePath: string, lines: unknown[]): string {
  const filePath = join(stateRoot, 'pi-agent', 'sessions', relativePath);
  writeFile(filePath, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return filePath;
}

function activityPath(stateRoot: string, profile: string, activityId: string): string {
  return join(stateRoot, 'pi-agent', 'state', 'inbox', profile, 'activities', `${activityId}.md`);
}

function activityReadStatePath(stateRoot: string, profile: string): string {
  return join(stateRoot, 'pi-agent', 'state', 'inbox', profile, 'read-state.json');
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
  writeFileSync(configPath, JSON.stringify({ defaultProfile: 'shared' }));

  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_NO_DAEMON_PROMPT: '1',
    PERSONAL_AGENT_CONFIG_FILE: configPath,
    PERSONAL_AGENT_LOCAL_PROFILE_DIR: createTempDir('personal-agent-cli-local-'),
    PERSONAL_AGENT_STATE_ROOT: createTempDir('personal-agent-cli-state-'),
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
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
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
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
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
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
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
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const repo = createTestRepo(stateRoot);
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

  it('lists inbox activity for the active profile', async () => {
    const repo = createTestRepo();
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));

    writeProfileActivityEntry({
      repoRoot: repo,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'daily-report',
        createdAt: '2026-03-10T14:00:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Daily report completed.',
        details: 'Generated the daily report artifact.',
      }),
    });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox'])).toBe(0);

    expect(logs.some((line) => line.includes('daily-report'))).toBe(true);
    expect(logs.some((line) => line.includes('Daily report completed.'))).toBe(true);

    logSpy.mockRestore();
  });

  it('shows one inbox activity item as json', async () => {
    const repo = createTestRepo();
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));

    writeProfileActivityEntry({
      repoRoot: repo,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'daily-report',
        createdAt: '2026-03-10T14:00:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Daily report completed.',
        details: 'Generated the daily report artifact.',
      }),
    });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox', 'show', 'daily-report', '--json'])).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"id": "daily-report"');
    expect(output).toContain('"kind": "scheduled-task"');
    expect(output).toContain('"read": false');

    logSpy.mockRestore();
  });

  it('creates inbox items from the CLI', async () => {
    const repo = createTestRepo();
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli([
      'inbox',
      'create',
      'Daily report ready.',
      '--id',
      'daily-report',
      '--kind',
      'note',
      '--details',
      'Saved the report artifact.',
      '--project',
      'reporting',
      '--conversation',
      'conv-123',
      '--json',
    ])).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"id": "daily-report"');
    expect(output).toContain('"summary": "Daily report ready."');
    expect(output).toContain('"read": false');

    const createdActivityPath = activityPath(process.env.PERSONAL_AGENT_STATE_ROOT!, 'datadog', 'daily-report');
    expect(existsSync(createdActivityPath)).toBe(true);

    const activityMarkdown = readFileSync(createdActivityPath, 'utf-8');
    expect(activityMarkdown).toContain('Daily report ready.');
    expect(activityMarkdown).toContain('Saved the report artifact.');
    expect(activityMarkdown).toContain('relatedProjectIds: reporting');
    expect(activityMarkdown).not.toContain('relatedConversationIds');

    expect(getActivityConversationLink({
      stateRoot: process.env.PERSONAL_AGENT_STATE_ROOT,
      profile: 'datadog',
      activityId: 'daily-report',
    })).toEqual({
      activityId: 'daily-report',
      updatedAt: expect.any(String),
      relatedConversationIds: ['conv-123'],
    });

    logSpy.mockRestore();
  });

  it('marks inbox items read and unread from the CLI', async () => {
    const repo = createTestRepo();
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));

    writeProfileActivityEntry({
      repoRoot: repo,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'daily-report',
        createdAt: '2026-03-10T14:00:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Daily report completed.',
      }),
    });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['inbox', 'read', 'daily-report'])).toBe(0);
    expect(readFileSync(activityReadStatePath(process.env.PERSONAL_AGENT_STATE_ROOT!, 'datadog'), 'utf-8'))
      .toBe('["daily-report"]');

    let logs: string[] = [];
    let logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox', 'list', '--unread', '--json'])).toBe(0);
    expect(logs.join('\n')).toContain('"filteredCount": 0');
    logSpy.mockRestore();

    expect(await runCli(['inbox', 'unread', 'daily-report'])).toBe(0);
    expect(readFileSync(activityReadStatePath(process.env.PERSONAL_AGENT_STATE_ROOT!, 'datadog'), 'utf-8'))
      .toBe('[]');

    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox', 'show', 'daily-report', '--json'])).toBe(0);
    expect(logs.join('\n')).toContain('"read": false');
    logSpy.mockRestore();
  });

  it('surfaces conversation-linked activity as a conversation inbox item', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));
    writeSessionFile(stateRoot, '--Users-patrick-project/2026-03-12T12-00-00-000Z_conv-123.jsonl', [
      { type: 'session', id: 'conv-123', timestamp: '2026-03-12T12:00:00.000Z', cwd: '/Users/patrick/project' },
      { type: 'message', timestamp: '2026-03-12T12:01:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Review the nightly run' }] } },
    ]);

    writeProfileActivityEntry({
      stateRoot,
      repoRoot: repo,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'nightly-run',
        createdAt: '2026-03-12T12:05:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Nightly run finished.',
      }),
    });
    setActivityConversationLinks({
      stateRoot,
      profile: 'datadog',
      activityId: 'nightly-run',
      relatedConversationIds: ['conv-123'],
      updatedAt: '2026-03-12T12:05:00.000Z',
    });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox', 'list', '--json'])).toBe(0);

    const output = logs.join('\n');
    expect(output).toContain('"kind": "conversation"');
    expect(output).toContain('"key": "conversation:conv-123"');
    expect(output).not.toContain('"key": "activity:nightly-run"');

    logSpy.mockRestore();
  });

  it('marks conversation inbox items read and unread from the CLI', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));
    writeSessionFile(stateRoot, '--Users-patrick-project/2026-03-12T12-00-00-000Z_conv-123.jsonl', [
      { type: 'session', id: 'conv-123', timestamp: '2026-03-12T12:00:00.000Z', cwd: '/Users/patrick/project' },
      { type: 'message', timestamp: '2026-03-12T12:01:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Review the nightly run' }] } },
    ]);

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['inbox', 'unread', 'conversation:conv-123'])).toBe(0);

    let logs: string[] = [];
    let logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox', 'list', '--conversations', '--json'])).toBe(0);
    expect(logs.join('\n')).toContain('"key": "conversation:conv-123"');
    logSpy.mockRestore();

    expect(await runCli(['inbox', 'read', 'conversation:conv-123'])).toBe(0);

    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    expect(await runCli(['inbox', 'list', '--conversations', '--json'])).toBe(0);
    expect(logs.join('\n')).toContain('"filteredCount": 0');
    logSpy.mockRestore();
  });

  it('deletes inbox items from the CLI', async () => {
    const repo = createTestRepo();
    const configDir = createTempDir('personal-agent-cli-config-');
    const configPath = join(configDir, 'config.json');

    writeFileSync(configPath, JSON.stringify({ defaultProfile: 'datadog' }));

    writeProfileActivityEntry({
      repoRoot: repo,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'daily-report',
        createdAt: '2026-03-10T14:00:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Daily report completed.',
      }),
    });
    writeFileSync(
      activityReadStatePath(process.env.PERSONAL_AGENT_STATE_ROOT!, 'datadog'),
      JSON.stringify(['daily-report']),
    );
    setActivityConversationLinks({
      stateRoot: process.env.PERSONAL_AGENT_STATE_ROOT,
      profile: 'datadog',
      activityId: 'daily-report',
      relatedConversationIds: ['conv-123'],
      updatedAt: '2026-03-10T14:00:00.000Z',
    });

    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_CONFIG_FILE = configPath;

    expect(await runCli(['inbox', 'delete', 'daily-report'])).toBe(0);

    expect(existsSync(activityPath(process.env.PERSONAL_AGENT_STATE_ROOT!, 'datadog', 'daily-report'))).toBe(false);
    expect(readFileSync(activityReadStatePath(process.env.PERSONAL_AGENT_STATE_ROOT!, 'datadog'), 'utf-8'))
      .toBe('[]');
    expect(getActivityConversationLink({
      stateRoot: process.env.PERSONAL_AGENT_STATE_ROOT,
      profile: 'datadog',
      activityId: 'daily-report',
    })).toBeNull();
  });

  it('routes gateway commands through the CLI registry', async () => {
    expect(await runCli(['gateway', 'help'])).toBe(0);
  });
});
