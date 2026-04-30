import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationAutoModeAgentExtension } from './conversationAutoModeAgentExtension.js';

const {
  markConversationAutoModeContinueRequestedMock,
  registerLiveSessionLifecycleHandlerMock,
  requestConversationAutoModeTurnMock,
  setLiveSessionAutoModeStateMock,
} = vi.hoisted(() => ({
  markConversationAutoModeContinueRequestedMock: vi.fn(),
  registerLiveSessionLifecycleHandlerMock: vi.fn(),
  requestConversationAutoModeTurnMock: vi.fn(),
  setLiveSessionAutoModeStateMock: vi.fn(),
}));

vi.mock('../conversations/liveSessions.js', () => ({
  markConversationAutoModeContinueRequested: markConversationAutoModeContinueRequestedMock,
  registerLiveSessionLifecycleHandler: registerLiveSessionLifecycleHandlerMock,
  requestConversationAutoModeTurn: requestConversationAutoModeTurnMock,
  setLiveSessionAutoModeState: setLiveSessionAutoModeStateMock,
}));

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type TurnEndHandler = Parameters<ExtensionAPI['on']>[1];

function createHarness() {
  const tools: RegisteredTool[] = [];
  const handlers = new Map<string, TurnEndHandler[]>();
  const pi = {
    registerTool: (tool: RegisteredTool) => {
      tools.push(tool);
    },
    on: (event: string, handler: TurnEndHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    getActiveTools: vi.fn(() => ['read', 'conversation_auto_control', 'bash']),
    setActiveTools: vi.fn(),
  };

  createConversationAutoModeAgentExtension()(pi as never);

  const tool = tools[0];
  if (!tool) {
    throw new Error('conversation auto mode tool was not registered');
  }

  return {
    tool,
    handlers,
    pi,
    lifecycleHandlers: registerLiveSessionLifecycleHandlerMock.mock.calls.map(([handler]) => handler),
  };
}

function createSessionManager(options: {
  enabled?: boolean;
  branch?: unknown[];
}) {
  return {
    getSessionId: () => 'conversation-1',
    getEntries: () => [{
      type: 'custom',
      customType: 'conversation-auto-mode',
      data: {
        enabled: options.enabled ?? false,
      },
    }],
    getBranch: () => options.branch ?? [],
  };
}

beforeEach(() => {
  vi.useRealTimers();
  markConversationAutoModeContinueRequestedMock.mockReset();
  registerLiveSessionLifecycleHandlerMock.mockReset();
  requestConversationAutoModeTurnMock.mockReset();
  setLiveSessionAutoModeStateMock.mockReset();
});

describe('conversation auto mode agent extension', () => {
  it('registers the auto control tool with continue-first guidance', () => {
    const { tool } = createHarness();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(tool.name).toBe('conversation_auto_control');
    expect(guidelines).toContain('hidden auto-review turns');
    expect(guidelines).toContain('uninterrupted progress');
    expect(guidelines).toContain('explicit validation target');
  });

  it('marks the current review turn to continue when the controller continues', async () => {
    const { tool } = createHarness();

    await tool.execute?.(
      'tool-1',
      { action: 'continue' },
      undefined,
      undefined,
      {
        sessionManager: createSessionManager({
          enabled: true,
          branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
        }),
      } as never,
    );

    expect(markConversationAutoModeContinueRequestedMock).toHaveBeenCalledWith('conversation-1');
  });

  it('stops auto mode through the live session helper', async () => {
    setLiveSessionAutoModeStateMock.mockResolvedValueOnce({
      enabled: false,
      stopReason: 'needs user input',
      updatedAt: '2026-04-12T15:00:00.000Z',
    });

    const { tool } = createHarness();
    const result = await tool.execute?.(
      'tool-1',
      { action: 'stop', reason: 'needs user input' },
      undefined,
      undefined,
      {
        sessionManager: createSessionManager({
          enabled: true,
          branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
        }),
      } as never,
    );

    expect(setLiveSessionAutoModeStateMock).toHaveBeenCalledWith('conversation-1', {
      enabled: false,
      stopReason: 'needs user input',
    });
    expect(result?.content[0]).toEqual({
      type: 'text',
      text: 'Stopped auto mode: needs user input.',
    });
  });

  it('schedules a hidden review turn after visible turns while auto mode is enabled', async () => {
    const { handlers } = createHarness();
    const turnEndHandlers = handlers.get('turn_end') ?? [];

    await turnEndHandlers[0]?.({} as never, {
      sessionManager: createSessionManager({
        enabled: true,
        branch: [{ type: 'message', message: { role: 'user' } }],
      }),
    } as never);
    await Promise.resolve();

    expect(requestConversationAutoModeTurnMock).toHaveBeenCalledWith('conversation-1');
  });

  it('keeps the auto control tool inactive outside hidden auto-review turns', async () => {
    const { handlers, pi } = createHarness();
    const beforeAgentStartHandlers = handlers.get('before_agent_start') ?? [];

    await beforeAgentStartHandlers[0]?.({} as never, {
      sessionManager: createSessionManager({
        enabled: true,
        branch: [{ type: 'message', message: { role: 'user' } }],
      }),
    } as never);

    expect(pi.setActiveTools).toHaveBeenCalledWith(['read', 'bash']);
  });

  it('activates the auto control tool for hidden auto-review turns', async () => {
    const { handlers, pi } = createHarness();
    pi.getActiveTools.mockReturnValue(['read', 'bash']);
    const beforeAgentStartHandlers = handlers.get('before_agent_start') ?? [];

    await beforeAgentStartHandlers[0]?.({} as never, {
      sessionManager: createSessionManager({
        enabled: true,
        branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
      }),
    } as never);

    expect(pi.setActiveTools).toHaveBeenCalledWith(['read', 'bash', 'conversation_auto_control']);
  });

  it('rejects stale auto control tool calls outside hidden auto-review turns', async () => {
    const { tool } = createHarness();

    await expect(tool.execute?.(
      'tool-1',
      { action: 'continue' },
      undefined,
      undefined,
      {
        sessionManager: createSessionManager({
          enabled: true,
          branch: [{ type: 'message', message: { role: 'user' } }],
        }),
      } as never,
    )).rejects.toThrow('hidden auto-review turns');
  });

  it('does not reschedule hidden review turns from inside the hidden controller turn', async () => {
    const { handlers } = createHarness();
    const turnEndHandlers = handlers.get('turn_end') ?? [];

    await turnEndHandlers[0]?.({} as never, {
      sessionManager: createSessionManager({
        enabled: true,
        branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
      }),
    } as never);
    await Promise.resolve();

    expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();
  });

  it('retries the hidden review after auto compaction if the session stays idle', async () => {
    vi.useFakeTimers();
    const { lifecycleHandlers } = createHarness();
    const lifecycleHandler = lifecycleHandlers[0];

    expect(lifecycleHandler).toBeTypeOf('function');

    lifecycleHandler?.({
      conversationId: 'conversation-1',
      trigger: 'auto_compaction_end',
      cwd: '/tmp/workspace',
      title: 'Auto mode thread',
    });

    expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1499);
    expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(requestConversationAutoModeTurnMock).toHaveBeenCalledWith('conversation-1');
  });

  it('cancels the compaction recovery retry once a later turn ends', async () => {
    vi.useFakeTimers();
    const { lifecycleHandlers } = createHarness();
    const lifecycleHandler = lifecycleHandlers[0];

    lifecycleHandler?.({
      conversationId: 'conversation-1',
      trigger: 'auto_compaction_end',
      cwd: '/tmp/workspace',
      title: 'Auto mode thread',
    });
    lifecycleHandler?.({
      conversationId: 'conversation-1',
      trigger: 'turn_end',
      cwd: '/tmp/workspace',
      title: 'Auto mode thread',
    });

    await vi.runAllTimersAsync();
    expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();
  });
});
