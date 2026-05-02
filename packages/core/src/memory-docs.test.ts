import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getMemoryDocsDir, migrateLegacyProfileMemoryDirs } from './memory-docs.js';

const tempDirs: string[] = [];

function createTempVaultRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-memory-docs-'));
  const dir = join(root, 'sync');
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
  it('stores shared note nodes under the sync notes root', () => {
    const vaultRoot = createTempVaultRoot();
    expect(getMemoryDocsDir({ vaultRoot })).toBe(join(vaultRoot, 'notes'));
  });

  it('does not migrate legacy profile, shared, or runtime memory anymore', () => {
    const vaultRoot = createTempVaultRoot();
    const legacyProfilesRoot = join(vaultRoot, '_profiles');
    const assistantMemory = join(legacyProfilesRoot, 'assistant', 'agent', 'memory', 'runpod.md');
    const legacyPackagePath = join(vaultRoot, 'memory', 'runpod', 'MEMORY.md');
    const runtimeNote = join(vaultRoot, '..', 'pi-agent-runtime', 'notes', 'desktop.md');

    writeFile(assistantMemory, '---\nid: runpod\ntitle: Runpod\nsummary: Notes\n---\nRunpod\n');
    writeFile(legacyPackagePath, '---\nname: runpod\ndescription: Runpod notes.\n---\n# Runpod\n');
    writeFile(runtimeNote, '---\nid: desktop\ntitle: Desktop\nsummary: Server notes\n---\n# Desktop\n');

    const result = migrateLegacyProfileMemoryDirs({ vaultRoot });

    expect(result.memoryDir).toBe(join(vaultRoot, 'notes'));
    expect(result.migratedFiles).toEqual([]);
    expect(existsSync(assistantMemory)).toBe(true);
    expect(existsSync(legacyPackagePath)).toBe(true);
    expect(existsSync(runtimeNote)).toBe(true);
    expect(existsSync(join(vaultRoot, 'notes', 'runpod', 'INDEX.md'))).toBe(false);
    expect(existsSync(join(vaultRoot, 'notes', 'desktop.md'))).toBe(false);
  });
});
