import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getMemoryDocsDir, migrateLegacyProfileMemoryDirs } from './memory-docs.js';

const tempDirs: string[] = [];

function createTempProfilesRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-memory-docs-'));
  const dir = join(root, 'sync', 'profiles');
  mkdirSync(dir, { recursive: true });
  tempDirs.push(root);
  return dir;
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('note node paths', () => {
  it('stores shared note nodes under the sync nodes root', () => {
    const profilesRoot = createTempProfilesRoot();
    expect(getMemoryDocsDir({ profilesRoot })).toBe(join(profilesRoot, '..', 'nodes'));
  });

  it('migrates legacy per-profile memory files into note nodes', () => {
    const profilesRoot = createTempProfilesRoot();
    const assistantMemory = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const datadogMemory = join(profilesRoot, 'datadog', 'agent', 'memory', 'infra.md');

    writeFile(assistantMemory, '---\nid: runpod\ntitle: Runpod\nsummary: Notes\ntags: [gpu]\nupdated: 2026-03-17\n---\nRunpod\n');
    writeFile(datadogMemory, '---\nid: infra\ntitle: Infra\nsummary: Notes\ntags: [ops]\nupdated: 2026-03-17\n---\nInfra\n');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.memoryDir).toBe(join(profilesRoot, '..', 'nodes'));
    expect(result.migratedFiles).toEqual([
      { from: assistantMemory, to: join(profilesRoot, '..', 'nodes', 'runpod', 'INDEX.md') },
      { from: datadogMemory, to: join(profilesRoot, '..', 'nodes', 'infra', 'INDEX.md') },
    ]);

    expect(existsSync(assistantMemory)).toBe(false);
    expect(existsSync(datadogMemory)).toBe(false);
    const runpod = readFileSync(join(profilesRoot, '..', 'nodes', 'runpod', 'INDEX.md'), 'utf-8');
    expect(runpod).toContain('id: runpod');
    expect(runpod).toContain('summary: Notes');
    expect(runpod).toContain('title: Runpod');
    expect(runpod).toContain('type:note');
  });

  it('migrates legacy shared memory packages into note nodes', () => {
    const profilesRoot = createTempProfilesRoot();
    const legacyPackagePath = join(profilesRoot, '..', 'memory', 'runpod', 'MEMORY.md');
    const legacyReferencePath = join(profilesRoot, '..', 'memory', 'runpod', 'references', 'usage.md');

    writeFile(legacyPackagePath, `---
name: runpod
description: Runpod notes.
metadata:
  title: Runpod
  type: reference
  area: compute
  role: hub
  tags:
    - gpu
  updated: 2026-03-17
---
# Runpod
`);
    writeFile(legacyReferencePath, '# Usage\n\nShort-lived GPU boxes.\n');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });
    const targetPath = join(profilesRoot, '..', 'nodes', 'runpod', 'INDEX.md');

    expect(result.migratedFiles).toContainEqual({ from: legacyPackagePath, to: targetPath });
    expect(existsSync(targetPath)).toBe(true);
    expect(existsSync(join(profilesRoot, '..', 'nodes', 'runpod', 'references', 'usage.md'))).toBe(true);

    const migrated = readFileSync(targetPath, 'utf-8');
    expect(migrated).toContain('id: runpod');
    expect(migrated).toContain('summary: Runpod notes.');
    expect(migrated).toContain('type:note');
    expect(migrated).toContain('role:structure');
  });

  it('migrates flat shared memory files into note nodes', () => {
    const profilesRoot = createTempProfilesRoot();
    const flatMemory = join(profilesRoot, '..', 'memory', 'runpod.md');

    writeFile(flatMemory, '---\nid: runpod\ntitle: Runpod\nsummary: Notes\ntags: [gpu]\nupdated: 2026-03-17\n---\nRunpod\n');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.migratedFiles).toEqual([
      { from: flatMemory, to: join(profilesRoot, '..', 'nodes', 'runpod', 'INDEX.md') },
    ]);
    expect(existsSync(flatMemory)).toBe(false);
    expect(readFileSync(join(profilesRoot, '..', 'nodes', 'runpod', 'INDEX.md'), 'utf-8')).toContain('id: runpod');
  });
});
