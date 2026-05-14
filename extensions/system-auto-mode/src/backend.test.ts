import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';

import { createConversationAutoModeAgentExtension } from './backend.js';

type RegisteredTool = { name: string; execute: (...args: any[]) => Promise<{ content?: Array<{ text?: string }>; details?: unknown }> };
type AgentEventHandler = (event: unknown, ctx: TestContext) => void | Promise<void>;

interface TestContext {
  sessionManager: { getEntries: () => unknown[] };
  hasPendingMessages: () => boolean;
  signal: { aborted: boolean };
}

function customEntry(customType: string, data: unknown) {
  return { type: 'custom', customType, data };
}

function activeGoal(objective = 'ship goal mode', noProgressTurns = 0, updatedAt = '2026-05-09T00:00:00.000Z') {
  return customEntry('conversation-goal', {
    objective,
    status: 'active',
    tasks: [],
    stopReason: null,
    updatedAt,
    noProgressTurns,
  });
}

function completeGoal(stopReason = 'goal achieved', updatedAt = '2026-05-09T00:00:01.000Z') {
  return customEntry('conversation-goal', {
    objective: '',
    status: 'complete',
    tasks: [],
    stopReason,
    updatedAt,
    noProgressTurns: 0,
  });
}

function createHarness(initialEntries: unknown[] = []) {
  const handlers = new Map<string, Array<(event: unknown, ctx: any) => void | Promise<void>>>();
  const registeredTools: RegisteredTool[] = [];
  const registeredCommands = new Map<string, { handler: (args: string, ctx: any) => Promise<void> }>();
  const entries = [...initialEntries];
  const appendEntry = vi.fn((customType: string, data: unknown) => entries.push(customEntry(customType, data)));
  const sendMessage = vi.fn();
  const sendUserMessage = vi.fn();
  const pi = {
    registerTool: vi.fn((tool: RegisteredTool) => registeredTools.push(tool)),
    registerCommand: vi.fn((name: string, command: { handler: (args: string, ctx: any) => Promise<void> }) => {
      registeredCommands.set(name, command);
    }),
    sendMessage,
    sendUserMessage,
    appendEntry,
    on: vi.fn((name: string, handler: (event: unknown, ctx: any) => void | Promise<void>) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    }),
  } as unknown as ExtensionAPI;

  createConversationAutoModeAgentExtension()(pi);

  const ctx: TestContext = {
    sessionManager: { getEntries: () => entries },
    hasPendingMessages: () => false,
    signal: { aborted: false },
  };

  return {
    entries,
    appendEntry,
    sendMessage,
    sendUserMessage,
    registeredTools,
    registeredCommands,
    setGoal: registeredTools.find((tool) => tool.name === 'set_goal')!,
    updateGoal: registeredTools.find((tool) => tool.name === 'update_goal')!,
    turnEnd: handlers.get('turn_end')?.[0] as AgentEventHandler,
    agentEnd: handlers.get('agent_end')?.[0] as AgentEventHandler,
    ctx,
  };
}

async function flushTimers() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function finishAgentRun(harness: { agentEnd: AgentEventHandler; ctx: TestContext }) {
  await harness.agentEnd({}, harness.ctx);
  await flushTimers();
}

async function finishAgentRunWithFakeTimers(harness: { agentEnd: AgentEventHandler; ctx: TestContext }) {
  await harness.agentEnd({}, harness.ctx);
  await vi.runOnlyPendingTimersAsync();
}

