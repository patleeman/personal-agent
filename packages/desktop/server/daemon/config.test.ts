import { afterEach, describe, expect, it } from 'vitest';

import { getDefaultDaemonConfig } from './config.js';

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
});
