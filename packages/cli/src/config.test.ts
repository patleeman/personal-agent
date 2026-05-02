import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfigFilePath, readConfig, setDefaultProfile, writeConfig } from './config.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('cli config', () => {
  it('uses explicit config file path from env', () => {
    process.env.PERSONAL_AGENT_CONFIG_FILE = '/tmp/custom-config.json';
    expect(getConfigFilePath()).toBe('/tmp/custom-config.json');
  });

  it('returns defaults when config file is missing', () => {
    process.env.PERSONAL_AGENT_CONFIG_FILE = join(tempDir('pa-config-'), 'missing.json');
    expect(readConfig()).toEqual({ defaultProfile: 'shared' });
  });

  it('falls back to defaults when config file JSON is invalid', () => {
    const file = join(tempDir('pa-config-'), 'config.json');
    process.env.PERSONAL_AGENT_CONFIG_FILE = file;
    writeFileSync(file, '{invalid json');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(readConfig()).toEqual({ defaultProfile: 'shared' });
    expect(errorSpy).toHaveBeenCalled();
  });

  it('writes config and updates default profile', () => {
    const file = join(tempDir('pa-config-'), 'config.json');
    process.env.PERSONAL_AGENT_CONFIG_FILE = file;

    writeConfig({ defaultProfile: 'datadog' });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ defaultProfile: 'datadog' });

    setDefaultProfile('shared');
    expect(readConfig().defaultProfile).toBe('shared');
  });
});
