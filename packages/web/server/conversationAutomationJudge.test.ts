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
  DEFAULT_CONVERSATION_AUTOMATION_JUDGE_SYSTEM_PROMPT,
  buildConversationAutomationJudgeTranscript,
  readConversationAutomationJudgeSettings,
  readSavedConversationAutomationJudgePreferences,
  runConversationAutomationJudge,
  writeSavedConversationAutomationJudgePreferences,
  type ConversationAutomationJudgeModelRegistry,
} from './conversationAutomationJudge.js';

const tempDirs: string[] = [];
type JudgeModel = ReturnType<ConversationAutomationJudgeModelRegistry['getAvailable']>[number];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  completeSimpleMock.mockReset();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conversationAutomationJudge settings', () => {
  it('falls back to the runtime default model and built-in system prompt', () => {
    const file = join(createTempDir('pa-conversation-automation-judge-'), 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    }));

    expect(readConversationAutomationJudgeSettings(file)).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      systemPrompt: DEFAULT_CONVERSATION_AUTOMATION_JUDGE_SYSTEM_PROMPT,
    });
  });

  it('writes model and custom prompt into nested webUi settings', () => {
    const file = join(createTempDir('pa-conversation-automation-judge-'), 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'midnight' }));

    const saved = writeSavedConversationAutomationJudgePreferences({
      model: 'openai/gpt-5-mini',
      systemPrompt: 'Custom judge prompt.',
    }, file);

    expect(saved).toEqual({
      currentModel: 'openai/gpt-5-mini',
      effectiveModel: 'openai/gpt-5-mini',
      systemPrompt: 'Custom judge prompt.',
      usingDefaultSystemPrompt: false,
    });
    expect(readSavedConversationAutomationJudgePreferences(file)).toEqual(saved);
  });
});

describe('conversationAutomationJudge transcript', () => {
  it('keeps only user and assistant text, excluding tools and thinking', () => {
    expect(buildConversationAutomationJudgeTranscript([
      {
        role: 'user',
        content: [{ type: 'text', text: 'Finish the implementation.' }],
      },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need to inspect files first.' },
          { type: 'toolCall', name: 'read', arguments: { path: 'file.ts' } },
          { type: 'text', text: 'I updated the implementation and the tests now pass.' },
        ],
      },
      {
        role: 'toolResult',
        content: [{ type: 'text', text: 'ignored' }],
      },
    ])).toBe([
      'User: Finish the implementation.',
      'Assistant: I updated the implementation and the tests now pass.',
    ].join('\n'));
  });
});

describe('runConversationAutomationJudge', () => {
  it('uses the configured judge model and parses strict JSON', async () => {
    completeSimpleMock.mockResolvedValue({
      content: [{ type: 'text', text: '{"pass":true,"reason":"Implementation looks complete.","confidence":0.88}' }],
    });

    const model = {
      id: 'gpt-5-mini',
      provider: 'openai',
      api: 'openai-responses',
    } as unknown as JudgeModel;
    const modelRegistry = {
      getAvailable: () => [model],
      getApiKey: vi.fn().mockResolvedValue('test-key'),
    };

    const result = await runConversationAutomationJudge({
      prompt: 'Decide whether the conversation is ready for review.',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'Finish the implementation.' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'I updated the implementation and the tests now pass.' }] },
      ],
      modelRegistry,
      settings: {
        provider: 'openai',
        model: 'gpt-5-mini',
        systemPrompt: 'Judge carefully.',
      },
      now: 123,
    });

    expect(result).toEqual({
      pass: true,
      reason: 'Implementation looks complete.',
      confidence: 0.88,
    });
    expect(modelRegistry.getApiKey).toHaveBeenCalledWith(model);
    expect(completeSimpleMock).toHaveBeenCalledWith(
      model,
      expect.objectContaining({
        systemPrompt: 'Judge carefully.',
        messages: [
          expect.objectContaining({
            role: 'user',
            timestamp: 123,
            content: [
              expect.objectContaining({
                type: 'text',
                text: expect.stringContaining('Conversation:\nUser: Finish the implementation.\nAssistant: I updated the implementation and the tests now pass.'),
              }),
            ],
          }),
        ],
      }),
      expect.objectContaining({
        apiKey: 'test-key',
        reasoning: 'minimal',
        temperature: 0,
        maxTokens: 220,
      }),
    );
  });
});
