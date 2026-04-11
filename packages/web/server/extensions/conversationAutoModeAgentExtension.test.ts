import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationAutoModeAgentExtension } from './conversationAutoModeAgentExtension.js';

const {
  promptSessionMock,
  requestConversationAutoModeTurnMock,
  setLiveSessionAutoModeStateMock,
} = vi.hoisted(() => ({
  promptSessionMock: vi.fn(),
  requestConversationAutoModeTurnMock: vi.fn(),
  setLiveSessionAutoModeStateMock: vi.fn(),
}));

vi.mock('../conversations/liveSessions.js', () => ({
  promptSession: promptSessionMock,
  requestConversationAutoModeTurn: requestConversationAutoModeTurnMock,
  setLiveSessionAutoModeState: setLiveSessionAutoModeStateMock,
}));

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type TurnEndHandler = Parameters<ExtensionAPI['on']>[1];

function createHarness() {
  const tools: RegisteredTool[] = [];
  const handlers = new Map<string, TurnEndHandler[]>();

  createConversationAutoModeAgentExtension()({
    registerTool: (tool: RegisteredTool) => {
      tools.push(tool);
    },
    on: (event: string, handler: TurnEndHandler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
  } as never);

  const tool = tools[0];
  if (!tool) {
    throw new Error('conversation auto mode tool was not registered');
  }

  return {
    tool,
    handlers,
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
  promptSessionMock.mockReset();
  requestConversationAutoModeTurnMock.mockReset();
  setLiveSessionAutoModeStateMock.mockReset();
});

describe('conversation auto mode agent extension', () => {
  it('registers the auto control tool with stop guidance', () => {
    const { tool } = createHarness();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(tool.name).toBe('conversation_auto_control');
    expect(guidelines).toContain('hidden auto-review turns');
    expect(guidelines).toContain('short reason');
  });

  it('queues a visible follow-up turn when the controller continues', async () => {
    const { tool } = createHarness();

    await tool.execute?.(
      'tool-1',
      { action: 'continue' },
      undefined,
      undefined,
      {
        sessionManager: createSessionManager({ enabled: true }),
      } as never,
    );

    expect(promptSessionMock).toHaveBeenCalledWith('conversation-1', 'Continue from where you left off.', 'followUp');
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
        sessionManager: createSessionManager({ enabled: true }),
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
});
