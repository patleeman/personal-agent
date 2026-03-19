import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createRemoteRuntimeBundle, createRemoteStateBundle } from './remote-target-install.js';

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

function listTarEntries(tarPath: string): string[] {
  const result = spawnSync('tar', ['-tzf', tarPath], { encoding: 'utf-8' });
  expect(result.status).toBe(0);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('remote target install bundles', () => {
  it('packages a self-contained runtime bundle without the monorepo source tree', async () => {
    const repoRoot = createTempDir('pa-runtime-bundle-repo-');

    writeFile(join(repoRoot, 'defaults', 'agent', 'settings.json'), '{}\n');
    writeFile(join(repoRoot, 'extensions', 'example-extension', 'package.json'), '{"name":"example-extension"}\n');
    writeFile(join(repoRoot, 'themes', 'theme.json'), '{"name":"test"}\n');
    writeFile(join(repoRoot, 'prompt-catalog', 'system', 'base.md'), '# Base\n');
    writeFile(join(repoRoot, 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js'), 'console.log("pi")\n');
    writeFile(join(repoRoot, 'node_modules', 'chalk', 'index.js'), 'export default {}\n');
    writeFile(join(repoRoot, 'node_modules', '@personal-agent', 'placeholder.txt'), 'ignore me\n');

    for (const packageName of ['cli', 'core', 'daemon', 'gateway', 'resources']) {
      writeFile(join(repoRoot, 'packages', packageName, 'package.json'), `{"name":"@personal-agent/${packageName}","type":"module"}\n`);
      writeFile(join(repoRoot, 'packages', packageName, 'dist', 'index.js'), `export const name = ${JSON.stringify(packageName)};\n`);
    }

    const bundle = await createRemoteRuntimeBundle({ repoRoot });
    const entries = listTarEntries(bundle.tarPath);

    expect(entries).toContain('./bin/pa-remote');
    expect(entries).toContain('./packages/cli/dist/index.js');
    expect(entries).toContain('./packages/resources/dist/index.js');
    expect(entries).toContain('./node_modules/@mariozechner/pi-coding-agent/dist/cli.js');
    expect(entries).toContain('./defaults/agent/settings.json');
    expect(entries.some((entry) => entry.includes('packages/cli/src'))).toBe(false);
    expect(entries.some((entry) => entry.includes('.git'))).toBe(false);

    await bundle.cleanup();
  });

  it('packages synced remote state from the local state root', async () => {
    const stateRoot = createTempDir('pa-runtime-bundle-state-');
    const syncRoot = join(stateRoot, 'sync');
    const profilesRoot = join(syncRoot, 'profiles');

    mkdirSync(syncRoot, { recursive: true });
    writeFile(join(profilesRoot, 'datadog', 'agent', 'AGENTS.md'), '# Datadog\n');
    writeFile(join(profilesRoot, '_memory', 'personal-agent', 'MEMORY.md'), '# Memory\n');
    symlinkSync(profilesRoot, join(stateRoot, 'profiles'), 'dir');
    writeFile(join(stateRoot, 'config', 'local', 'settings.json'), '{}\n');
    writeFile(join(stateRoot, 'config', 'config.json'), '{"defaultProfile":"datadog"}\n');
    writeFile(join(stateRoot, 'pi-agent-runtime', 'auth.json'), '{"apiKey":"redacted"}\n');

    const bundle = await createRemoteStateBundle({ stateRoot });
    const entries = listTarEntries(bundle.tarPath);

    expect(entries).toContain('./profiles/datadog/agent/AGENTS.md');
    expect(entries).toContain('./profiles/_memory/personal-agent/MEMORY.md');
    expect(entries).toContain('./config/local/settings.json');
    expect(entries).toContain('./config/config.json');
    expect(entries).toContain('./pi-agent-runtime/auth.json');

    await bundle.cleanup();
  });
});
