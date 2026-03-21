import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationAutomationTodoItem,
  getConversationAutomationState,
  writeConversationAutomationState,
} from './conversationAutomation.js';
import { kickConversationAutomation, registry } from './liveSessions.js';

const tempDirs: string[] = [];
const originalStateRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
const originalProfile = process.env.PERSONAL_AGENT_ACTIVE_PROFILE;

type LiveRegistryEntry = Parameters<typeof registry.set>[1];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function setLiveEntry(sessionId: string, entry: Omit<Partial<LiveRegistryEntry>, 'session'> & { session: unknown }) {
  registry.set(sessionId, {
    sessionId,
    cwd: entry.cwd ?? '/tmp/workspace',
    listeners: entry.listeners ?? new Set(),
    title: entry.title ?? '',
    autoTitleRequested: entry.autoTitleRequested ?? false,
    lastContextUsageJson: entry.lastContextUsageJson ?? null,
    lastQueueStateJson: entry.lastQueueStateJson ?? null,
    currentTurnError: entry.currentTurnError ?? null,
    pendingHiddenTurnCustomTypes: entry.pendingHiddenTurnCustomTypes ?? [],
    activeHiddenTurnCustomType: entry.activeHiddenTurnCustomType ?? null,
    ...(entry.lastDurableRunState ? { lastDurableRunState: entry.lastDurableRunState } : {}),
    ...(entry.contextUsageTimer ? { contextUsageTimer: entry.contextUsageTimer } : {}),
    session: entry.session as LiveRegistryEntry['session'],
  });
}

function buildTurnEntries(role: 'user' | 'custom', customType?: string) {
  return [{
    type: 'message',
    message: {
      role,
      ...(customType ? { customType } : {}),
    },
  }];
}

function buildTurnEntriesWithAssistant(
  role: 'user' | 'custom',
  options: { customType?: string; assistantStopReason?: string; assistantErrorMessage?: string } = {},
) {
  return [
    {
      type: 'message',
      message: {
        role,
        ...(options.customType ? { customType: options.customType } : {}),
      },
    },
    {
      type: 'message',
      message: {
        role: 'assistant',
        ...(options.assistantStopReason ? { stopReason: options.assistantStopReason } : {}),
        ...(options.assistantErrorMessage ? { errorMessage: options.assistantErrorMessage } : {}),
      },
    },
  ];
}

