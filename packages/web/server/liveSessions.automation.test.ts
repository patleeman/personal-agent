import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationAutomationGate,
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
  it('starts the next nested skill as an in-thread follow-up once its gate is running', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const prompt = vi.fn(async () => undefined);
    const gate = createConversationAutomationGate({
      id: 'gate-1',
      label: 'Ready to checkpoint?',
      prompt: 'Pass when the work is ready to checkpoint.',
      skills: [{
        id: 'skill-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
        skillArgs: 'commit only my files',
      }],
      now: '2026-03-18T12:00:00.000Z',
    });
    gate.status = 'running';
    gate.startedAt = '2026-03-18T12:00:05.000Z';
    gate.updatedAt = '2026-03-18T12:00:05.000Z';

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 2,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:05.000Z',
        enabled: true,
        activeGateId: 'gate-1',
        gates: [gate],
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

    await kickConversationAutomation('conv-123', 'turn_end');

    expect(prompt).toHaveBeenCalledWith('/skill:workflow-checkpoint commit only my files');
    const updated = getConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.activeGateId).toBe('gate-1');
    expect(updated.activeSkillId).toBe('skill-1');
    expect(updated.gates[0]).toMatchObject({
      id: 'gate-1',
      status: 'running',
    });
    expect(updated.gates[0]!.skills[0]).toMatchObject({
      id: 'skill-1',
      status: 'running',
      skillName: 'workflow-checkpoint',
    });
    expect(updated.enabled).toBe(true);
  });

  it('marks the active nested skill complete on turn end and keeps automation on', async () => {
    const stateRoot = createTempDir('pa-live-automation-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;
    process.env.PERSONAL_AGENT_ACTIVE_PROFILE = 'datadog';

    const gate = createConversationAutomationGate({
      id: 'gate-1',
      label: 'Ready to checkpoint?',
      prompt: 'Pass when the work is ready to checkpoint.',
      skills: [{
        id: 'skill-1',
        label: 'workflow-checkpoint',
        skillName: 'workflow-checkpoint',
      }],
      now: '2026-03-18T12:00:00.000Z',
    });
    gate.status = 'running';
    gate.startedAt = '2026-03-18T12:00:05.000Z';
    gate.updatedAt = '2026-03-18T12:00:05.000Z';
    gate.skills[0]!.status = 'running';
    gate.skills[0]!.startedAt = '2026-03-18T12:00:05.000Z';
    gate.skills[0]!.updatedAt = '2026-03-18T12:00:05.000Z';

    writeConversationAutomationState({
      profile: 'datadog',
      stateRoot,
      document: {
        version: 2,
        conversationId: 'conv-123',
        updatedAt: '2026-03-18T12:00:05.000Z',
        enabled: true,
        activeGateId: 'gate-1',
        activeSkillId: 'skill-1',
        gates: [gate],
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
      stateRoot,
      conversationId: 'conv-123',
    });
    expect(updated.activeGateId).toBeUndefined();
    expect(updated.activeSkillId).toBeUndefined();
    expect(updated.enabled).toBe(true);
    expect(updated.gates[0]).toMatchObject({
      id: 'gate-1',
      status: 'completed',
    });
    expect(updated.gates[0]!.skills[0]).toMatchObject({
      id: 'skill-1',
      status: 'completed',
      resultReason: 'Follow-up turn completed.',
    });
  });
});
