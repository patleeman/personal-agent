import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSavedThemePreferences, writeSavedThemePreferences } from './themePreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-theme-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('readSavedThemePreferences', () => {
  it('returns sane defaults when the file is missing', () => {
    const dir = createTempDir();
    expect(readSavedThemePreferences(join(dir, 'settings.json'))).toEqual({
      currentTheme: '',
      themeMode: 'system',
      themeDark: '',
      themeLight: '',
    });
  });

  it('reads stored theme mapping values', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      theme: 'cobalt2',
      themeMode: 'dark',
      themeDark: 'cobalt2',
      themeLight: 'cobalt2-light',
    }));

    expect(readSavedThemePreferences(file)).toEqual({
      currentTheme: 'cobalt2',
      themeMode: 'dark',
      themeDark: 'cobalt2',
      themeLight: 'cobalt2-light',
    });
  });
});

describe('writeSavedThemePreferences', () => {
  it('writes theme mapping while preserving unrelated keys', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'gpt-5.4' }));

    writeSavedThemePreferences({
      themeMode: 'light',
      themeDark: 'cobalt2',
      themeLight: 'cobalt2-light',
    }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultModel: 'gpt-5.4',
      themeMode: 'light',
      themeDark: 'cobalt2',
      themeLight: 'cobalt2-light',
    });
  });

  it('removes theme names when empty strings are provided', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      themeDark: 'cobalt2',
      themeLight: 'cobalt2-light',
    }));

    writeSavedThemePreferences({ themeDark: '', themeLight: '' }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({});
  });
});
