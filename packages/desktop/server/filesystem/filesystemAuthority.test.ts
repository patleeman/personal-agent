import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FileSystemAuthority, FileSystemAuthorityError } from './filesystemAuthority.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fs-authority-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('FileSystemAuthority', () => {
  it('scopes reads and writes to a granted root', async () => {
    const cwd = tempDir();
    const authority = new FileSystemAuthority();
    const root = await authority.requestRoot({
      subject: { type: 'core', id: 'test' },
      root: { kind: 'workspace', id: cwd, path: cwd },
      access: ['read', 'write'],
      reason: 'test',
    });

    await root.writeText('nested/file.txt', 'hello');

    expect(readFileSync(join(cwd, 'nested/file.txt'), 'utf-8')).toBe('hello');
    await expect(root.readText('../escape.txt')).rejects.toMatchObject({ code: 'PATH_ESCAPE' });
  });

  it('denies operations missing access', async () => {
    const cwd = tempDir();
    const root = await new FileSystemAuthority().requestRoot({
      subject: { type: 'core', id: 'test' },
      root: { kind: 'workspace', id: cwd, path: cwd },
      access: ['read'],
      reason: 'test',
    });

    await expect(root.writeText('file.txt', 'nope')).rejects.toMatchObject({ code: 'MISSING_ACCESS' });
  });

  it('applies policy and hooks around operations', async () => {
    const cwd = tempDir();
    writeFileSync(join(cwd, 'allowed.txt'), 'ok');
    const audit = vi.fn();
    const after = vi.fn();
    const authority = new FileSystemAuthority({
      decide: (ctx) => (ctx.relativePath === 'blocked.txt' ? { type: 'deny', reason: 'blocked' } : { type: 'allow' }),
    });
    authority.onAudit(audit);
    authority.registerHook({ id: 'test-hook', after });
    const root = await authority.requestRoot({
      subject: { type: 'core', id: 'test' },
      root: { kind: 'workspace', id: cwd, path: cwd },
      access: ['read'],
      reason: 'test',
    });

    await expect(root.readText('allowed.txt')).resolves.toBe('ok');
    await expect(root.readText('blocked.txt')).rejects.toBeInstanceOf(FileSystemAuthorityError);

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', relativePath: 'allowed.txt', outcome: 'success' }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ operation: 'read', relativePath: 'blocked.txt', outcome: 'denied' }));
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ relativePath: 'allowed.txt', outcome: 'success' }));
  });

  it('creates private temp roots', async () => {
    const authority = new FileSystemAuthority();
    const root = await authority.createTempRoot({ subject: { type: 'core', id: 'test' }, access: ['write', 'metadata'], reason: 'test' });

    await root.writeText('out.txt', 'ok');

    await expect(root.exists('out.txt')).resolves.toBe(true);
  });
});