describe('system-goal-mode extension', () => {
  it('registers only goal set and update tools', () => {
    const { registeredTools } = createHarness();
    expect(registeredTools.map((tool) => tool.name)).toEqual(['set_goal', 'update_goal']);
  });

  it('set_goal enables goal mode with a concrete objective', async () => {
    const { setGoal, appendEntry, ctx } = createHarness();

    const result = await setGoal.execute('goal-1', { objective: ' ship it ' }, new AbortController().signal, vi.fn(), ctx);

    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: 'ship it', status: 'active', stopReason: null, noProgressTurns: 0 }),
    );
    expect(result.content?.[0]?.text).toBe('Goal set: "ship it"');
  });

  it('set_goal updates the active goal instead of throwing', async () => {
    const { setGoal, appendEntry, ctx } = createHarness([activeGoal('old goal')]);

    const result = await setGoal.execute('goal-1', { objective: 'new goal' }, new AbortController().signal, vi.fn(), ctx);

    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: 'new goal', status: 'active', stopReason: null, noProgressTurns: 0 }),
    );
    expect(result.content?.[0]?.text).toBe('Goal set: "new goal"');
  });

  it('update_goal can enable or update goal mode with a new objective', async () => {
    const { updateGoal, appendEntry, ctx } = createHarness([completeGoal('cleared')]);

    const result = await updateGoal.execute('goal-2', { objective: 'resume work' }, new AbortController().signal, vi.fn(), ctx);

    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: 'resume work', status: 'active', stopReason: null, noProgressTurns: 0 }),
    );
    expect(result.content?.[0]?.text).toBe('Goal updated: "resume work"');
  });

  it('update_goal complete disables goal mode without aborting the current turn', async () => {
    const { updateGoal, appendEntry, ctx } = createHarness([activeGoal('ship it')]);
    const abort = vi.fn();

    const result = await updateGoal.execute('goal-2', { status: 'complete' }, new AbortController().signal, vi.fn(), { ...ctx, abort });

    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'goal achieved', noProgressTurns: 0 }),
    );
    expect(abort).not.toHaveBeenCalled();
    expect(result.content?.[0]?.text).toBe('Goal complete!');
  });

  it('agent_end is the only scheduler and queues one continuation while goal mode is active', async () => {
    const harness = createHarness([activeGoal('ship it')]);
    const { turnEnd, sendMessage, ctx } = harness;

    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);
    await flushTimers();
    expect(sendMessage).not.toHaveBeenCalled();

    await finishAgentRun(harness);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ customType: 'goal-continuation', display: true, content: expect.stringContaining('Objective: ship it') }),
      { deliverAs: 'followUp', triggerTurn: true },
    );
  });

  it('runs a realistic goal lifecycle: enable, continue, update, complete, then stop', async () => {
    const harness = createHarness();
    const { setGoal, updateGoal, turnEnd, sendMessage, appendEntry, ctx } = harness;

    await setGoal.execute('goal-1', { objective: 'audit the repo' }, new AbortController().signal, vi.fn(), ctx);
    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);
    await finishAgentRun(harness);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ customType: 'goal-continuation', content: expect.stringContaining('Objective: audit the repo') }),
      { deliverAs: 'followUp', triggerTurn: true },
    );

    await updateGoal.execute('goal-2', { objective: 'audit the repo deeply' }, new AbortController().signal, vi.fn(), ctx);
    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'read' }] }, ctx);
    await finishAgentRun(harness);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ customType: 'goal-continuation', content: expect.stringContaining('Objective: audit the repo deeply') }),
      { deliverAs: 'followUp', triggerTurn: true },
    );

    await updateGoal.execute('goal-3', { status: 'complete' }, new AbortController().signal, vi.fn(), ctx);
    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);
    await finishAgentRun(harness);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'goal achieved' }),
    );
  });

  it('does not queue stale continuations from tool turn_end events before completion', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness([activeGoal('ship the fix')]);
      const { updateGoal, turnEnd, sendMessage, appendEntry, ctx } = harness;

      await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'read' }] }, ctx);
      await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'edit' }] }, ctx);
      await vi.runOnlyPendingTimersAsync();
      expect(sendMessage).not.toHaveBeenCalled();

      await updateGoal.execute('goal-complete', { status: 'complete' }, new AbortController().signal, vi.fn(), ctx);
      await finishAgentRunWithFakeTimers(harness);

      expect(sendMessage).not.toHaveBeenCalled();
      expect(appendEntry).toHaveBeenCalledWith(
        'conversation-goal',
        expect.objectContaining({ objective: '', status: 'complete', stopReason: 'goal achieved', noProgressTurns: 0 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs a live-streaming goal scenario from mid-turn enable through completion', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      const { setGoal, updateGoal, turnEnd, sendMessage, appendEntry, ctx } = harness;

      await setGoal.execute('goal-1', { objective: 'ship the fix' }, new AbortController().signal, vi.fn(), ctx);
      await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);

      expect(sendMessage).not.toHaveBeenCalled();
      await vi.runOnlyPendingTimersAsync();
      expect(sendMessage).not.toHaveBeenCalled();

      await finishAgentRunWithFakeTimers(harness);

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          customType: 'goal-continuation',
          display: true,
          content: expect.stringContaining('Objective: ship the fix'),
        }),
        { deliverAs: 'followUp', triggerTurn: true },
      );

      await updateGoal.execute('goal-2', { status: 'complete' }, new AbortController().signal, vi.fn(), ctx);
      await turnEnd({ toolResults: [] }, ctx);
      await vi.runOnlyPendingTimersAsync();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(appendEntry).toHaveBeenCalledWith(
        'conversation-goal',
        expect.objectContaining({ objective: '', status: 'complete', stopReason: 'goal achieved', noProgressTurns: 0 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops a realistic continuation loop after two no-tool turns', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness([activeGoal('ship the fix')]);
      const { turnEnd, sendMessage, appendEntry, ctx } = harness;

      await turnEnd({ toolResults: [] }, ctx);
      await vi.runOnlyPendingTimersAsync();

      expect(sendMessage).not.toHaveBeenCalled();
      expect(appendEntry).toHaveBeenCalledWith('conversation-goal', expect.objectContaining({ status: 'active', noProgressTurns: 1 }));

      await finishAgentRunWithFakeTimers(harness);
      expect(sendMessage).toHaveBeenCalledTimes(1);

      await turnEnd({ toolResults: [] }, ctx);
      await vi.runOnlyPendingTimersAsync();

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(appendEntry).toHaveBeenCalledWith(
        'conversation-goal',
        expect.objectContaining({ objective: '', status: 'complete', stopReason: 'no progress', noProgressTurns: 0 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not schedule a continuation when goal mode is disabled before agent_end', async () => {
    const harness = createHarness([activeGoal('ship it'), completeGoal('goal achieved')]);
    const { turnEnd, sendMessage, ctx } = harness;

    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);
    await finishAgentRun(harness);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not send a pending continuation if the user disables goal mode before the timer fires', async () => {
    const harness = createHarness([activeGoal('ship it')]);
    const { turnEnd, sendMessage, appendEntry, ctx } = harness;

    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);
    await harness.agentEnd({}, ctx);
    appendEntry('conversation-goal', {
      objective: '',
      status: 'complete',
      tasks: [],
      stopReason: 'cleared',
      updatedAt: '2026-05-09T00:00:02.000Z',
      noProgressTurns: 0,
    });
    await flushTimers();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not schedule a continuation when user input is pending', async () => {
    const harness = createHarness([activeGoal('ship it')]);
    const { turnEnd, sendMessage, ctx } = harness;
    const pendingCtx = { ...ctx, hasPendingMessages: () => true };

    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, pendingCtx);
    await harness.agentEnd({}, pendingCtx);
    await flushTimers();

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('disables goal mode after two consecutive active turns with no tool calls', async () => {
    const harness = createHarness([activeGoal('ship it')]);
    const { turnEnd, sendMessage, appendEntry, ctx } = harness;

    await turnEnd({ toolResults: [] }, ctx);
    await flushTimers();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith('conversation-goal', expect.objectContaining({ status: 'active', noProgressTurns: 1 }));

    await finishAgentRun(harness);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    await turnEnd({ toolResults: [] }, ctx);
    await flushTimers();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'no progress', noProgressTurns: 0 }),
    );
  });

  it('resets the no-tool counter after a turn with tool calls', async () => {
    const { turnEnd, appendEntry, ctx } = createHarness([activeGoal('ship it', 1)]);

    await turnEnd({ toolResults: [{ type: 'tool_result', toolName: 'bash' }] }, ctx);
    await flushTimers();

    expect(appendEntry).toHaveBeenCalledWith('conversation-goal', expect.objectContaining({ status: 'active', noProgressTurns: 0 }));
  });

  it('slash command clear disables goal mode through the same canonical state', async () => {
    const { appendEntry, sendUserMessage, registeredCommands, ctx } = createHarness([activeGoal('ship it')]);

    await registeredCommands.get('goal')?.handler('clear', ctx);

    expect(appendEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'cleared', noProgressTurns: 0 }),
    );
    expect(sendUserMessage).toHaveBeenCalledWith('Goal cleared. Previous objective: ship it');
  });
});
