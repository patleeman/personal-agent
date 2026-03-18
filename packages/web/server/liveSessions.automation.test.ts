import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationAutomationSkillStep,
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
  it('starts the next queued skill as an in-thread follow-up', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const prompt = vi.fn(async () => undefined);
    const step = createConversationAutomationSkillStep({
      skillName: 'workflow-checkpoint',
      skillArgs: 'commit only my files',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      document: {
        version: 1,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:00.000Z',
        paused: false,
        steps: [step],
      },
    });

    setLiveEntry('conv-123', {
      title: 'Automation conversation',
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

    await kickConversationAutomation('conv-123');

    expect(prompt).toHaveBeenCalledWith('/skill:workflow-checkpoint commit only my files');
    const updated = getConversationAutomationState({
      profile: 'datadog',
      conversationId: 'conv-123',
    });
    expect(updated.activeStepId).toBe(step.id);
    expect(updated.steps[0]).toMatchObject({
      id: step.id,
      kind: 'skill',
      status: 'running',
      skillName: 'workflow-checkpoint',
    });
    expect(updated.paused).toBe(false);
  });

  it('marks the active skill step complete on turn end and pauses the queue when finished', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const step = createConversationAutomationSkillStep({
      skillName: 'workflow-checkpoint',
      now: '2026-03-18T12:00:00.000Z',
    });

    writeConversationAutomationState({
      profile: 'datadog',
      document: {
        version: 1,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:00.000Z',
        paused: false,
        activeStepId: step.id,
        steps: [{
          ...step,
          status: 'running',
          startedAt: '2026-03-18T12:00:05.000Z',
          updatedAt: '2026-03-18T12:00:05.000Z',
        }],
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
        modelRegistry: {
          getAvailable: () => [],
          getApiKey: vi.fn(),
        },
      },
    });

    await kickConversationAutomation('conv-123', 'turn_end');

    const updated = getConversationAutomationState({
      profile: 'datadog',
      conversationId: 'conv-123',
    });
    expect(updated.activeStepId).toBeUndefined();
    expect(updated.paused).toBe(true);
    expect(updated.steps[0]).toMatchObject({
      id: step.id,
      status: 'completed',
      resultReason: 'Follow-up turn completed.',
    });
  });
});
