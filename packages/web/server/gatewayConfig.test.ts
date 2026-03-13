import { describe, expect, it } from 'vitest';
import {
  buildGatewayStoredConfig,
  listGatewayEnvOverrideKeys,
  parseGatewayConfigUpdateInput,
  summarizeGatewayToken,
} from './gatewayConfig.js';

describe('summarizeGatewayToken', () => {
  it('marks missing tokens as unconfigured', () => {
    expect(summarizeGatewayToken(undefined)).toEqual({
      configured: false,
      source: 'missing',
    });
  });

  it('masks plain tokens', () => {
    expect(summarizeGatewayToken('123456789')).toEqual({
      configured: true,
      source: 'plain',
      preview: '••••6789',
    });
  });

  it('surfaces 1Password references directly', () => {
    expect(summarizeGatewayToken('op://Assistant/Telegram/token')).toEqual({
      configured: true,
      source: 'one-password',
      preview: 'op://Assistant/Telegram/token',
    });
  });
});

describe('listGatewayEnvOverrideKeys', () => {
  it('returns only configured gateway override keys', () => {
    expect(listGatewayEnvOverrideKeys({
      PATH: '/usr/bin',
      TELEGRAM_BOT_TOKEN: 'token',
      PERSONAL_AGENT_TELEGRAM_ALLOWLIST: '1,2',
      PERSONAL_AGENT_TELEGRAM_CWD: '   ',
    })).toEqual([
      'TELEGRAM_BOT_TOKEN',
      'PERSONAL_AGENT_TELEGRAM_ALLOWLIST',
    ]);
  });
});

describe('parseGatewayConfigUpdateInput', () => {
  it('normalizes and validates gateway config form input', () => {
    expect(parseGatewayConfigUpdateInput({
      profile: ' assistant ',
      token: ' op://Assistant/Telegram/token ',
      allowlistChatIds: [' 123 ', '456', '123', ''],
      allowedUserIds: [' 42 '],
      blockedUserIds: [' 99 '],
      workingDirectory: ' /tmp/work ',
      maxPendingPerChat: 4.9,
      toolActivityStream: true,
      clearRecentMessagesOnNew: false,
    })).toEqual({
      profile: 'assistant',
      token: 'op://Assistant/Telegram/token',
      clearToken: false,
      allowlistChatIds: ['123', '456'],
      allowedUserIds: ['42'],
      blockedUserIds: ['99'],
      workingDirectory: '/tmp/work',
      maxPendingPerChat: 4,
      toolActivityStream: true,
      clearRecentMessagesOnNew: false,
    });
  });

  it('rejects invalid numeric inputs', () => {
    expect(() => parseGatewayConfigUpdateInput({
      profile: 'shared',
      allowlistChatIds: [],
      allowedUserIds: [],
      blockedUserIds: [],
      maxPendingPerChat: 0,
      toolActivityStream: false,
      clearRecentMessagesOnNew: true,
    })).toThrow('maxPendingPerChat must be a positive integer');
  });
});

describe('buildGatewayStoredConfig', () => {
  it('keeps the existing token when the draft leaves it blank', () => {
    expect(buildGatewayStoredConfig({
      profile: 'shared',
      telegram: {
        token: 'stored-token',
        allowlist: ['1'],
        toolActivityStream: false,
        clearRecentMessagesOnNew: true,
      },
    }, {
      profile: 'assistant',
      allowlistChatIds: ['2'],
      allowedUserIds: ['42'],
      blockedUserIds: [],
      workingDirectory: '/tmp/work',
      maxPendingPerChat: 5,
      toolActivityStream: true,
      clearRecentMessagesOnNew: false,
    })).toEqual({
      profile: 'assistant',
      telegram: {
        token: 'stored-token',
        allowlist: ['2'],
        allowedUserIds: ['42'],
        blockedUserIds: undefined,
        workingDirectory: '/tmp/work',
        maxPendingPerChat: 5,
        toolActivityStream: true,
        clearRecentMessagesOnNew: false,
      },
    });
  });

  it('clears the saved token when requested explicitly', () => {
    expect(buildGatewayStoredConfig({
      profile: 'shared',
      telegram: {
        token: 'stored-token',
        toolActivityStream: false,
        clearRecentMessagesOnNew: true,
      },
    }, {
      profile: 'shared',
      clearToken: true,
      allowlistChatIds: [],
      allowedUserIds: [],
      blockedUserIds: [],
      toolActivityStream: false,
      clearRecentMessagesOnNew: true,
    })).toEqual({
      profile: 'shared',
      telegram: {
        token: undefined,
        allowlist: undefined,
        allowedUserIds: undefined,
        blockedUserIds: undefined,
        workingDirectory: undefined,
        maxPendingPerChat: undefined,
        toolActivityStream: false,
        clearRecentMessagesOnNew: true,
      },
    });
  });
});
