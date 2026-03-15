import { describe, expect, it, vi } from 'vitest';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import promptRemindersExtension from './index';

function setupBeforeAgentStartHandler(): (event: { prompt?: string; systemPrompt?: string }) => { message?: { customType: string; content: string; display: boolean } } | undefined {
  const handlers = new Map<string, (event: { prompt?: string; systemPrompt?: string }) => { message?: { customType: string; content: string; display: boolean } } | undefined>();

  const api = {
    on: vi.fn((event: string, handler: (event: { prompt?: string; systemPrompt?: string }) => { message?: { customType: string; content: string; display: boolean } } | undefined) => {
      handlers.set(event, handler);
    }),
  };

  promptRemindersExtension(api as unknown as ExtensionAPI);

  const handler = handlers.get('before_agent_start');
  if (!handler) {
    throw new Error('before_agent_start handler was not registered');
  }

  return handler;
}

describe('prompt reminders extension', () => {
  it('injects a hidden code reference reminder for review-style prompts', () => {
    const handler = setupBeforeAgentStartHandler();
    const result = handler({ prompt: 'audit the prompt composition and compare the implementations', systemPrompt: 'BASE' });

    expect(result?.message?.customType).toBe('code-references-reminder');
    expect(result?.message?.display).toBe(false);
    expect(result?.message?.content).toContain('prefer `path:line` references');
  });

  it('does not inject reminders for unrelated prompts', () => {
    const handler = setupBeforeAgentStartHandler();
    const result = handler({ prompt: 'say hello', systemPrompt: 'BASE' });
    expect(result).toBeUndefined();
  });
});
