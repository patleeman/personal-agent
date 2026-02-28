import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  process.env = { ...originalEnv };
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
    process.env.PERSONAL_AGENT_SKIP_EXTENSION_INSTALL = '1';

    expect(await runCli(['profile', 'use', 'datadog'])).toBe(0);

    const config = JSON.parse(readFileSync(configPath, 'utf-8')) as { defaultProfile: string };
    expect(config.defaultProfile).toBe('datadog');

    expect(await runCli(['run', '--', '-p', 'Say ok'])).toBe(0);

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

  it('returns non-zero for invalid profile usage and unknown run profile', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const fakePiBinDir = createFakePiBinary(join(createTempDir('personal-agent-cli-log-'), 'pi-args.log'));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_SKIP_EXTENSION_INSTALL = '1';

    expect(await runCli(['profile', 'use'])).toBe(1);
    expect(await runCli(['run', '--profile', 'missing', '--', '-p', 'hello'])).toBe(1);
  });

  it('runs doctor success and failure paths', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const fakePiBinDir = createFakePiBinary(join(createTempDir('personal-agent-cli-log-'), 'pi-args.log'));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_SKIP_EXTENSION_INSTALL = '1';

    expect(await runCli(['doctor', '--profile', 'datadog'])).toBe(0);
    expect(await runCli(['doctor', '--profile', 'missing'])).toBe(1);
  });
});
