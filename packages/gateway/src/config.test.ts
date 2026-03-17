import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getGatewayConfigFilePath, readGatewayConfig, writeGatewayConfig } from './config.js';

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
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('gateway config', () => {
  it('reads explicit file path from env', () => {
    process.env.PERSONAL_AGENT_GATEWAY_CONFIG_FILE = '/tmp/gateway.json';
    expect(getGatewayConfigFilePath()).toBe('/tmp/gateway.json');
  });

  it('returns empty object for missing or invalid config', () => {
    const file = join(tempDir('pa-gateway-'), 'gateway.json');
    process.env.PERSONAL_AGENT_GATEWAY_CONFIG_FILE = file;

    expect(readGatewayConfig()).toEqual({});

    writeFileSync(file, '{bad json');
    expect(readGatewayConfig()).toEqual({});
  });

  it('sanitizes invalid entries and keeps valid settings', () => {
    const file = join(tempDir('pa-gateway-'), 'gateway.json');
    process.env.PERSONAL_AGENT_GATEWAY_CONFIG_FILE = file;

    writeFileSync(file, JSON.stringify({
      profile: 'shared',
      defaultModel: 'openai/gpt-5.4',
      telegram: {
        token: '  token  ',
        allowlist: [' 1 ', '', 2],
        allowedUserIds: [' 42 ', '', 99],
        blockedUserIds: [' 7 ', '', 11],
        maxPendingPerChat: 4.9,
        toolActivityStream: true,
        clearRecentMessagesOnNew: false,
      },
    }));

    expect(readGatewayConfig()).toEqual({
      profile: 'shared',
      defaultModel: 'openai/gpt-5.4',
      telegram: {
        token: '  token  ',
        allowlist: ['1'],
        allowedUserIds: ['42'],
        blockedUserIds: ['7'],
        workingDirectory: undefined,
        maxPendingPerChat: 4,
        toolActivityStream: true,
        clearRecentMessagesOnNew: false,
      },
    });
  });

  it('writes config JSON to disk', () => {
    const file = join(tempDir('pa-gateway-'), 'gateway.json');
    process.env.PERSONAL_AGENT_GATEWAY_CONFIG_FILE = file;

    writeGatewayConfig({ profile: 'assistant', defaultModel: 'openai/gpt-5.4', telegram: { token: 'x', allowlist: ['1'] } });

    const saved = JSON.parse(readFileSync(file, 'utf-8')) as { profile: string; defaultModel?: string };
    expect(saved.profile).toBe('assistant');
    expect(saved.defaultModel).toBe('openai/gpt-5.4');
  });
});
