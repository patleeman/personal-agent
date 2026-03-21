/**
 * P3: Cross-package integration tests
 * Validates main CLI flows working together across packages
 */

import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
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
`
  );

  chmodSync(piScriptPath, 0o755);
  return binDir;
}

beforeEach(() => {
  const sessionDir = createTempDir('pi-session-');
  const configDir = createTempDir('personal-agent-cli-config-');
  const configPath = join(configDir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ defaultProfile: 'shared' }));

  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PERSONAL_AGENT_CONFIG_FILE: configPath,
    PI_SESSION_DIR: sessionDir,
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('CLI main flow integration', () => {
  it('full workflow: profile use -> doctor -> run', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'defaults/agent/settings.json'),
      JSON.stringify({ defaultProvider: 'test', defaultModel: 'model' })
    );
    writeFile(join(stateRoot, 'sync', 'profiles', 'datadog.json'), '{"title":"Datadog"}\n');
    writeFile(join(stateRoot, 'sync', 'agents', 'datadog.md'), '# Datadog\n');

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    expect(await runCli(['profile', 'use', 'datadog'])).toBe(0);
    expect(await runCli(['doctor'])).toBe(0);
    expect(await runCli(['tui', '-p', 'hello'])).toBe(0);

    const loggedArgs = readFileSync(argsLogPath, 'utf-8');
    expect(loggedArgs).toContain('-p');
    expect(loggedArgs).toContain('hello');
  });

  it('handles profile switch and materializes correct files', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared Content\n');
    writeFile(join(repo, 'defaults/agent/settings.json'), JSON.stringify({ shared: true }));
    writeFile(join(stateRoot, 'sync', 'profiles', 'datadog.json'), '{"title":"Datadog"}\n');
    writeFile(join(stateRoot, 'sync', 'agents', 'datadog.md'), '# Datadog Content\n');
    writeFile(join(stateRoot, 'sync', 'settings', 'datadog.json'), JSON.stringify({ datadog: true }));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    await runCli(['profile', 'use', 'shared']);
    await runCli(['tui', '-p', 'test']);

    const runtimeAgentsPath = join(stateRoot, 'pi-agent-runtime', 'AGENTS.md');
    expect(existsSync(runtimeAgentsPath)).toBe(true);
    let agentsContent = readFileSync(runtimeAgentsPath, 'utf-8');
    expect(agentsContent).toContain('Shared Content');

    await runCli(['profile', 'use', 'datadog']);
    await runCli(['tui', '-p', 'test2']);

    agentsContent = readFileSync(runtimeAgentsPath, 'utf-8');
    expect(agentsContent).toContain('Shared Content');
    expect(agentsContent).toContain('Datadog Content');
  });

  it('daemon event emission is non-fatal when daemon unavailable', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const exitCode = await runCli(['tui', '-p', 'test']);

    expect(exitCode).toBe(0);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('handles legacy auth migration when available', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');

    const legacyAuthDir = join(process.env.HOME || '/tmp', '.pi', 'agent');
    mkdirSync(legacyAuthDir, { recursive: true });
    writeFile(join(legacyAuthDir, 'auth.json'), JSON.stringify({ legacy: true }));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const exitCode = await runCli(['tui', '-p', 'test']);

    expect(exitCode).toBe(0);

    await rm(legacyAuthDir, { recursive: true, force: true }).catch(() => {});
  });

  it('maps runtime theme from profile settings when themeMode is explicit', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'defaults/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'defaults/agent/settings.json'),
      JSON.stringify({
        defaultProvider: 'test',
        defaultModel: 'model',
        theme: 'cobalt2',
        themeDark: 'cobalt2',
        themeLight: 'cobalt2-light',
        themeMode: 'light',
      }),
    );

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    expect(await runCli(['tui', '-p', 'theme test'])).toBe(0);

    const runtimeSettingsPath = join(stateRoot, 'pi-agent-runtime', 'settings.json');
    const runtimeSettings = JSON.parse(readFileSync(runtimeSettingsPath, 'utf-8')) as Record<string, unknown>;

    expect(runtimeSettings.theme).toBe('cobalt2-light');
  });
});
