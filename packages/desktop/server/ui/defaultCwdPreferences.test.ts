import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSavedDefaultCwdPreferences, writeSavedDefaultCwdPreference } from './defaultCwdPreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-default-cwd-'));
  tempDirs.push(dir);
  return dir;
}

describe('readSavedDefaultCwdPreferences', () => {
  it('falls back to the provided cwd when the settings file is missing', () => {
    const dir = createTempDir();
    const fallbackCwd = join(dir, 'fallback');
    mkdirSync(fallbackCwd, { recursive: true });

    expect(readSavedDefaultCwdPreferences(join(dir, 'settings.json'), fallbackCwd)).toEqual({
      currentCwd: '',
      effectiveCwd: fallbackCwd,
    });
  });

  it('falls back when a saved cwd no longer exists', () => {
    const dir = createTempDir();
    const fallbackCwd = join(dir, 'fallback');
    mkdirSync(fallbackCwd, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ defaultCwd: './missing' }));

    expect(readSavedDefaultCwdPreferences(join(dir, 'settings.json'), fallbackCwd)).toEqual({
      currentCwd: './missing',
      effectiveCwd: fallbackCwd,
    });
  });
});

describe('writeSavedDefaultCwdPreference', () => {
  it('writes the saved default cwd while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    const workspace = join(dir, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(file, JSON.stringify({ defaultModel: 'gpt-5.4' }));

    expect(writeSavedDefaultCwdPreference({ cwd: './workspace' }, file, {
      baseDir: dir,
      validate: true,
    })).toEqual({
      currentCwd: './workspace',
      effectiveCwd: workspace,
    });

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
      defaultCwd: './workspace',
    });
  });

  it('clears the saved cwd when given an empty value', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    const fallbackCwd = join(dir, 'fallback');
    mkdirSync(fallbackCwd, { recursive: true });
    writeFileSync(file, JSON.stringify({
      defaultModel: 'gpt-5.4',
      defaultCwd: '~/workspace',
    }));

    expect(writeSavedDefaultCwdPreference({ cwd: '' }, file, { baseDir: fallbackCwd })).toEqual({
      currentCwd: '',
      effectiveCwd: fallbackCwd,
    });

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
    });
  });

  it('rejects missing directories when validation is enabled', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');

    expect(() => writeSavedDefaultCwdPreference({ cwd: './missing' }, file, {
      baseDir: dir,
      validate: true,
    })).toThrow(`Directory does not exist: ${join(dir, 'missing')}`);
  });
});
