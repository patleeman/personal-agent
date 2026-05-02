import { afterEach, describe, expect, it, vi } from 'vitest';

const { renderSystemPromptTemplateMock } = vi.hoisted(() => ({
  renderSystemPromptTemplateMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  renderSystemPromptTemplate: renderSystemPromptTemplateMock,
}));

import daemonRunOrchestrationPromptExtension from './index';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  renderSystemPromptTemplateMock.mockReset();
});

describe('daemon run orchestration prompt extension', () => {
  it('renders the system prompt template for normal prompts with the current date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:34:56.000Z'));

    renderSystemPromptTemplateMock.mockReturnValue('rendered system prompt');

    let beforeAgentStartHandler: ((event: { prompt?: string | null }) => unknown) | undefined;
    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt?: string | null }) => unknown;
        }
      },
    };

    daemonRunOrchestrationPromptExtension(pi as never);

    const result = beforeAgentStartHandler?.({ prompt: ' investigate the failing run ' });

    expect(renderSystemPromptTemplateMock).toHaveBeenCalledWith({
      current_date: '2026-04-10',
    });
    expect(result).toEqual({ systemPrompt: 'rendered system prompt' });
  });

  it('skips injection for empty, missing, and slash-command prompts', () => {
    let beforeAgentStartHandler: ((event: { prompt?: string | null }) => unknown) | undefined;
    const pi = {
      on: (eventName: string, handler: unknown) => {
        if (eventName === 'before_agent_start') {
          beforeAgentStartHandler = handler as (event: { prompt?: string | null }) => unknown;
        }
      },
    };

    daemonRunOrchestrationPromptExtension(pi as never);

    expect(beforeAgentStartHandler?.({ prompt: '   ' })).toBeUndefined();
    expect(beforeAgentStartHandler?.({ prompt: '/model gpt-5' })).toBeUndefined();
    expect(beforeAgentStartHandler?.({})).toBeUndefined();
    expect(renderSystemPromptTemplateMock).not.toHaveBeenCalled();
  });
});
