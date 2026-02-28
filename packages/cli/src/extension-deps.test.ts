/**
 * P2: Extension dependency installation failure path tests
 * Tests for missing node_modules and failed npm install handling
 */

import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'fs';
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
    })
  );
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
printf '%s\\n' "$@" >> "${argsLogPath}"
echo "ok"
`
  );

  chmodSync(piScriptPath, 0o755);
  return binDir;
}

beforeEach(() => {
  process.env = {
    ...originalEnv,
    PERSONAL_AGENT_DISABLE_DAEMON_EVENTS: '1',
    PI_SESSION_DIR: createTempDir('pi-session-')
  };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

describe('extension dependency failure paths', () => {
  it('surfaces error when extension npm install fails', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    // Create extension directory without node_modules
    const extensionDir = join(repo, 'profiles/shared/agent/extensions/test-ext');
    mkdirSync(extensionDir, { recursive: true });
    writeFile(join(extensionDir, 'index.ts'), 'export default {}');
    writeFile(
      join(extensionDir, 'package.json'),
      JSON.stringify({ name: 'test-ext', version: '1.0.0' })
    );

    // Create failing npm binary
    const fakeNpmBinDir = createTempDir('personal-agent-cli-npm-bin-');
    const npmScriptPath = join(fakeNpmBinDir, 'npm');
    writeFile(
      npmScriptPath,
      `#!/usr/bin/env bash
echo "npm install failed" >&2
exit 1
`
    );
    chmodSync(npmScriptPath, 0o755);

    process.env.PATH = `${fakeNpmBinDir}:${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      errors.push(String(message ?? ''));
    });

    // The CLI should throw or return non-zero when npm install fails
    const exitCode = await runCli(['run', '-p', 'test']);

    // Should have failed due to npm install failure
    expect(exitCode).not.toBe(0);

    errorSpy.mockRestore();
  });

  it('installs extension dependencies when node_modules is missing', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    // Create extension directory without node_modules
    const extensionDir = join(repo, 'profiles/shared/agent/extensions/test-ext');
    mkdirSync(extensionDir, { recursive: true });
    writeFile(join(extensionDir, 'index.ts'), 'export default {}');
    writeFile(
      join(extensionDir, 'package.json'),
      JSON.stringify({ name: 'test-ext', version: '1.0.0' })
    );

    // Create successful npm binary that creates node_modules
    const fakeNpmBinDir = createTempDir('personal-agent-cli-npm-bin-');
    const npmScriptPath = join(fakeNpmBinDir, 'npm');
    writeFile(
      npmScriptPath,
      `#!/usr/bin/env bash
if [ "$1" = "install" ]; then
  mkdir -p "${extensionDir}/node_modules"
  exit 0
fi
exit 0
`
    );
    chmodSync(npmScriptPath, 0o755);

    process.env.PATH = `${fakeNpmBinDir}:${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    // Before run, node_modules should not exist
    expect(existsSync(join(extensionDir, 'node_modules'))).toBe(false);

    const exitCode = await runCli(['run', '-p', 'test']);

    // Should succeed
    expect(exitCode).toBe(0);

    // node_modules should have been created
    expect(existsSync(join(extensionDir, 'node_modules'))).toBe(true);
  });

  it('skips install when node_modules already exists', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    // Create extension directory WITH node_modules
    const extensionDir = join(repo, 'profiles/shared/agent/extensions/test-ext');
    mkdirSync(join(extensionDir, 'node_modules'), { recursive: true });
    writeFile(join(extensionDir, 'index.ts'), 'export default {}');
    writeFile(
      join(extensionDir, 'package.json'),
      JSON.stringify({ name: 'test-ext', version: '1.0.0' })
    );

    const fakeNpmBinDir = createTempDir('personal-agent-cli-npm-bin-');
    const npmScriptPath = join(fakeNpmBinDir, 'npm');
    writeFile(
      npmScriptPath,
      `#!/usr/bin/env bash
exit 0
`
    );
    chmodSync(npmScriptPath, 0o755);

    process.env.PATH = `${fakeNpmBinDir}:${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    const exitCode = await runCli(['run', '-p', 'test']);

    expect(exitCode).toBe(0);
  });

  it('handles multiple extensions with missing dependencies', async () => {
    const repo = createTestRepo();
    const stateRoot = createTempDir('personal-agent-cli-state-');
    const configDir = createTempDir('personal-agent-cli-config-');
    const argsLogPath = join(createTempDir('personal-agent-cli-log-'), 'pi-args.log');
    const fakePiBinDir = createFakePiBinary(argsLogPath);

    // Create multiple extensions without node_modules
    const ext1Dir = join(repo, 'profiles/shared/agent/extensions/ext1');
    const ext2Dir = join(repo, 'profiles/shared/agent/extensions/ext2');
    mkdirSync(ext1Dir, { recursive: true });
    mkdirSync(ext2Dir, { recursive: true });

    writeFile(join(ext1Dir, 'index.ts'), 'export default {}');
    writeFile(join(ext1Dir, 'package.json'), JSON.stringify({ name: 'ext1', version: '1.0.0' }));

    writeFile(join(ext2Dir, 'index.ts'), 'export default {}');
    writeFile(join(ext2Dir, 'package.json'), JSON.stringify({ name: 'ext2', version: '1.0.0' }));

    const fakeNpmBinDir = createTempDir('personal-agent-cli-npm-bin-');
    const npmScriptPath = join(fakeNpmBinDir, 'npm');
    writeFile(
      npmScriptPath,
      `#!/usr/bin/env bash
if [ "$1" = "install" ]; then
  mkdir -p node_modules
  exit 0
fi
exit 0
`
    );
    chmodSync(npmScriptPath, 0o755);

    process.env.PATH = `${fakeNpmBinDir}:${fakePiBinDir}:${process.env.PATH}`;
    process.env.PERSONAL_AGENT_REPO_ROOT = repo;
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'config.json');

    const exitCode = await runCli(['run', '-p', 'test']);

    expect(exitCode).toBe(0);
    expect(existsSync(join(ext1Dir, 'node_modules'))).toBe(true);
    expect(existsSync(join(ext2Dir, 'node_modules'))).toBe(true);
  });
});
