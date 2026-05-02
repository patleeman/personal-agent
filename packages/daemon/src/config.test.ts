import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getDefaultDaemonConfig, loadDaemonConfig, writeDaemonPowerConfig } from './config.js';

const originalCompanionPort = process.env.PERSONAL_AGENT_COMPANION_PORT;
const originalConfigFile = process.env.PERSONAL_AGENT_CONFIG_FILE;

describe('daemon config', () => {
  afterEach(() => {
    if (originalCompanionPort === undefined) {
      delete process.env.PERSONAL_AGENT_COMPANION_PORT;
    } else {
      process.env.PERSONAL_AGENT_COMPANION_PORT = originalCompanionPort;
    }

    if (originalConfigFile === undefined) {
      delete process.env.PERSONAL_AGENT_CONFIG_FILE;
    } else {
      process.env.PERSONAL_AGENT_CONFIG_FILE = originalConfigFile;
    }
  });

  it('ignores malformed companion port environment values', () => {
    process.env.PERSONAL_AGENT_COMPANION_PORT = '123abc';

    expect(getDefaultDaemonConfig().companion?.port).toBe(3843);
  });

  it('defaults daemon power keepAwake to false', () => {
    expect(getDefaultDaemonConfig().power?.keepAwake).toBe(false);
  });

  it('reads and writes daemon power keepAwake in machine config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pa-daemon-config-'));
    const configFile = join(dir, 'config.json');
    process.env.PERSONAL_AGENT_CONFIG_FILE = configFile;

    expect(loadDaemonConfig().power?.keepAwake).toBe(false);
    expect(writeDaemonPowerConfig({ keepAwake: true }).power?.keepAwake).toBe(true);
    expect(JSON.parse(readFileSync(configFile, 'utf-8'))).toMatchObject({
      daemon: { power: { keepAwake: true } },
    });
    expect(loadDaemonConfig().power?.keepAwake).toBe(true);
  });
});
