import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import type { Model } from '@mariozechner/pi-ai';
import {
  applyConversationModelPreferencesToSessionManager,
  modelSupportsServiceTiers,
  readConversationModelPreferenceSnapshot,
  resolveConversationModelPreferenceState,
} from './conversationModelPreferences.js';

function createTestModel(input: {
  id: string;
  api?: 'openai-responses' | 'openai-codex-responses' | 'openai-completions';
  provider?: string;
  reasoning?: boolean;
}): Model<any> {
  return {
    id: input.id,
    name: input.id,
    api: input.api ?? 'openai-responses',
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
      currentServiceTier: 'priority',
    }, []);

    expect(state).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
    });
  });

  it('reports whether a model supports service tiers', () => {
    expect(modelSupportsServiceTiers(createTestModel({ id: 'gpt-5.4', api: 'openai-responses' }))).toBe(true);
    expect(modelSupportsServiceTiers(createTestModel({ id: 'gpt-5.4', api: 'openai-codex-responses' }))).toBe(true);
    expect(modelSupportsServiceTiers(createTestModel({ id: 'gpt-4o', api: 'openai-completions' }))).toBe(false);
  });

  it('reads the latest explicit service tier override from custom session entries', () => {
    const sessionManager = createSessionManager();
    sessionManager.appendCustomEntry('conversation-service-tier', { serviceTier: 'priority' });
    sessionManager.appendCustomEntry('conversation-service-tier', { serviceTier: null });
    sessionManager.appendCustomEntry('conversation-service-tier', { serviceTier: 'flex' });

    expect(readConversationModelPreferenceSnapshot(sessionManager)).toEqual({
      currentModel: '',
      currentThinkingLevel: 'off',
      currentServiceTier: 'flex',
      hasExplicitModel: false,
      hasExplicitThinkingLevel: false,
      hasExplicitServiceTier: true,
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
        currentServiceTier: 'priority',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change']);
  });

  it('clamps the inherited thinking level when switching to a non-reasoning model', () => {
    const sessionManager = createSessionManager();
    const models = [
      createTestModel({ id: 'gpt-5.4', provider: 'openai-codex', reasoning: true }),
      createTestModel({ id: 'gpt-4o', provider: 'openai', api: 'openai-completions', reasoning: false }),
    ];

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { model: 'gpt-4o' },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'xhigh',
        currentServiceTier: 'priority',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'gpt-4o',
      currentThinkingLevel: 'off',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change', 'thinking_level_change']);
  });

  it('accepts provider/model refs when switching models and setting an explicit service tier', () => {
    const sessionManager = createSessionManager();
    const models = [
      createTestModel({ id: 'qwen-reap', provider: 'desktop', reasoning: true }),
      createTestModel({ id: 'gpt-5.4', provider: 'openai-codex', reasoning: true }),
    ];

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { model: 'desktop/qwen-reap', thinkingLevel: 'medium', serviceTier: 'priority' },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'high',
        currentServiceTier: '',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'qwen-reap',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change', 'thinking_level_change']);
  });

  it('accepts raw model ids that already contain slashes', () => {
    const sessionManager = createSessionManager();
    const models = [
      createTestModel({ id: 'openrouter/free', provider: 'openrouter', reasoning: true }),
      createTestModel({ id: 'gpt-5.4', provider: 'openai-codex', reasoning: true }),
    ];

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { model: 'openrouter/free', thinkingLevel: 'medium' },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'high',
        currentServiceTier: 'priority',
      },
      models,
    );

    expect(state).toEqual({
      currentModel: 'openrouter/free',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    expect(sessionManager.getBranch().map((entry) => entry.type)).toEqual(['model_change', 'thinking_level_change']);
  });

  it('can explicitly disable fast mode even when the saved default is on', () => {
    const sessionManager = createSessionManager();

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { serviceTier: null },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'high',
        currentServiceTier: 'priority',
      },
      [createTestModel({ id: 'gpt-5.4', provider: 'openai-codex' })],
    );

    expect(state).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      hasExplicitServiceTier: true,
    });
    expect(readConversationModelPreferenceSnapshot(sessionManager)).toEqual({
      currentModel: '',
      currentThinkingLevel: 'off',
      currentServiceTier: '',
      hasExplicitModel: false,
      hasExplicitThinkingLevel: false,
      hasExplicitServiceTier: true,
    });
  });

  it('can clear an explicit service tier override back to the saved default', () => {
    const sessionManager = createSessionManager();
    sessionManager.appendCustomEntry('conversation-service-tier', { serviceTier: null });

    const state = applyConversationModelPreferencesToSessionManager(
      sessionManager,
      { serviceTier: '' },
      {
        currentModel: 'gpt-5.4',
        currentThinkingLevel: 'high',
        currentServiceTier: 'priority',
      },
      [createTestModel({ id: 'gpt-5.4', provider: 'openai-codex' })],
    );

    expect(state).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
    });
    expect(readConversationModelPreferenceSnapshot(sessionManager)).toEqual({
      currentModel: '',
      currentThinkingLevel: 'off',
      currentServiceTier: '',
      hasExplicitModel: false,
      hasExplicitThinkingLevel: false,
      hasExplicitServiceTier: false,
    });
  });
});
