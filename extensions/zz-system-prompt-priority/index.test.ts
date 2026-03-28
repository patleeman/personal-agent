import { describe, expect, it } from 'vitest';
import systemPromptPriorityExtension, { prioritizePromptSection } from './index';
import { requirePromptCatalogEntryFromExtension } from '../_shared/prompt-catalog.js';

const RESPONSE_STYLE = requirePromptCatalogEntryFromExtension(import.meta.url, 'system/30-output-style.md');

describe('zz-system-prompt-priority extension', () => {
  it('moves the response-style block to the top and removes duplicates', () => {
    const basePrompt = [
      'You are an expert coding assistant.',
      'Guidelines:',
      '- Use tools well.',
      RESPONSE_STYLE,
      'Current date: 2026-03-28',
      RESPONSE_STYLE,
    ].join('\n\n');

    const result = prioritizePromptSection(basePrompt, RESPONSE_STYLE);

    expect(result.startsWith(RESPONSE_STYLE)).toBe(true);
    expect(result.match(/# response style/g)).toHaveLength(1);
    expect(result).toContain('You are an expert coding assistant.');
    expect(result).toContain('Current date: 2026-03-28');
  });

  it('prepends the response-style block when the prompt does not already contain it', () => {
    const result = prioritizePromptSection('BASE_SYSTEM_PROMPT', RESPONSE_STYLE);

    expect(result.startsWith(RESPONSE_STYLE)).toBe(true);
    expect(result).toContain('BASE_SYSTEM_PROMPT');
  });

  it('registers a before_agent_start handler that skips slash commands', () => {
    let beforeAgentStartHandler:
      | ((event: { prompt: string; systemPrompt: string }) => { systemPrompt: string } | undefined)
      | undefined;

    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt: string; systemPrompt: string }) => { systemPrompt: string } | undefined;
        }
      },
    };

    systemPromptPriorityExtension(pi as never);
    expect(beforeAgentStartHandler).toBeDefined();

    const slashResult = beforeAgentStartHandler!({
      prompt: '/model',
      systemPrompt: `BASE\n\n${RESPONSE_STYLE}`,
    });

    const normalResult = beforeAgentStartHandler!({
      prompt: 'tighten the prompt',
      systemPrompt: `BASE\n\n${RESPONSE_STYLE}`,
    });

    expect(slashResult).toBeUndefined();
    expect(normalResult?.systemPrompt.startsWith(RESPONSE_STYLE)).toBe(true);
    expect(normalResult?.systemPrompt.match(/# response style/g)).toHaveLength(1);
  });
});
