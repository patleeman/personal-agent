import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createExtensionFilesystemCapability } from './extensionFilesystem.js';
import { createExtensionWorkspaceCapability } from './extensionWorkspace.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'extension-workspace-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('extension filesystem and workspace capabilities', () => {
  it('implements workspace helpers on top of filesystem authority', async () => {
    const cwd = tempDir();
    const workspace = createExtensionWorkspaceCapability('test-extension');

    await workspace.writeText({ cwd, path: 'notes/today.txt', content: 'hello' });
    const read = await workspace.readText({ cwd, path: 'notes/today.txt' });
    const listing = await workspace.list({ cwd, path: '.', depth: 2 });

    expect(read.content).toBe('hello');
    expect(read.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(listing).toContainEqual(expect.objectContaining({ path: 'notes/today.txt', type: 'file', size: 5 }));
    await expect(workspace.writeText({ cwd, path: '../escape.txt', content: 'nope' })).rejects.toMatchObject({ code: 'PATH_ESCAPE' });
  });

  it('exposes filesystem roots directly for extensions', async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, 'input.txt'), 'ok');
    const filesystem = createExtensionFilesystemCapability('test-extension', { cwd });
    const root = await filesystem.workspace({ access: ['read', 'write'], reason: 'test' });

    expect(await root.readText('input.txt')).toBe('ok');
    await root.writeText('output.txt', 'done');

    expect(readFileSync(join(cwd, 'output.txt'), 'utf-8')).toBe('done');
  });
});
