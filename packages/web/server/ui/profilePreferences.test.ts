import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  readSavedProfilePreferences,
  resolveActiveProfile,
  writeSavedProfilePreferences,
} from './profilePreferences.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-profile-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('profile preferences', () => {
  it('returns shared when the config file is missing', () => {
    const dir = createTempDir();
    expect(readSavedProfilePreferences(join(dir, 'config.json'))).toEqual({ defaultProfile: 'shared' });
  });

  it('reads the saved default profile from config.json', () => {
    const dir = createTempDir();
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ defaultProfile: 'datadog' }));

    expect(readSavedProfilePreferences(file)).toEqual({ defaultProfile: 'datadog' });
  });

  it('writes the default profile in the shared config shape', () => {
    const dir = createTempDir();
    const file = join(dir, 'config.json');

    writeSavedProfilePreferences('assistant', file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ defaultProfile: 'assistant' });
  });

  it('prefers an explicit profile when it exists in the repo', () => {
    expect(resolveActiveProfile({
      explicitProfile: 'assistant',
      savedProfile: 'datadog',
      availableProfiles: ['assistant', 'datadog', 'shared'],
    })).toBe('assistant');
  });

  it('falls back to the saved profile when the explicit one is unavailable', () => {
    expect(resolveActiveProfile({
      explicitProfile: 'missing',
      savedProfile: 'datadog',
      availableProfiles: ['datadog', 'shared'],
    })).toBe('datadog');
  });

  it('falls back to shared or the first available profile', () => {
    expect(resolveActiveProfile({
      explicitProfile: 'missing',
      savedProfile: 'also-missing',
      availableProfiles: ['shared', 'assistant'],
    })).toBe('shared');

    expect(resolveActiveProfile({
      explicitProfile: 'missing',
      savedProfile: 'also-missing',
      availableProfiles: ['assistant'],
    })).toBe('assistant');
  });
});
