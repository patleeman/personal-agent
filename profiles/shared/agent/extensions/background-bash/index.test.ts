import { describe, expect, it, vi } from 'vitest';

vi.mock('@mariozechner/pi-coding-agent', () => ({
  createBashTool: vi.fn(() => ({
    name: 'bash',
    label: 'bash',
    description: 'mock bash tool',
    parameters: {},
    execute: vi.fn(),
  })),
}));

import backgroundBashExtension from './index';

describe('background-bash extension', () => {
  it('injects backgrounding guidance into the system prompt', () => {
    const handlers: Record<string, (...args: any[]) => unknown> = {};

    const pi = {
      on: (eventName: string, handler: (...args: any[]) => unknown) => {
        handlers[eventName] = handler;
      },
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };

    backgroundBashExtension(pi as never);

    const beforeAgentStartHandler = handlers.before_agent_start;
    expect(beforeAgentStartHandler).toBeDefined();

    const result = beforeAgentStartHandler?.({
      prompt: 'run the test suite',
      systemPrompt: 'BASE_SYSTEM_PROMPT',
    }) as { systemPrompt?: string } | undefined;

    expect(result?.systemPrompt).toContain('BASE_SYSTEM_PROMPT');
    expect(result?.systemPrompt).toContain('BACKGROUND_BASH_GUIDANCE');
    expect(result?.systemPrompt).toContain('Use background=true for potentially long or unbounded commands');
    expect(result?.systemPrompt).toContain('set a tight timeout');
  });

  it('skips prompt injection for slash commands and empty prompts', () => {
    const handlers: Record<string, (...args: any[]) => unknown> = {};

    const pi = {
      on: (eventName: string, handler: (...args: any[]) => unknown) => {
        handlers[eventName] = handler;
      },
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };

    backgroundBashExtension(pi as never);

    const beforeAgentStartHandler = handlers.before_agent_start;
    expect(beforeAgentStartHandler).toBeDefined();

    const slashResult = beforeAgentStartHandler?.({
      prompt: '/bg list',
      systemPrompt: 'BASE_SYSTEM_PROMPT',
    });

    const emptyResult = beforeAgentStartHandler?.({
      prompt: '   ',
      systemPrompt: 'BASE_SYSTEM_PROMPT',
    });

    expect(slashResult).toBeUndefined();
    expect(emptyResult).toBeUndefined();
  });
});
