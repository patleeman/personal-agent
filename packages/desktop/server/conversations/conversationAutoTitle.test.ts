import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeGeneratedConversationTitle, readConversationAutoTitleSettings } from './conversationAutoTitle.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('readConversationAutoTitleSettings', () => {
  it('returns the default titling settings when the settings file is missing', () => {
    expect(readConversationAutoTitleSettings(join(createTempDir('pa-conversation-title-'), 'settings.json'))).toEqual({
      enabled: true,
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
      reasoning: 'minimal',
      maxMessages: 8,
      maxTitleLength: 80,
    });
  });

  it('uses the built-in title model when no explicit title model is configured', () => {
    const dir = createTempDir('pa-conversation-title-');
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        defaultProvider: 'anthropic',
        defaultModel: 'claude-sonnet-4-6',
      }),
    );

    expect(readConversationAutoTitleSettings(file)).toEqual({
      enabled: true,
      provider: 'openai-codex',
      model: 'gpt-5.4-mini',
      reasoning: 'minimal',
      maxMessages: 8,
      maxTitleLength: 80,
    });
  });

  it('reads nested web ui conversation title settings', () => {
    const dir = createTempDir('pa-conversation-title-');
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          conversationTitles: {
            enabled: false,
            model: 'openrouter/openai/gpt-5-mini',
            provider: 'openai',
            reasoning: 'low',
            maxMessages: 4,
            maxTitleLength: 48,
          },
        },
      }),
    );

    expect(readConversationAutoTitleSettings(file)).toEqual({
      enabled: false,
      provider: 'openai',
      model: 'openrouter/openai/gpt-5-mini',
      reasoning: 'low',
      maxMessages: 4,
      maxTitleLength: 48,
    });
  });

  it('falls back for unsafe conversation title integer settings', () => {
    const dir = createTempDir('pa-conversation-title-');
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          conversationTitles: {
            maxMessages: Number.MAX_SAFE_INTEGER + 1,
            maxTitleLength: Number.MAX_SAFE_INTEGER + 1,
          },
        },
      }),
    );

    expect(readConversationAutoTitleSettings(file)).toMatchObject({
      maxMessages: 8,
      maxTitleLength: 80,
    });
  });

  it('caps huge conversation title integer settings', () => {
    const dir = createTempDir('pa-conversation-title-');
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        ui: {
          conversationTitles: {
            maxMessages: Number.MAX_SAFE_INTEGER,
            maxTitleLength: Number.MAX_SAFE_INTEGER,
          },
        },
      }),
    );

    expect(readConversationAutoTitleSettings(file)).toMatchObject({
      maxMessages: 32,
      maxTitleLength: 160,
    });
  });
});

describe('normalizeGeneratedConversationTitle', () => {
  it('strips wrappers and keeps a single concise line', () => {
    expect(normalizeGeneratedConversationTitle('Title: "Fix live conversation renaming"\n\nExtra notes')).toBe(
      'Fix live conversation renaming',
    );
  });
});
