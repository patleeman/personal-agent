import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { completeSimpleMock } = vi.hoisted(() => ({
  completeSimpleMock: vi.fn(),
}));

vi.mock('@earendil-works/pi-ai', () => ({
  completeSimple: completeSimpleMock,
}));

vi.mock('@personal-agent/core', async (importOriginal) => ({
  ...(await importOriginal()),
  requirePromptCatalogEntry: () => 'Write a short, scan-friendly title for this conversation. Return only the title.',
}));

import {
  buildConversationTitleTranscript,
  type ConversationTitleModelRegistry,
  generateConversationTitle,
  normalizeGeneratedConversationTitle,
  readConversationAutoTitleSettings,
} from './conversationAutoTitle.js';

const tempDirs: string[] = [];
type TitleModel = ReturnType<ConversationTitleModelRegistry['getAvailable']>[number];

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

describe('buildConversationTitleTranscript', () => {
  it('keeps only user and assistant message text while removing tool calls and thinking', () => {
    expect(
      buildConversationTitleTranscript([
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
      ]),
    ).toBe(
      [
        'User: Debug the failing session title update. (image attachment)',
        'Assistant: The title currently comes from the first user message.',
      ].join('\n'),
    );
  });

  it('does not derive transcript attachment labels from malformed image blocks', () => {
    expect(
      buildConversationTitleTranscript([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Debug the title.' },
            { type: 'image', data: '', mimeType: '' },
            { type: 'image', data: 'not-valid-base64!', mimeType: 'image/png' },
            { type: 'image', data: 'aGVsbG8=', mimeType: 'text/plain' },
          ],
        },
        { role: 'assistant', content: [{ type: 'text', text: 'I will check it.' }] },
      ]),
    ).toBe(['User: Debug the title.', 'Assistant: I will check it.'].join('\n'));
  });

  it('returns an empty transcript until there is a visible assistant reply', () => {
    expect(
      buildConversationTitleTranscript([
        {
          role: 'user',
          content: [{ type: 'text', text: 'Only a draft so far.' }],
        },
      ]),
    ).toBe('');
  });

  it('defaults fractional transcript limits instead of letting slice truncate them', () => {
    expect(
      buildConversationTitleTranscript(
        [
          { role: 'user', content: [{ type: 'text', text: 'first user message' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'first assistant reply' }] },
          { role: 'user', content: [{ type: 'text', text: 'second user message' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'second assistant reply' }] },
        ],
        { maxMessages: 1.5 },
      ),
    ).toBe(
      [
        'User: first user message',
        'Assistant: first assistant reply',
        'User: second user message',
        'Assistant: second assistant reply',
      ].join('\n'),
    );

    expect(
      buildConversationTitleTranscript(
        [
          { role: 'user', content: [{ type: 'text', text: 'abcdef' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'assistant reply' }] },
        ],
        { maxMessageLength: 3.5 },
      ),
    ).toBe(['User: abcdef', 'Assistant: assistant reply'].join('\n'));
  });
});

describe('normalizeGeneratedConversationTitle', () => {
  it('strips wrappers and keeps a single concise line', () => {
    expect(normalizeGeneratedConversationTitle('Title: "Fix live conversation renaming"\n\nExtra notes')).toBe(
      'Fix live conversation renaming',
    );
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
    } as unknown as TitleModel;
    const modelRegistry = {
      getAvailable: () => [model],
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: 'test-key' }),
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
    expect(modelRegistry.getApiKeyAndHeaders).toHaveBeenCalledWith(model);
    expect(completeSimpleMock).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        systemPrompt: expect.stringContaining('scan-friendly title'),
        messages: [
          expect.objectContaining({
            role: 'user',
            timestamp: 123,
            content: [
              expect.objectContaining({
                type: 'text',
                text: expect.stringMatching(
                  /Optimize for a narrow one-line sidebar where only the first 24-32 characters may be visible\.[\s\S]*Put the most distinguishing words first and keep it under 80 characters\.[\s\S]*User: Make conversation names easier to scan\.\nAssistant: I can generate a better title after the first reply\./,
                ),
              }),
            ],
          }),
        ],
      }),
      expect.objectContaining({
        apiKey: 'test-key',
        reasoning: 'minimal',
        maxTokens: 32,
        cacheRetention: 'none',
      }),
    );
  });

  it('throws when the title model returns an error response', async () => {
    completeSimpleMock.mockResolvedValue({
      content: [],
      stopReason: 'error',
      errorMessage: 'Unsupported parameter: temperature',
    });

    const model = {
      id: 'gpt-5-mini',
      provider: 'openai',
      api: 'openai-responses',
    } as unknown as TitleModel;
    const modelRegistry = {
      getAvailable: () => [model],
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: 'test-key' }),
    };

    await expect(
      generateConversationTitle({
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Make conversation names easier to scan.' }] },
          { role: 'assistant', content: [{ type: 'text', text: 'I can generate a better title after the first reply.' }] },
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
      }),
    ).rejects.toThrow('Unsupported parameter: temperature');
  });
});
