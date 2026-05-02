import { afterEach, describe, expect, it, vi } from 'vitest';

const {
  getPromptCatalogRootMock,
  renderPromptCatalogTemplateMock,
  requirePromptCatalogEntryMock,
} = vi.hoisted(() => ({
  getPromptCatalogRootMock: vi.fn(),
  renderPromptCatalogTemplateMock: vi.fn(),
  requirePromptCatalogEntryMock: vi.fn(),
}));

vi.mock('@personal-agent/core', () => ({
  getPromptCatalogRoot: getPromptCatalogRootMock,
  renderPromptCatalogTemplate: renderPromptCatalogTemplateMock,
  requirePromptCatalogEntry: requirePromptCatalogEntryMock,
}));

import daemonRunOrchestrationPromptExtension from './index';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  getPromptCatalogRootMock.mockReset();
  renderPromptCatalogTemplateMock.mockReset();
  requirePromptCatalogEntryMock.mockReset();
});

describe('daemon run orchestration prompt extension', () => {
  it('renders the system prompt template for normal prompts with the current date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-10T12:34:56.000Z'));

    getPromptCatalogRootMock.mockReturnValue('/repo/prompt-catalog');
    requirePromptCatalogEntryMock.mockReturnValue('template {{ current_date }}');
    renderPromptCatalogTemplateMock.mockImplementation((template, variables) => `rendered ${(variables as { current_date: string }).current_date}`);

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

    expect(requirePromptCatalogEntryMock).toHaveBeenCalledWith('system.md');
    expect(renderPromptCatalogTemplateMock).toHaveBeenCalledWith(
      'template {{ current_date }}',
      { current_date: '2026-04-10' },
      { templateRoot: '/repo/prompt-catalog' },
    );
    expect(result).toEqual({ systemPrompt: 'rendered 2026-04-10' });
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
    expect(requirePromptCatalogEntryMock).not.toHaveBeenCalled();
    expect(renderPromptCatalogTemplateMock).not.toHaveBeenCalled();
  });
});
