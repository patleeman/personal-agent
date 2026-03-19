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
    ...(entry.lastDurableRunState ? { lastDurableRunState: entry.lastDurableRunState } : {}),
    ...(entry.contextUsageTimer ? { contextUsageTimer: entry.contextUsageTimer } : {}),
    session: entry.session as LiveRegistryEntry['session'],
  });
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
  it('starts the next pending automation item as a follow-up turn', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const prompt = vi.fn(async () => undefined);
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
        version: 3,
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
        prompt,
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    expect(prompt).toHaveBeenCalledWith('/skill:workflow-checkpoint commit only my files');
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

  it('finalizes the active item on turn end and starts review', async () => {
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
        version: 3,
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
    expect(updated.enabled).toBe(true);
    expect(updated.items[0]).toMatchObject({
      id: 'item-1',
      status: 'completed',
      resultReason: 'Follow-up turn completed.',
    });
    expect(updated.review).toMatchObject({
      status: 'running',
      round: 1,
    });
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining('Review the automation todo list before stopping.'));
  });

  it('appends review-generated items and starts the first appended item', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const prompt = vi.fn(async () => undefined);
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
    const assistantText = [
      'Looks good.',
      '<automation-todos>',
      '  <skill name="workflow-checkpoint" args="commit only my files">Checkpoint</skill>',
      '</automation-todos>',
    ].join('\n');

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 3,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:15.000Z',
        enabled: true,
        items: [completedItem],
        review: {
          status: 'running',
          round: 1,
          createdAt: '2026-03-18T12:00:12.000Z',
          updatedAt: '2026-03-18T12:00:15.000Z',
          startedAt: '2026-03-18T12:00:12.000Z',
        },
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
      currentTurnError: null,
      session: {
        state: {
          messages: [{ role: 'assistant', content: [{ type: 'text', text: assistantText }] }],
          streamMessage: null,
        },
        agent: {
          state: {
            messages: [{ role: 'assistant', content: [{ type: 'text', text: assistantText }] }],
          },
        },
        getContextUsage: () => null,
        isStreaming: false,
        prompt,
        steer: vi.fn(async () => undefined),
        followUp: vi.fn(async () => undefined),
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
    expect(updated.items).toHaveLength(2);
    expect(updated.activeItemId).toBe(updated.items[1]!.id);
    expect(updated.items[1]).toMatchObject({
      label: 'Checkpoint',
      skillName: 'workflow-checkpoint',
      skillArgs: 'commit only my files',
      status: 'running',
    });
    expect(prompt).toHaveBeenCalledWith('/skill:workflow-checkpoint commit only my files');
  });
});
