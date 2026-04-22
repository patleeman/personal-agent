import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReferencedVaultFilesContext,
  listVaultFiles,
  resolveMentionedVaultFiles,
  resolveVaultFileById,
} from './vaultFiles.js';

const createdDirs: string[] = [];

function createVaultFixture(): string {
  const root = join(tmpdir(), `personal-agent-vault-files-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  createdDirs.push(root);
  mkdirSync(join(root, 'notes'), { recursive: true });
  mkdirSync(join(root, '_profiles', 'datadog'), { recursive: true });
  mkdirSync(join(root, '.git'), { recursive: true });
  writeFileSync(join(root, 'notes', 'daily.md'), '# Daily\n');
  writeFileSync(join(root, '_profiles', 'datadog', 'AGENTS.md'), '# Datadog\n');
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return root;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('vaultFiles', () => {
  it('lists root-relative folders and files and skips ignored directories', () => {
    const root = createVaultFixture();

    expect(listVaultFiles(root).map((file) => `${file.kind}:${file.id}`)).toEqual([
      'folder:notes/',
      'file:notes/daily.md',
    ]);
  });

  it('resolves mentioned folders and files in encounter order and ignores unsafe paths', () => {
    const root = createVaultFixture();

    expect(resolveMentionedVaultFiles(
      'Review @notes/ and @notes/daily.md and then @_profiles/datadog/AGENTS.md but ignore @../secrets.txt.',
      root,
    ).map((file) => `${file.kind}:${file.id}`)).toEqual([
      'folder:notes/',
      'file:notes/daily.md',
    ]);

    expect(resolveVaultFileById('../secrets.txt', root)).toBeNull();
    expect(resolveVaultFileById('notes/', root)?.kind).toBe('folder');
  });

  it('builds indexed path context for folders and files', () => {
    const root = createVaultFixture();
    const folder = resolveVaultFileById('notes/', root);
    const file = resolveVaultFileById('notes/daily.md', root);
    expect(folder).not.toBeNull();
    expect(file).not.toBeNull();

    const context = buildReferencedVaultFilesContext([folder!, file!]);
    expect(context).toContain('Referenced indexed paths:');
    expect(context).toContain('@notes/');
    expect(context).toContain('kind: folder');
    expect(context).toContain('children (1):');
    expect(context).toContain('@notes/daily.md');
    expect(context).toContain(join(root, 'notes', 'daily.md'));
  });
});
