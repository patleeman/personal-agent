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

  const autoControlTool = tools.find((t) => t.name === 'conversation_auto_control');
  const runStateTool = tools.find((t) => t.name === 'run_state');

  return {
    autoControlTool,
    runStateTool,
    tools,
    handlers,
    pi,
    lifecycleHandlers: registerLiveSessionLifecycleHandlerMock.mock.calls.map(([handler]) => handler),
  };
}

function createSessionManager(options: { enabled?: boolean; mode?: string; branch?: unknown[] }) {
  const data: Record<string, unknown> = {
    enabled: options.enabled ?? false,
  };
  if (options.mode) {
    data.mode = options.mode;
  }
  return {
    getSessionId: () => 'conversation-1',
    getEntries: () => [
      {
        type: 'custom',
        customType: 'conversation-auto-mode',
        data,
      },
    ],
    getBranch: () => options.branch ?? [],
    appendCustomEntry: vi.fn(),
  };
}

function createMissionSessionManager(options: { tasks?: unknown[] } = {}) {
  return {
    getSessionId: () => 'conversation-1',
    getEntries: () => [
      {
        type: 'custom',
        customType: 'conversation-auto-mode',
        data: {
          enabled: true,
          mode: 'mission',
          mission: {
            goal: 'Fix the page',
            tasks: options.tasks ?? [
              { id: 't1', description: 'Task 1', status: 'done' },
              { id: 't2', description: 'Task 2', status: 'pending' },
            ],
            maxTurns: 20,
            turnsUsed: 1,
          },
          updatedAt: '2026-04-12T10:00:00.000Z',
        },
      },
    ],
    getBranch: () => [{ type: 'message', message: { role: 'assistant' } }],
    appendCustomEntry: vi.fn(),
  };
}

