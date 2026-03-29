import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import type { Model } from '@mariozechner/pi-ai';
import {
  applyConversationModelPreferencesToSessionManager,
  readConversationModelPreferenceSnapshot,
  resolveConversationModelPreferenceState,
} from './conversationModelPreferences.js';

function createTestModel(input: {
  id: string;
  provider?: string;
  reasoning?: boolean;
}): Model<'openai-responses'> {
  return {
    id: input.id,
    name: input.id,
    api: 'openai-responses',
    provider: input.provider ?? 'openai',
    baseUrl: 'https://example.com',
    reasoning: input.reasoning ?? true,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: 128_000,
    maxTokens: 8_000,
  };
}

function createSessionManager(): SessionManager {
  const sessionDir = mkdtempSync(join(tmpdir(), 'conversation-model-preferences-'));
  return SessionManager.create('/tmp/personal-agent', sessionDir);
}

describe('conversationModelPreferences', () => {
  it('falls back to saved defaults when the session has no explicit runtime entries', () => {
    const sessionManager = createSessionManager();
    const snapshot = readConversationModelPreferenceSnapshot(sessionManager);

    const state = resolveConversationModelPreferenceState(snapshot, {
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
    }, []);

    expect(state).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
    });
  });

  it('updates only the model when the inherited thinking level stays compatible', () => {
    const sessionManager = createSessionManager();
    const models = [
      createTestModel({ id: 'claude-sonnet-4-6', provider: 'anthropic' }),
      createTestModel({ id: 'gpt-5.4', provider: 'openai-codex' }),
    ];

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { model: 'gpt-5.4' },
      {
        currentModel: 'claude-sonnet-4-6',
        currentThinkingLevel: 'high',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change']);
  });

  it('clamps the inherited thinking level when switching to a non-reasoning model', () => {
    const sessionManager = createSessionManager();
    const models = [
      createTestModel({ id: 'gpt-5.4', provider: 'openai-codex', reasoning: true }),
      createTestModel({ id: 'gpt-4o', provider: 'openai', reasoning: false }),
    ];

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { model: 'gpt-4o' },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'xhigh',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'gpt-4o',
      currentThinkingLevel: 'off',
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change', 'thinking_level_change']);
  });

  it('accepts provider/model refs when switching models', () => {
    const sessionManager = createSessionManager();
    const models = [
      createTestModel({ id: 'qwen-reap', provider: 'desktop', reasoning: true }),
      createTestModel({ id: 'gpt-5.4', provider: 'openai-codex', reasoning: true }),
    ];

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { model: 'desktop/qwen-reap', thinkingLevel: 'medium' },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'high',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'qwen-reap',
      currentThinkingLevel: 'medium',
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change', 'thinking_level_change']);
  });
});
