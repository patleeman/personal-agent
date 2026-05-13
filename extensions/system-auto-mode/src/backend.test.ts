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

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'goal-continuation',
        content: expect.stringContaining('call update_goal with status: "complete"'),
        display: false,
        details: expect.objectContaining({ source: 'goal-mode', continuationId: expect.any(String) }),
      }),
      { deliverAs: 'followUp', triggerTurn: true },
    );
  });

  it('does not send a queued continuation after the goal is completed before the timer fires', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      sendMessage,
      appendEntry: vi.fn(),
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

    let goalStatus: 'active' | 'complete' = 'active';
    const turnEnd = handlers.get('turn_end')?.[0];
    await turnEnd?.(
      { toolResults: [{ type: 'tool_result' }] },
      {
        sessionManager: {
          getEntries: () => [
            {
              type: 'custom',
              customType: 'conversation-goal',
              data: {
                objective: goalStatus === 'active' ? 'ship goal mode' : '',
                status: goalStatus,
                tasks: [],
                stopReason: goalStatus === 'active' ? null : 'goal achieved',
                updatedAt: goalStatus === 'active' ? '2026-05-09T00:00:00.000Z' : '2026-05-09T00:00:01.000Z',
              },
            },
          ],
        },
        hasPendingMessages: () => false,
        signal: { aborted: false },
      },
    );

    goalStatus = 'complete';
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not queue duplicate continuations while one is already pending', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      sendMessage,
      appendEntry: vi.fn(),
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

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
    const turnEnd = handlers.get('turn_end')?.[0];
    await turnEnd?.({ toolResults: [{ type: 'tool_result' }] }, ctx);
    await turnEnd?.({ toolResults: [{ type: 'tool_result' }] }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('pauses the active goal after two consecutive no-progress active goal turns', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const appendEntry = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      sendMessage,
      appendEntry,
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

    const entries: unknown[] = [
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
    ];
    appendEntry.mockImplementation((customType: string, data: unknown) => entries.push({ type: 'custom', customType, data }));
    const turnEnd = handlers.get('turn_end')?.[0];
    const ctx = {
      sessionManager: {
        getEntries: () => entries,
      },
      hasPendingMessages: () => false,
      signal: { aborted: false },
    };

    await turnEnd?.({ toolResults: [] }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(appendEntry).toHaveBeenCalledWith('conversation-goal', expect.objectContaining({ noProgressTurns: 1 }));

    await turnEnd?.({ toolResults: [] }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(appendEntry).toHaveBeenCalledWith('conversation-goal', expect.objectContaining({ status: 'paused', stopReason: 'no progress' }));
  });

  it('treats tool turns as progress', async () => {
    const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
    const sendMessage = vi.fn();
    const appendEntry = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      sendMessage,
      appendEntry,
      on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      }),
    } as unknown as ExtensionAPI;

    factory(pi);

    const entries: unknown[] = [
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
    ];
    appendEntry.mockImplementation((customType: string, data: unknown) => entries.push({ type: 'custom', customType, data }));
    const turnEnd = handlers.get('turn_end')?.[0];
    const ctx = {
      sessionManager: {
        getEntries: () => entries,
      },
      hasPendingMessages: () => false,
      signal: { aborted: false },
    };

    await turnEnd?.({ toolResults: [] }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await turnEnd?.({ toolResults: [{ role: 'toolResult', toolName: 'bash' }] }, ctx);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('clears stored goal state when marking the goal complete', async () => {
    const registeredTools: Array<{ name: string; execute: (...args: any[]) => Promise<{ details?: unknown }> }> = [];
    const appendEntry = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn((tool: { name: string; execute: (...args: any[]) => Promise<{ details?: unknown }> }) =>
        registeredTools.push(tool),
      ),
      registerCommand: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry,
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    factory(pi);

    const updateGoal = registeredTools.find((tool) => tool.name === 'update_goal');
    const result = await updateGoal?.execute('goal-2', { status: 'complete' }, new AbortController().signal, vi.fn(), {
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
    });

    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'goal achieved' }),
    );
    expect(result?.details).toEqual({
      state: expect.objectContaining({ objective: '', status: 'complete', stopReason: 'goal achieved' }),
    });
  });

  it('treats completion of an inactive goal as an idempotent no-op', async () => {
    const registeredTools: Array<{
      name: string;
      execute: (...args: any[]) => Promise<{ content?: Array<{ text?: string }>; details?: unknown }>;
    }> = [];
    const appendEntry = vi.fn();
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn(
        (tool: { name: string; execute: (...args: any[]) => Promise<{ content?: Array<{ text?: string }>; details?: unknown }> }) =>
          registeredTools.push(tool),
      ),
      registerCommand: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry,
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    factory(pi);

    const updateGoal = registeredTools.find((tool) => tool.name === 'update_goal');
    const result = await updateGoal?.execute('goal-2', { status: 'complete' }, new AbortController().signal, vi.fn(), {
      sessionManager: {
        getEntries: () => [
          {
            type: 'custom',
            customType: 'conversation-goal',
            data: {
              objective: '',
              status: 'complete',
              tasks: [],
              stopReason: 'goal achieved',
              updatedAt: '2026-05-09T00:00:00.000Z',
            },
          },
        ],
      },
    });

    expect(appendEntry).not.toHaveBeenCalled();
    expect(result?.content?.[0]?.text).toBe('Goal already complete.');
  });

  it('registers only goal set and update tools', () => {
    const registeredTools: Array<{ name: string }> = [];
    const factory = createConversationAutoModeAgentExtension();
    const pi = {
      registerTool: vi.fn((tool: { name: string }) => registeredTools.push(tool)),
      registerCommand: vi.fn(),
      sendMessage: vi.fn(),
      appendEntry: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;

    factory(pi);

    expect(registeredTools.map((tool) => tool.name)).toEqual(['set_goal', 'update_goal']);
  });
});
