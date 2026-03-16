import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeRequestedLocalPath,
  openLocalPathOnHost,
  resolveLocalPathOpenCommand,
} from './localPathOpener.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempFile(name = 'note.md'): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-local-path-'));
  tempDirs.push(dir);
  const filePath = join(dir, name);
  writeFileSync(filePath, '# note\n');
  return filePath;
}

describe('resolveLocalPathOpenCommand', () => {
  it('maps supported platforms to their opener command', () => {
    expect(resolveLocalPathOpenCommand('darwin')).toBe('open');
    expect(resolveLocalPathOpenCommand('linux')).toBe('xdg-open');
    expect(resolveLocalPathOpenCommand('win32')).toBeNull();
  });
});

describe('normalizeRequestedLocalPath', () => {
  it('expands home-relative paths', () => {
    expect(normalizeRequestedLocalPath('~/notes/today.md', '/Users/patrick')).toBe('/Users/patrick/notes/today.md');
  });

  it('rejects relative paths', () => {
    expect(() => normalizeRequestedLocalPath('notes/today.md', '/Users/patrick')).toThrow('Path must be absolute or start with ~/.');
  });
});

describe('openLocalPathOnHost', () => {
  it('opens an existing path with the platform opener', () => {
    const filePath = createTempFile();
    const runCommand = vi.fn(() => ({
      pid: 123,
      status: 0,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      output: [] as Buffer[],
    }));

    const openedPath = openLocalPathOnHost(filePath, {
      platform: 'darwin',
      runCommand,
    });

    expect(openedPath).toBe(filePath);
    expect(runCommand).toHaveBeenCalledWith('open', [filePath]);
  });

  it('rejects missing paths before invoking the opener', () => {
    const runCommand = vi.fn(() => ({
      pid: 123,
      status: 0,
      signal: null,
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      output: [] as Buffer[],
    }));

    expect(() => openLocalPathOnHost('/tmp/definitely-missing-pa-path', {
      platform: 'darwin',
      runCommand,
    })).toThrow('Path not found');
    expect(runCommand).not.toHaveBeenCalled();
  });
});
