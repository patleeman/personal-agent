import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getMachineConfigFilePath,
  readMachineConfigSection,
  readMachineVaultRoot,
  updateMachineConfigSection,
  writeMachineDefaultProfile,
  writeMachineVaultRoot,
} from './machine-config.js';

const originalEnv = process.env;
const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('machine config', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uses only PERSONAL_AGENT_CONFIG_FILE for the shared machine config path', () => {
    const configDir = createTempDir('pa-machine-config-');
    const daemonConfigPath = join(configDir, 'daemon.json');
    const webConfigPath = join(configDir, 'web.json');
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = webConfigPath;

    const resolvedPath = getMachineConfigFilePath();
    expect(resolvedPath).not.toBe(daemonConfigPath);
    expect(resolvedPath).not.toBe(webConfigPath);
    expect(resolvedPath.endsWith('/config.json')).toBe(true);

    process.env.PERSONAL_AGENT_CONFIG_FILE = join(configDir, 'custom-config.json');
    expect(getMachineConfigFilePath()).toBe(join(configDir, 'custom-config.json'));
  });

  it('still honors legacy section-specific env overrides', () => {
    const configDir = createTempDir('pa-machine-config-');
    const daemonConfigPath = join(configDir, 'daemon.json');
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = daemonConfigPath;

    updateMachineConfigSection('daemon', () => ({ modules: { tasks: { pollIntervalMs: 5000 } } }));

    expect(readMachineConfigSection('daemon')).toEqual({ modules: { tasks: { pollIntervalMs: 5000 } } });
    expect(JSON.parse(readFileSync(daemonConfigPath, 'utf-8'))).toEqual({ modules: { tasks: { pollIntervalMs: 5000 } } });
  });

  it('writes generic machine config to config.json even when legacy section env vars are set', () => {
    const configDir = createTempDir('pa-machine-config-');
    process.env.PERSONAL_AGENT_DAEMON_CONFIG = join(configDir, 'daemon.json');
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = join(configDir, 'web.json');

    writeMachineDefaultProfile('assistant', { configRoot: configDir });

    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({ defaultProfile: 'assistant' });
  });

  it('reads and writes the machine vault root in config.json', () => {
    const configDir = createTempDir('pa-machine-config-');

    writeMachineVaultRoot('~/Documents/personal-agent', { configRoot: configDir });
    expect(readMachineVaultRoot({ configRoot: configDir })).toBe('~/Documents/personal-agent');
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({ vaultRoot: '~/Documents/personal-agent' });

    writeMachineVaultRoot('', { configRoot: configDir });
    expect(readMachineVaultRoot({ configRoot: configDir })).toBe('');
    expect(JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf-8'))).toEqual({});
  });
});
