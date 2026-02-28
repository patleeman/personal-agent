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
printf '%s\\n' "$@" >> "${argsLogPath}"
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
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
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

    // Create test profiles
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'profiles/shared/agent/settings.json'),
      JSON.stringify({ defaultProvider: 'test', defaultModel: 'model' })
    );
    writeFile(join(repo, 'profiles/datadog/agent/AGENTS.md'), '# Datadog\n');

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    // Step 1: Set profile
    expect(await runCli(['profile', 'use', 'datadog'])).toBe(0);

    // Step 2: Run doctor
    expect(await runCli(['doctor'])).toBe(0);

    // Step 3: Run pi with the profile
    expect(await runCli(['run', '-p', 'hello'])).toBe(0);

    // Verify pi was called with merged profile
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

    // Create profiles with different content
    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared Content\n');
    writeFile(join(repo, 'profiles/shared/agent/settings.json'), JSON.stringify({ shared: true }));
    writeFile(join(repo, 'profiles/datadog/agent/AGENTS.md'), '# Datadog Content\n');
    writeFile(join(repo, 'profiles/datadog/agent/settings.json'), JSON.stringify({ datadog: true }));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    // Use shared and run
    await runCli(['profile', 'use', 'shared']);
    await runCli(['run', '-p', 'test']);

    // Check runtime has shared content
    const runtimeAgentsPath = join(stateRoot, 'pi-agent', 'AGENTS.md');
    expect(existsSync(runtimeAgentsPath)).toBe(true);
    let agentsContent = readFileSync(runtimeAgentsPath, 'utf-8');
    expect(agentsContent).toContain('Shared Content');

    // Switch to datadog and run
    await runCli(['profile', 'use', 'datadog']);
    await runCli(['run', '-p', 'test2']);

    // Check runtime now has merged content
    agentsContent = readFileSync(runtimeAgentsPath, 'utf-8');
    expect(agentsContent).toContain('Shared Content');
    expect(agentsContent).toContain('Datadog Content');
  });

  it('daemon event emission is non-fatal when daemon unavailable', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    // Don't disable daemon events - let it try and fail

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    // Should succeed even though daemon is not running
    const exitCode = await runCli(['run', '-p', 'test']);

    expect(exitCode).toBe(0);
    // Should have logged daemon unavailable warning
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('handles legacy auth migration when available', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');

    // Create legacy auth
    const legacyAuthDir = join(process.env.HOME || '/tmp', '.pi', 'agent');
    mkdirSync(legacyAuthDir, { recursive: true });
    writeFile(join(legacyAuthDir, 'auth.json'), JSON.stringify({ legacy: true }));

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const exitCode = await runCli(['run', '-p', 'test']);

    expect(exitCode).toBe(0);

    // Cleanup
    await rm(legacyAuthDir, { recursive: true, force: true }).catch(() => {});
  });

  it('doctor validates complete setup chain', async () => {
    const repo = createTempDir('personal-agent-cli-repo-');
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    writeFile(join(repo, 'profiles/shared/agent/AGENTS.md'), '# Shared\n');
    writeFile(
      join(repo, 'profiles/shared/agent/settings.json'),
      JSON.stringify({ defaultProvider: 'test', defaultModel: 'model' })
    );

    process.env.PATH = `${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((message?: unknown) => {
      logs.push(String(message ?? ''));
    });

    const exitCode = await runCli(['doctor']);

    expect(exitCode).toBe(0);
    expect(logs.some((l) => l.includes('pi binary'))).toBe(true);
    expect(logs.some((l) => l.includes('profile:'))).toBe(true);
    expect(logs.some((l) => l.includes('runtime root:'))).toBe(true);

    logSpy.mockRestore();
  });
});