function createLoopSessionManager() {
  return {
    getSessionId: () => 'conversation-1',
    getEntries: () => [
      {
        type: 'custom',
        customType: 'conversation-auto-mode',
        data: {
          enabled: true,
          mode: 'loop',
          loop: {
            prompt: 'Find bugs',
            maxIterations: 5,
            iterationsUsed: 2,
            delay: 'After each turn',
          },
          updatedAt: '2026-04-12T10:00:00.000Z',
        },
      },
    ],
    getBranch: () => [{ type: 'message', message: { role: 'assistant' } }],
    appendCustomEntry: vi.fn(),
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
  describe('tool registration', () => {
    it('registers the auto control tool with continue-first guidance', () => {
      const { autoControlTool } = createHarness();
      expect(autoControlTool).toBeDefined();
      expect(autoControlTool!.name).toBe('conversation_auto_control');
      const guidelines = autoControlTool!.promptGuidelines?.join('\n') ?? '';
      // The guidance now refers to nudge mode specifically
      expect(guidelines).toContain('hidden auto-review turns');
      expect(guidelines).toContain('keep working without waiting for approval');
    });

    it('registers the run_state tool', () => {
      const { runStateTool } = createHarness();
      expect(runStateTool).toBeDefined();
      expect(runStateTool!.name).toBe('run_state');
    });

    it('run_state tool has get and update_tasks actions', () => {
      const { runStateTool } = createHarness();
      const params = runStateTool!.parameters as { properties?: Record<string, unknown> };
      const actionProp = (params.properties as Record<string, unknown>).action as { anyOf?: Array<{ const?: string }> };
      const actions = actionProp.anyOf?.map((a) => a.const) ?? [];
      expect(actions).toContain('get');
      expect(actions).toContain('update_tasks');
    });
  });

  describe('run_state tool - get', () => {
    it('returns mission state', async () => {
      const { runStateTool } = createHarness();
      const result = await runStateTool!.execute?.('tool-1', { action: 'get' }, undefined, undefined, {
        sessionManager: createMissionSessionManager(),
      } as never);

      expect(result!.content[0]!.text).toContain('Fix the page');
      expect(result!.content[0]!.text).toContain('Task 1');
      expect(result!.content[0]!.text).toContain('done');
    });

    it('returns loop state', async () => {
      const { runStateTool } = createHarness();
      const result = await runStateTool!.execute?.('tool-1', { action: 'get' }, undefined, undefined, {
        sessionManager: createLoopSessionManager(),
      } as never);

      expect(result!.content[0]!.text).toContain('Find bugs');
      expect(result!.content[0]!.text).toContain('Iterations: 2/5');
    });

    it('gracefully returns null state when mode is manual or nudge', async () => {
      const { runStateTool } = createHarness();
      const result = await runStateTool!.execute?.('tool-1', { action: 'get' }, undefined, undefined, {
        sessionManager: createSessionManager({ enabled: false }),
      } as never);

      expect(result!.content[0]!.text).toContain('No active mission or loop');
    });

    it('rejects update_tasks calls outside mission mode', async () => {
      const { runStateTool } = createHarness();
      await expect(
        runStateTool!.execute?.('tool-1', { action: 'update_tasks', tasks: [] }, undefined, undefined, {
          sessionManager: createSessionManager({ enabled: false }),
        } as never),
      ).rejects.toThrow('only available');
    });
  });

  describe('run_state tool - update_tasks', () => {
    it('updates task status in mission mode', async () => {
      const sm = createMissionSessionManager();
      const { runStateTool } = createHarness();

      const result = await runStateTool!.execute?.(
        'tool-1',
        { action: 'update_tasks', tasks: [{ id: 't2', status: 'done' }] },
        undefined,
        undefined,
        { sessionManager: sm } as never,
      );

      expect(result!.content[0]!.text).toContain('Updated');
      expect(sm.appendCustomEntry).toHaveBeenCalled();
    });
  });

  describe('auto control tool execution', () => {
    it('marks the current review turn to continue when the controller continues', async () => {
      const { autoControlTool } = createHarness();
      await autoControlTool!.execute?.('tool-1', { action: 'continue' }, undefined, undefined, {
        sessionManager: createSessionManager({
          enabled: true,
          mode: 'nudge',
          branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
        }),
      } as never);
      expect(markConversationAutoModeContinueRequestedMock).toHaveBeenCalledWith('conversation-1');
    });

    it('stops auto mode through the live session helper', async () => {
      setLiveSessionAutoModeStateMock.mockResolvedValueOnce({
        enabled: false,
        stopReason: 'needs user input',
        updatedAt: '2026-04-12T15:00:00.000Z',
      });

      const { autoControlTool } = createHarness();
      const result = await autoControlTool!.execute?.('tool-1', { action: 'stop', reason: 'needs user input' }, undefined, undefined, {
        sessionManager: createSessionManager({
          enabled: true,
          branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
        }),
      } as never);

      expect(setLiveSessionAutoModeStateMock).toHaveBeenCalledWith('conversation-1', {
        enabled: false,
        stopReason: 'needs user input',
      });
      expect(result!.content[0]).toEqual({ type: 'text', text: 'Stopped auto mode: needs user input.' });
    });

    it('rejects stale auto control tool calls outside hidden auto-review turns', async () => {
      const { autoControlTool } = createHarness();
      await expect(
        autoControlTool!.execute?.('tool-1', { action: 'continue' }, undefined, undefined, {
          sessionManager: createSessionManager({
            enabled: true,
            branch: [{ type: 'message', message: { role: 'user' } }],
          }),
        } as never),
      ).rejects.toThrow('hidden auto-review turns');
    });
  });

  describe('tool activation by mode', () => {
    it('activates run_state tool for mission mode', () => {
      const { pi, handlers } = createHarness();
      pi.getActiveTools.mockReturnValue(['read', 'bash']);
      pi.setActiveTools.mockClear();

      const beforeStartHandlers = handlers.get('before_agent_start') ?? [];
      const ctx = { sessionManager: createMissionSessionManager() };
      for (const handler of beforeStartHandlers) {
        handler({}, ctx as never);
      }

      const lastTools = pi.setActiveTools.mock.lastCall?.[0] as string[];
      expect(lastTools).toContain('run_state');
      expect(lastTools).not.toContain('conversation_auto_control');
    });

    it('activates conversation_auto_control only during hidden review turns in nudge mode', () => {
      const { pi, handlers } = createHarness();
      pi.getActiveTools.mockReturnValue(['read', 'bash']);
      pi.setActiveTools.mockClear();

      const beforeStartHandlers = handlers.get('before_agent_start') ?? [];

      // Nudge mode, review turn
      const ctx = {
        sessionManager: createSessionManager({
          enabled: true,
          mode: 'nudge',
          branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
        }),
      };
      for (const handler of beforeStartHandlers) {
        handler({}, ctx as never);
      }

      const lastTools = pi.setActiveTools.mock.lastCall?.[0] as string[];
      expect(lastTools).toContain('conversation_auto_control');
      expect(lastTools).not.toContain('run_state');
    });

    it('keeps conversation_auto_control inactive outside hidden review turns', () => {
      const { pi, handlers } = createHarness();
      pi.getActiveTools.mockReturnValue(['read', 'bash']);
      pi.setActiveTools.mockClear();

      const beforeStartHandlers = handlers.get('before_agent_start') ?? [];

      // Nudge mode, regular turn
      const ctx = {
        sessionManager: createSessionManager({
          enabled: true,
          mode: 'nudge',
          branch: [{ type: 'message', message: { role: 'user' } }],
        }),
      };
      for (const handler of beforeStartHandlers) {
        handler({}, ctx as never);
      }

      // setActiveTools should not be called since the tool list hasn't changed
      // (no auto tools should be injected for nudge outside review turns)
      const lastCall = pi.setActiveTools.mock.lastCall;
      if (lastCall && lastCall[0]) {
        const lastTools = lastCall[0] as string[];
        expect(lastTools).not.toContain('conversation_auto_control');
        expect(lastTools).not.toContain('run_state');
      }
    });
  });

  describe('turn_end per-mode behavior', () => {
    it('schedules a hidden review turn after visible turns in nudge mode', async () => {
      requestConversationAutoModeTurnMock.mockResolvedValue(true);
      const { handlers } = createHarness();
      const turnEndHandlers = handlers.get('turn_end') ?? [];

      await turnEndHandlers[0]?.(
        {} as never,
        {
          sessionManager: createSessionManager({
            enabled: true,
            mode: 'nudge',
            branch: [{ type: 'message', message: { role: 'user' } }],
          }),
        } as never,
      );
      await Promise.resolve();

      expect(requestConversationAutoModeTurnMock).toHaveBeenCalledWith('conversation-1', undefined);
    });

    it('does not reschedule hidden review turns from inside the hidden controller turn', async () => {
      const { handlers } = createHarness();
      const turnEndHandlers = handlers.get('turn_end') ?? [];

      await turnEndHandlers[0]?.(
        {} as never,
        {
          sessionManager: createSessionManager({
            enabled: true,
            branch: [{ type: 'custom_message', customType: 'conversation_automation_post_turn_review' }],
          }),
        } as never,
      );
      await Promise.resolve();

      expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();
      expect(markConversationAutoModeContinueRequestedMock).not.toHaveBeenCalled();
    });

    it('signals continuation for mission mode (structural task check, no hidden review)', async () => {
      markConversationAutoModeContinueRequestedMock.mockClear();
      const { handlers } = createHarness();
      const turnEndHandlers = handlers.get('turn_end') ?? [];

      await turnEndHandlers[0]?.(
        {} as never,
        {
          sessionManager: createMissionSessionManager(),
        } as never,
      );

      // Mission mode: should directly signal continuation, not go through hidden review path
      expect(markConversationAutoModeContinueRequestedMock).toHaveBeenCalledWith('conversation-1');
      expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();
    });

    it('signals continuation for loop mode (counter check, no hidden review)', async () => {
      markConversationAutoModeContinueRequestedMock.mockClear();
      const { handlers } = createHarness();
      const turnEndHandlers = handlers.get('turn_end') ?? [];

      await turnEndHandlers[0]?.(
        {} as never,
        {
          sessionManager: createLoopSessionManager(),
        } as never,
      );

      // Loop mode: should directly signal continuation, not go through hidden review path
      expect(markConversationAutoModeContinueRequestedMock).toHaveBeenCalledWith('conversation-1');
      expect(requestConversationAutoModeTurnMock).not.toHaveBeenCalled();
    });
  });

  describe('compaction recovery', () => {
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
      await vi.advanceTimersByTimeAsync(1500);
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
});
