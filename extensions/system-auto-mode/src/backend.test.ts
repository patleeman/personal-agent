import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { createConversationAutoModeAgentExtension } from './backend.js';

describe('system-goal-mode extension', () => {
  it('creates the extension factory', () => {
    const factory = createConversationAutoModeAgentExtension();
    expect(factory).toBeInstanceOf(Function);
  });

  it('queues active goal continuation with a generated continuation id', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
      sendMessage,
      appendEntry: vi.fn(),
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

    const turnEnd = handlers.get('turn_end')?.[0];
    expect(turnEnd).toBeInstanceOf(Function);

    await turnEnd?.(
      { toolResults: [{ type: 'tool_result' }] },
      {
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-goal',
              data: {
                objective: 'ship goal mode',
                status: 'active',
                tasks: [],
                stopReason: null,
                updatedAt: '2026-05-09T00:00:00.000Z',
              },
            },
          ],
        },
        hasPendingMessages: () => false,
        signal: { aborted: false },
      },
    );

    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'goal-continuation',
        display: false,
        details: expect.objectContaining({ source: 'goal-mode', continuationId: expect.any(String) }),
      }),
      { deliverAs: 'followUp', triggerTurn: true },
    );
  });

  it('suppresses continuation after two consecutive no-progress active goal turns', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
      sendMessage,
      appendEntry: vi.fn(),
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

    const turnEnd = handlers.get('turn_end')?.[0];
    const ctx = {
      sessionManager: {
        getEntries: () => [
          {
            type: 'custom',
            customType: 'conversation-goal',
            data: {
              objective: 'ship goal mode',
              status: 'active',
              tasks: [],
              stopReason: null,
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          },
        ],
      },
      hasPendingMessages: () => false,
      signal: { aborted: false },
    };

    await turnEnd?.({ toolResults: [] }, ctx);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await turnEnd?.({ toolResults: [] }, ctx);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('treats tool turns as progress', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
      sendMessage,
      appendEntry: vi.fn(),
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

    const turnEnd = handlers.get('turn_end')?.[0];
    const ctx = {
      sessionManager: {
        getEntries: () => [
          {
            type: 'custom',
            customType: 'conversation-goal',
            data: {
              objective: 'ship goal mode',
              status: 'active',
              tasks: [],
              stopReason: null,
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          },
        ],
      },
      hasPendingMessages: () => false,
      signal: { aborted: false },
    };

    await turnEnd?.({ toolResults: [] }, ctx);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await turnEnd?.({ toolResults: [{ role: 'toolResult', toolName: 'bash' }] }, ctx);
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('registers only goal set and update tools', () => {
    const registeredTools: Array<{ name: string }> = [];
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn((tool: { name: string }) => registeredTools.push(tool)),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
      setActiveTools: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    factory(pi);

    expect(registeredTools.map((tool) => tool.name)).toEqual(['set_goal', 'update_goal']);
  });
});
