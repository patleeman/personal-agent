import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultDaemonConfig } from './config.js';

const originalCompanionPort = process.env.PERSONAL_AGENT_COMPANION_PORT;

describe('daemon config', () => {
  afterEach(() => {
    if (originalCompanionPort === undefined) {
      delete process.env.PERSONAL_AGENT_COMPANION_PORT;
    } else {
      process.env.PERSONAL_AGENT_COMPANION_PORT = originalCompanionPort;
    }
  });

  it('ignores malformed companion port environment values', () => {
    process.env.PERSONAL_AGENT_COMPANION_PORT = '123abc';

    expect(getDefaultDaemonConfig().companion?.port).toBe(3843);
  });
});
