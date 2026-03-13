import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { completeSimpleMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
}));

vi.mock('@mariozechner/pi-ai', () => ({
  completeSimple: completeSimpleMock,
}));

import {
  buildConversationTitleTranscript,
  generateConversationTitle,
  normalizeGeneratedConversationTitle,
  readConversationAutoTitleSettings,
} from './conversationAutoTitle.js';

const tempDirs: string[] = [];

afterEach(() => {
  completeSimpleMock.mockReset();
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
      model: 'gpt-5.1-codex-mini',
      reasoning: 'minimal',
      maxMessages: 8,
      maxTitleLength: 80,
    });
  });

  it('falls back to the saved runtime model defaults when no title model is configured', () => {
    const dir = createTempDir('pa-conversation-title-');
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    }));

    expect(readConversationAutoTitleSettings(file)).toEqual({
      enabled: true,
      provider: 'openai-codex',
      model: 'gpt-5.4',
      reasoning: 'minimal',
      maxMessages: 8,
      maxTitleLength: 80,
    });
  });

  it('reads nested web ui conversation title settings', () => {
    const dir = createTempDir('pa-conversation-title-');
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      webUi: {
        conversationTitles: {
          enabled: false,
          model: 'openrouter/openai/gpt-5-mini',
          provider: 'openai',
          reasoning: 'low',
          maxMessages: 4,
          maxTitleLength: 48,
        },
      },
    }));

    expect(readConversationAutoTitleSettings(file)).toEqual({
      enabled: false,
      provider: 'openai',
      model: 'openrouter/openai/gpt-5-mini',
      reasoning: 'low',
      maxMessages: 4,
      maxTitleLength: 48,
    });
  });
});

describe('buildConversationTitleTranscript', () => {
  it('keeps only user and assistant message text while removing tool calls and thinking', () => {
    expect(buildConversationTitleTranscript([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Debug the failing session title update.' },
          { type: 'image', data: 'abc', mimeType: 'image/png' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'First inspect the event flow.' },
          { type: 'toolCall', id: 'tool-1', name: 'bash', arguments: { command: 'rg title' } },
          { type: 'text', text: 'The title currently comes from the first user message.' },
        ],
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'ignored tool result' }],
      },
    ])).toBe([
      'User: Debug the failing session title update. (image attachment)',
      'Assistant: The title currently comes from the first user message.',
    ].join('\n'));
  });

  it('returns an empty transcript until there is a visible assistant reply', () => {
    expect(buildConversationTitleTranscript([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Only a draft so far.' }],
      },
    ])).toBe('');
  });
});

describe('normalizeGeneratedConversationTitle', () => {
  it('strips wrappers and keeps a single concise line', () => {
    expect(normalizeGeneratedConversationTitle('Title: "Fix live conversation renaming"\n\nExtra notes')).toBe('Fix live conversation renaming');
  });
});

describe('generateConversationTitle', () => {
  it('prompts the configured small model with transcript-only messages and normalizes the result', async () => {
    completeSimpleMock.mockResolvedValue({
      content: [{ type: 'text', text: '"Rename chats from first assistant reply"' }],
    });

    const model = {
      id: 'gpt-5-mini',
      provider: 'openai',
      api: 'openai-responses',
    } as any;
    const modelRegistry = {
      getAvailable: () => [model],
      getApiKey: vi.fn().mockResolvedValue('test-key'),
    };

    const title = await generateConversationTitle({
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Make conversation names easier to scan.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'I can generate a better title after the first reply.' }] },
        { role: 'toolResult', content: [{ type: 'text', text: 'ignored' }] },
      ],
      modelRegistry,
      settings: {
        enabled: true,
        provider: 'openai',
        model: 'gpt-5-mini',
        reasoning: 'minimal',
        maxMessages: 8,
        maxTitleLength: 80,
      },
      now: 123,
    });

    expect(title).toBe('Rename chats from first assistant reply');
    expect(modelRegistry.getApiKey).toHaveBeenCalledWith(model);
    expect(completeSimpleMock).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('concise, specific titles'),
        messages: [
          expect.objectContaining({
            role: 'user',
            timestamp: 123,
            content: [
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('User: Make conversation names easier to scan.\nAssistant: I can generate a better title after the first reply.'),
              }),
            ],
          }),
        ],
      }),
      expect.objectContaining({
        apiKey: 'test-key',
        reasoning: 'minimal',
        temperature: 0.2,
        maxTokens: 32,
        cacheRetention: 'none',
      }),
    );
  });
});
