import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createProtectedUpdateAuthHeader,
  createProtectedUpdateFeedOptions,
  loadProtectedUpdateFeedConfig,
  normalizeProtectedUpdateFeedConfig,
  PACKAGED_UPDATE_CONFIG_FILE,
} from './protected-update-feed.js';

describe('normalizeProtectedUpdateFeedConfig', () => {
  it('accepts a valid protected update feed config', () => {
    expect(normalizeProtectedUpdateFeedConfig({
      url: 'https://updates.example.test/stable',
      token: 'secret-token',
    })).toEqual({
      url: 'https://updates.example.test/stable',
      token: 'secret-token',
    });
  });

  it('rejects config values missing a token', () => {
    expect(normalizeProtectedUpdateFeedConfig({
      url: 'https://updates.example.test/stable',
    })).toBeNull();
  });
});

describe('loadProtectedUpdateFeedConfig', () => {
  it('reads the packaged config file when env overrides are absent', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'personal-agent-update-feed-'));
    writeFileSync(join(resourcesPath, PACKAGED_UPDATE_CONFIG_FILE), JSON.stringify({
      url: 'https://updates.example.test/stable',
      token: 'file-token',
    }), 'utf-8');

    expect(loadProtectedUpdateFeedConfig({ env: {}, resourcesPath })).toEqual({
      url: 'https://updates.example.test/stable',
      token: 'file-token',
    });
  });

  it('lets env overrides replace the packaged config', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'personal-agent-update-feed-'));
    writeFileSync(join(resourcesPath, PACKAGED_UPDATE_CONFIG_FILE), JSON.stringify({
      url: 'https://updates.example.test/stable',
      token: 'file-token',
    }), 'utf-8');

    expect(loadProtectedUpdateFeedConfig({
      env: {
        PERSONAL_AGENT_UPDATE_BASE_URL: 'https://override.example.test/stable',
        PERSONAL_AGENT_DOWNLOAD_TOKEN: 'env-token',
      },
      resourcesPath,
    })).toEqual({
      url: 'https://override.example.test/stable',
      token: 'env-token',
    });
  });

  it('returns null when neither env nor packaged config contain a complete feed config', () => {
    const resourcesPath = mkdtempSync(join(tmpdir(), 'personal-agent-update-feed-'));
    mkdirSync(resourcesPath, { recursive: true });

    expect(loadProtectedUpdateFeedConfig({ env: {}, resourcesPath })).toBeNull();
  });
});

describe('protected update feed helpers', () => {
  it('builds a generic provider config and bearer auth header', () => {
    const config = {
      url: 'https://updates.example.test/stable',
      token: 'secret-token',
    };

    expect(createProtectedUpdateFeedOptions(config)).toEqual({
      provider: 'generic',
      url: 'https://updates.example.test/stable',
      useMultipleRangeRequest: false,
    });
    expect(createProtectedUpdateAuthHeader(config)).toBe('Bearer secret-token');
  });
});
