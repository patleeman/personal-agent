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

function createTestRepo(): string {
  const repo = createTempDir('personal-agent-cli-repo-');

  writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
  writeFile(
    join(repo, 'profiles/shared/agent/settings.json'),
    JSON.stringify({
      defaultProvider: 'test-provider',
      defaultModel: 'test-model',
    }),
  );

  return repo;
}

function createFakePiBinary(invocationLogPath?: string): string {
  const binDir = createTempDir('personal-agent-cli-pi-bin-');
  const piScriptPath = join(binDir, 'pi');
  const logPath = invocationLogPath ?? '';

  writeFile(
    piScriptPath,
    `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  echo "pi-test 0.0.1"
  exit 0
fi
if [ -n "${logPath}" ]; then
  {
    echo "args:$*"
    env | sort
  } >> "${logPath}"
fi
exit 0
`,
  );

  chmodSync(piScriptPath, 0o755);
  return binDir;
}

function createFakeTmuxBinary(logPath: string): string {
  const binDir = createTempDir('personal-agent-cli-tmux-bin-');
  const tmuxScriptPath = join(binDir, 'tmux');

  writeFile(
    tmuxScriptPath,
    `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${logPath}"
subcommand=""
args=("$@")
index=0
while [ $index -lt \${#args[@]} ]; do
  arg="\${args[$index]}"
  if [ "$arg" = "-L" ] || [ "$arg" = "-f" ] || [ "$arg" = "-S" ] || [ "$arg" = "-t" ] || [ "$arg" = "-s" ] || [ "$arg" = "-c" ]; then
    index=$((index + 2))
    continue
  fi
  subcommand="$arg"
  break
done
if [ "$subcommand" = "has-session" ]; then
  echo "can't find session" >&2
  exit 1
fi
exit 0
`,
  );

  chmodSync(tmuxScriptPath, 0o755);
  return binDir;
}

beforeEach(() => {
  const configDir = createTempDir('personal-agent-cli-config-');
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ defaultProfile: 'shared' }));

  const nextEnv: NodeJS.ProcessEnv = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_NO_DAEMON_PROMPT: '1',
    PERSONAL_AGENT_CONFIG_FILE: configPath,
    PI_SESSION_DIR: createTempDir('pi-session-'),
  };

  delete nextEnv.TMUX;
  delete nextEnv.TMUX_PANE;
  delete nextEnv.PERSONAL_AGENT_TMUX_WORKSPACE;
  delete nextEnv.PERSONAL_AGENT_TMUX_SESSION;
  delete nextEnv.PERSONAL_AGENT_TMUX_SOCKET;
  delete nextEnv.PERSONAL_AGENT_TUI_DIRECT;

  process.env = nextEnv;
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('pa tui workspace mode', () => {
  it('launches interactive pa tui inside the managed tmux workspace', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const tmuxLogPath = join(createTempDir('personal-agent-cli-log-'), 'tmux-args.log');
    const fakePiBinDir = createFakePiBinary();
    const fakeTmuxBinDir = createFakeTmuxBinary(tmuxLogPath);

    process.env.PATH = `${fakeTmuxBinDir}:${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const exitCode = await runCli(['tui']);
    expect(exitCode).toBe(0);

    const tmuxLog = readFileSync(tmuxLogPath, 'utf-8');
    expect(tmuxLog).toContain('source-file');
    expect(tmuxLog).toContain('has-session');
    expect(tmuxLog).toContain('new-session');
    expect(tmuxLog).toContain('-n main');
    expect(tmuxLog).toContain('select-pane');
    expect(tmuxLog).toContain('-T main');
    expect(tmuxLog).toContain('attach-session');
    expect(tmuxLog).toContain('PERSONAL_AGENT_TMUX_WORKSPACE=1');
    expect(tmuxLog).toContain('PI_CODING_AGENT_DIR=');
  });

  it('runs pa tui directly in the current pane when already inside tmux', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const piLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-invocation.log');
    const tmuxLogPath = join(createTempDir('personal-agent-cli-log-'), 'tmux-args.log');
    const fakePiBinDir = createFakePiBinary(piLogPath);
    const fakeTmuxBinDir = createFakeTmuxBinary(tmuxLogPath);

    process.env.PATH = `${fakeTmuxBinDir}:${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.TMUX = '/tmp/tmux-123/default,100,0';

    const exitCode = await runCli(['tui']);
    expect(exitCode).toBe(0);

    const piLog = readFileSync(piLogPath, 'utf-8');
    expect(piLog).toContain('PI_CODING_AGENT_DIR=');
    expect(piLog).not.toContain('PERSONAL_AGENT_TMUX_WORKSPACE=1');
    expect(existsSync(tmuxLogPath)).toBe(false);
  });
});
