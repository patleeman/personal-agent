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

describe('memory package paths', () => {
  it('stores global memories under the profiles root', () => {
    const profilesRoot = createTempProfilesRoot();
    expect(getMemoryDocsDir({ profilesRoot })).toBe(join(profilesRoot, '_memory'));
  });

  it('migrates legacy per-profile memory files into memory packages', () => {
    const profilesRoot = createTempProfilesRoot();
    const assistantMemory = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const datadogMemory = join(profilesRoot, 'datadog', 'agent', 'memory', 'infra.md');

    writeFile(assistantMemory, '---\nid: runpod\ntitle: Runpod\nsummary: Notes\ntags: [gpu]\nupdated: 2026-03-17\n---\nRunpod\n');
    writeFile(datadogMemory, '---\nid: infra\ntitle: Infra\nsummary: Notes\ntags: [ops]\nupdated: 2026-03-17\n---\nInfra\n');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.memoryDir).toBe(join(profilesRoot, '_memory'));
    expect(result.migratedFiles).toEqual([
      { from: assistantMemory, to: join(profilesRoot, '_memory', 'runpod', 'MEMORY.md') },
      { from: datadogMemory, to: join(profilesRoot, '_memory', 'infra', 'MEMORY.md') },
    ]);

    expect(existsSync(assistantMemory)).toBe(false);
    expect(existsSync(datadogMemory)).toBe(false);
    expect(readFileSync(join(profilesRoot, '_memory', 'runpod', 'MEMORY.md'), 'utf-8')).toContain('name: runpod');
    expect(readFileSync(join(profilesRoot, '_memory', 'runpod', 'MEMORY.md'), 'utf-8')).toContain('description: Notes');
    expect(readFileSync(join(profilesRoot, '_memory', 'runpod', 'MEMORY.md'), 'utf-8')).toContain('metadata:');
    expect(readFileSync(join(profilesRoot, '_memory', 'infra', 'MEMORY.md'), 'utf-8')).toContain('name: infra');
  });

  it('migrates flat shared memory files into memory packages', () => {
    const profilesRoot = createTempProfilesRoot();
    const flatMemory = join(profilesRoot, '_memory', 'runpod.md');

    writeFile(flatMemory, '---\nid: runpod\ntitle: Runpod\nsummary: Notes\ntags: [gpu]\nupdated: 2026-03-17\n---\nRunpod\n');

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.migratedFiles).toEqual([
      { from: flatMemory, to: join(profilesRoot, '_memory', 'runpod', 'MEMORY.md') },
    ]);
    expect(existsSync(flatMemory)).toBe(false);
    expect(readFileSync(join(profilesRoot, '_memory', 'runpod', 'MEMORY.md'), 'utf-8')).toContain('name: runpod');
  });

  it('relocates top-level canonical packages into parent references', () => {
    const profilesRoot = createTempProfilesRoot();
    const hubPath = join(profilesRoot, '_memory', 'personal-agent', 'MEMORY.md');
    const canonicalPath = join(profilesRoot, '_memory', 'personal-agent-web-ui-preferences', 'MEMORY.md');

    writeFile(hubPath, `---
name: personal-agent
description: Hub doc.
metadata:
  role: hub
  updated: 2026-03-19
---

# personal-agent
`);
    writeFile(canonicalPath, `---
name: personal-agent-web-ui-preferences
description: Durable UI notes.
metadata:
  role: canonical
  parent: personal-agent
  updated: 2026-03-19
---

# Web UI preferences
`);

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });
    const targetPath = join(profilesRoot, '_memory', 'personal-agent', 'references', 'personal-agent-web-ui-preferences.md');

    expect(result.migratedFiles).toContainEqual({ from: canonicalPath, to: targetPath });
    expect(existsSync(canonicalPath)).toBe(false);
    expect(readFileSync(targetPath, 'utf-8')).toContain('name: personal-agent-web-ui-preferences');
  });

  it('removes legacy duplicates when the package target already exists with the same content', () => {
    const profilesRoot = createTempProfilesRoot();
    const legacyPath = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const targetPath = join(profilesRoot, '_memory', 'runpod', 'MEMORY.md');
    const content = '---\nname: runpod\ndescription: Notes\nmetadata:\n  tags:\n    - gpu\n  updated: 2026-03-17\n---\n\n# Runpod\n';

    writeFile(legacyPath, content);
    writeFile(targetPath, content);

    const result = migrateLegacyProfileMemoryDirs({ profilesRoot });

    expect(result.migratedFiles).toEqual([]);
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(targetPath, 'utf-8')).toBe(content);
  });

  it('preserves differing legacy files as backups when the package target already exists', () => {
    const profilesRoot = createTempProfilesRoot();
    const legacyPath = join(profilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const targetPath = join(profilesRoot, '_memory', 'runpod', 'MEMORY.md');
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
