import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readDictationSettings } from './settings.js';

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-dictation-settings-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('dictation settings', () => {
  it('falls back to defaults when the settings file is corrupt', () => {
    const settingsFile = join(createTempDir(), 'settings.json');
    writeFileSync(settingsFile, '{ nope');

    expect(readDictationSettings(settingsFile)).toEqual({ enabled: false, model: 'base.en' });
  });
});
