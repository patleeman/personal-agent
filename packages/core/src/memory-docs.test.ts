import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getMemoryDocsDir, migrateLegacyProfileMemoryDirs } from './memory-docs.js';

const tempDirs: string[] = [];

function createTempProfilesRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-memory-docs-'));
  tempDirs.push(dir);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('memory docs paths', () => {
  it('stores global memory docs under the profiles root', () => {
    const profilesRoot = createTempProfilesRoot();
    expect(getMemoryDocsDir({ profilesRoot })).toBe(join(profilesRoot, '_memory'));
  });

  it('migrates legacy per-profile memory docs into the shared memory dir', () => {
    const profilesRoot = createTempProfilesRoot();
    const assistantMemory = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const datadogMemory = join(profilesRoot, 'datadog', 'agent', 'memory', 'infra.md');

    writeFile(assistantMemory, '---\nid: runpod\ntitle: Runpod\nsummary: Notes\ntags: [gpu]\nupdated: 2026-03-17\n---\nRunpod\n');
    writeFile(datadogMemory, '---\nid: infra\ntitle: Infra\nsummary: Notes\ntags: [ops]\nupdated: 2026-03-17\n---\nInfra\n');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.memoryDir).toBe(join(profilesRoot, '_memory'));
    expect(result.migratedFiles).toEqual([
      { from: assistantMemory, to: join(profilesRoot, '_memory', 'runpod.md') },
      { from: datadogMemory, to: join(profilesRoot, '_memory', 'infra.md') },
    ]);

    expect(existsSync(assistantMemory)).toBe(false);
    expect(existsSync(datadogMemory)).toBe(false);
    expect(readFileSync(join(profilesRoot, '_memory', 'runpod.md'), 'utf-8')).toContain('id: runpod');
    expect(readFileSync(join(profilesRoot, '_memory', 'infra.md'), 'utf-8')).toContain('id: infra');
  });

  it('removes legacy duplicates when the global target already exists with the same content', () => {
    const profilesRoot = createTempProfilesRoot();
    const legacyPath = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const targetPath = join(profilesRoot, '_memory', 'runpod.md');

    writeFile(legacyPath, 'same');
    writeFile(targetPath, 'same');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.migratedFiles).toEqual([]);
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(targetPath, 'utf-8')).toBe('same');
  });

  it('preserves differing legacy files as backups when the global target already exists', () => {
    const profilesRoot = createTempProfilesRoot();
    const legacyPath = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const targetPath = join(profilesRoot, '_memory', 'runpod.md');
    const backupPath = `${legacyPath}.migration-conflict.bak`;

    writeFile(legacyPath, 'legacy');
    writeFile(targetPath, 'existing');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.migratedFiles).toEqual([]);
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(targetPath, 'utf-8')).toBe('existing');
    expect(readFileSync(backupPath, 'utf-8')).toBe('legacy');
  });
});