afterEach(() => {
  registry.clear();
  process.env.PERSONAL_AGENT_STATE_ROOT = originalStateRoot;
  process.env.PERSONAL_AGENT_ACTIVE_PROFILE = originalProfile;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conversation automation live-session integration', () => {
  it('starts the next pending automation item as a hidden follow-up turn on manual kick', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const item = createConversationAutomationTodoItem({
      id: 'item-1',
      label: 'workflow-checkpoint',
      skillName: 'workflow-checkpoint',
      skillArgs: 'commit only my files',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:00.000Z',
        enabled: true,
        items: [item],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getActiveToolNames: () => [],
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'manual');

    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_item',
      content: expect.stringContaining('/skill:workflow-checkpoint commit only my files'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_item',
      content: expect.stringContaining('Resolve this todo with todo_list using itemId "item-1".'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.activeItemId).toBe('item-1');
    expect(updated.items[0]).toMatchObject({
      id: 'item-1',
      status: 'running',
      skillName: 'workflow-checkpoint',
    });
    expect(updated.enabled).toBe(true);
  });

  it('starts a custom instruction step as a hidden follow-up turn on manual kick', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const item = createConversationAutomationTodoItem({
      id: 'item-text-1',
      kind: 'instruction',
      text: 'Review the last failing test run and explain the smallest safe fix.',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-124',
        updatedAt: '2026-03-18T12:00:00.000Z',
        enabled: true,
        items: [item],
      },
    });

    setLiveEntry('conv-124', {
      title: 'Instruction automation conversation',
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getActiveToolNames: () => [],
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-124', 'manual');

    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_item',
      content: expect.stringContaining('Carry out this checklist item:'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_item',
      content: expect.stringContaining('Review the last failing test run and explain the smallest safe fix.'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_item',
      content: expect.stringContaining('Resolve this todo with todo_list using itemId "item-text-1".'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-124',
    });
    expect(updated.activeItemId).toBe('item-text-1');
    expect(updated.items[0]).toMatchObject({
      id: 'item-text-1',
      kind: 'instruction',
      status: 'running',
      text: 'Review the last failing test run and explain the smallest safe fix.',
    });
  });

  it('fails the active item when an automation-authored step ends without resolving it through todo_list', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const prompt = vi.fn(async () => undefined);
    const runningItem = {
      ...createConversationAutomationTodoItem({
        id: 'item-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        now: '2026-03-18T12:00:00.000Z',
      }),
      status: 'running' as const,
      startedAt: '2026-03-18T12:00:05.000Z',
      updatedAt: '2026-03-18T12:00:05.000Z',
    };

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:05.000Z',
        enabled: true,
        activeItemId: 'item-1',
        items: [runningItem],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getContextUsage: () => null,
        isStreaming: false,
        prompt,
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sessionManager: {
          getEntries: () => buildTurnEntries('custom', 'conversation_automation_item'),
        },
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.activeItemId).toBeUndefined();
    expect(updated.enabled).toBe(false);
    expect(updated.items[0]).toMatchObject({
      id: 'item-1',
      status: 'failed',
      resultReason: 'Automation step ended without using todo_list to resolve the active item.',
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('queues a bookkeeping review after a normal user turn when pending items remain', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const pendingItem = createConversationAutomationTodoItem({
      id: 'item-1',
      label: 'workflow-checkpoint',
      skillName: 'workflow-checkpoint',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:15.000Z',
        enabled: true,
        items: [pendingItem],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        sessionManager: {
          getEntries: () => buildTurnEntriesWithAssistant('user'),
        },
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.activeItemId).toBeUndefined();
    expect(updated.items[0]).toMatchObject({
      id: 'item-1',
      status: 'pending',
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_post_turn_review',
      content: expect.stringContaining('Review the automation todo list after the assistant\'s user-facing reply.'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_post_turn_review',
      content: expect.stringContaining('checklist bookkeeping only'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
  });

  it('does not start post-turn review after an aborted assistant reply', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const pendingItem = createConversationAutomationTodoItem({
      id: 'item-1',
      label: 'workflow-checkpoint',
      skillName: 'workflow-checkpoint',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:15.000Z',
        enabled: true,
        items: [pendingItem],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        sessionManager: {
          getEntries: () => buildTurnEntriesWithAssistant('user', {
            assistantStopReason: 'aborted',
          }),
        },
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('does not continue automation after a bookkeeping review turn', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const pendingItem = createConversationAutomationTodoItem({
      id: 'item-1',
      label: 'workflow-checkpoint',
      skillName: 'workflow-checkpoint',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:15.000Z',
        enabled: true,
        items: [pendingItem],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        sessionManager: {
          getEntries: () => buildTurnEntries('custom', 'conversation_automation_post_turn_review'),
        },
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('does not start review after a normal user turn when all items are already completed', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const completedItem = {
      ...createConversationAutomationTodoItem({
        id: 'item-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        now: '2026-03-18T12:00:00.000Z',
      }),
      status: 'completed' as const,
      startedAt: '2026-03-18T12:00:05.000Z',
      completedAt: '2026-03-18T12:00:10.000Z',
      updatedAt: '2026-03-18T12:00:10.000Z',
      resultReason: 'Done.',
    };

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:15.000Z',
        enabled: true,
        items: [completedItem],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        sessionManager: {
          getEntries: () => buildTurnEntries('user'),
        },
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.review).toBeUndefined();
    expect(sendCustomMessage).not.toHaveBeenCalled();
  });

  it('starts review after an automation-authored turn when all items are already completed', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const sendCustomMessage = vi.fn(async () => undefined);
    const completedItem = {
      ...createConversationAutomationTodoItem({
        id: 'item-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        now: '2026-03-18T12:00:00.000Z',
      }),
      status: 'completed' as const,
      startedAt: '2026-03-18T12:00:05.000Z',
      completedAt: '2026-03-18T12:00:10.000Z',
      updatedAt: '2026-03-18T12:00:10.000Z',
      resultReason: 'Done.',
    };

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 4,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:15.000Z',
        enabled: true,
        items: [completedItem],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: { messages: [], streamMessage: null },
        agent: { state: { messages: [] } },
        getContextUsage: () => null,
        isStreaming: false,
        prompt: vi.fn(async () => undefined),
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        sendCustomMessage,
        sessionManager: {
          getEntries: () => buildTurnEntries('custom', 'conversation_automation_item'),
        },
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.review).toMatchObject({
      status: 'running',
      round: 1,
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_review',
      content: expect.stringContaining('Review the automation todo list before stopping.'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
    expect(sendCustomMessage).toHaveBeenCalledWith({
      customType: 'conversation_automation_review',
      content: expect.stringContaining('use todo_list with {"action":"add",...} to add the needed follow-up items'),
      display: false,
      details: undefined,
    }, {
      deliverAs: 'followUp',
      triggerTurn: true,
    });
  });
});
