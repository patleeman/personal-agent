import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSavedConversationTitlePreferences, writeSavedConversationTitlePreferences } from './conversationTitlePreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-conversation-title-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('readSavedConversationTitlePreferences', () => {
  it('returns defaults when the settings file is missing', () => {
    const dir = createTempDir();
    expect(readSavedConversationTitlePreferences(join(dir, 'settings.json'))).toEqual({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai-codex/gpt-5.1-codex-mini',
    });
  });

  it('reads nested conversation title preferences', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      webUi: {
        conversationTitles: {
          enabled: false,
          provider: 'openai-codex',
          model: 'gpt-5.4',
        },
      },
    }));

    expect(readSavedConversationTitlePreferences(file)).toEqual({
      enabled: false,
      currentModel: 'openai-codex/gpt-5.4',
      effectiveModel: 'openai-codex/gpt-5.4',
    });
  });
});

describe('writeSavedConversationTitlePreferences', () => {
  it('writes enabled and model while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      webUi: {
        openConversationIds: ['session-1'],
        conversationTitles: {
          maxMessages: 4,
        },
      },
    }));

    writeSavedConversationTitlePreferences({ enabled: false, model: 'anthropic/claude-sonnet-4-6' }, file);

    expect(readSavedConversationTitlePreferences(file)).toEqual({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      webUi: {
        openConversationIds: ['session-1'],
        conversationTitles: {
          enabled: false,
          maxMessages: 4,
          model: 'anthropic/claude-sonnet-4-6',
        },
      },
    });
  });

  it('clears the explicit model override without removing other title settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      webUi: {
        conversationTitles: {
          enabled: false,
          model: 'openai-codex/gpt-5.4',
          reasoning: 'low',
        },
      },
    }));

    writeSavedConversationTitlePreferences({ model: '' }, file);

    expect(readSavedConversationTitlePreferences(file)).toEqual({
      enabled: false,
      currentModel: '',
      effectiveModel: 'openai-codex/gpt-5.4',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      webUi: {
        conversationTitles: {
          enabled: false,
          reasoning: 'low',
        },
      },
    });
  });
});
