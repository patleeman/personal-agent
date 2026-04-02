import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildConversationMemoryWorkItemsFromStates,
  isConversationMemoryDistillRecoveryTitle,
  markConversationMemoryMaintenanceRunCompleted,
  markConversationMemoryMaintenanceRunStarted,
  prepareConversationMemoryMaintenance,
  readConversationCheckpointSnapshotFromState,
  readConversationMemoryMaintenanceState,
  resolveConversationMemoryMaintenanceEventsPath,
  resolveConversationMemoryMaintenancePath,
} from './conversationMemoryMaintenance.js';

const tempDirs: string[] = [];

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-conversation-memory-maintenance-'));
  tempDirs.push(dir);
  return dir;
}

function writeSessionFile(path: string, lines: unknown[]): void {
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf-8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('conversationMemoryMaintenance', () => {
  it('recognizes memory distillation recovery branch titles', () => {
    expect(isConversationMemoryDistillRecoveryTitle('Recover page distillation: Fix durable session path regression')).toBe(true);
    expect(isConversationMemoryDistillRecoveryTitle('Recover memory distillation: Fix durable session path regression')).toBe(true);
    expect(isConversationMemoryDistillRecoveryTitle('Fix durable session path regression')).toBe(false);
    expect(isConversationMemoryDistillRecoveryTitle(undefined)).toBe(false);
  });

  it('captures checkpoints for all conversations and records no-promotion when auto mode is not eligible', () => {
    const stateRoot = createTempStateRoot();
    const sessionFile = join(stateRoot, 'session.jsonl');
    writeSessionFile(sessionFile, [
      { type: 'session', id: 'conv-1', timestamp: '2026-03-21T00:00:00.000Z', cwd: '/tmp/workspace' },
      {
        type: 'message',
        id: 'user-1',
        timestamp: '2026-03-21T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Remember that I prefer a flatter inbox-first layout.' }] },
      },
      {
        type: 'message',
        id: 'assistant-1',
        timestamp: '2026-03-21T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Got it.' }] },
      },
    ]);

    const prepared = prepareConversationMemoryMaintenance({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-1',
      sessionFile,
      conversationTitle: 'Layout preferences',
      cwd: '/tmp/workspace',
      relatedProjectIds: [],
      trigger: 'turn_end',
      mode: 'auto',
    });

    expect(prepared.shouldStartRun).toBe(false);
    expect(prepared.state.status).toBe('no-promotion');
    expect(prepared.checkpoint.checkpointId).toBeTruthy();

    const persisted = readConversationMemoryMaintenanceState({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-1',
    });
    expect(persisted).toMatchObject({
      status: 'no-promotion',
      latestCheckpointId: prepared.checkpoint.checkpointId,
      latestAnchorMessageId: 'assistant-1',
      autoPromotionEligible: false,
    });
    expect(existsSync(resolveConversationMemoryMaintenancePath({ stateRoot, profile: 'datadog', conversationId: 'conv-1' }))).toBe(true);

    const events = readFileSync(resolveConversationMemoryMaintenanceEventsPath({ stateRoot, profile: 'datadog' }), 'utf-8');
    expect(events).toContain('checkpoint_created');
    expect(events).toContain('evaluation_skipped');
  });

  it('deduplicates repeated auto processing for the same anchor', () => {
    const stateRoot = createTempStateRoot();
    const sessionFile = join(stateRoot, 'session.jsonl');
    writeSessionFile(sessionFile, [
      { type: 'session', id: 'conv-2', timestamp: '2026-03-21T00:00:00.000Z', cwd: '/tmp/workspace' },
      {
        type: 'message',
        id: 'user-1',
        timestamp: '2026-03-21T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Investigate the build break in @personal-agent.' }] },
      },
      {
        type: 'message',
        id: 'assistant-1',
        timestamp: '2026-03-21T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'I found the root cause.' }] },
      },
    ]);

    const first = prepareConversationMemoryMaintenance({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-2',
      sessionFile,
      conversationTitle: 'Build break',
      cwd: '/tmp/workspace',
      relatedProjectIds: ['personal-agent'],
      trigger: 'turn_end',
      mode: 'auto',
    });
    const second = prepareConversationMemoryMaintenance({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-2',
      sessionFile,
      conversationTitle: 'Build break',
      cwd: '/tmp/workspace',
      relatedProjectIds: ['personal-agent'],
      trigger: 'auto_compaction_end',
      mode: 'auto',
    });

    expect(first.shouldStartRun).toBe(true);
    expect(second.shouldStartRun).toBe(false);
    expect(second.checkpoint.checkpointId).toBe(first.checkpoint.checkpointId);
  });

  it('tracks running and completed auto-promotion state', () => {
    const stateRoot = createTempStateRoot();
    const sessionFile = join(stateRoot, 'session.jsonl');
    writeSessionFile(sessionFile, [
      { type: 'session', id: 'conv-3', timestamp: '2026-03-21T00:00:00.000Z', cwd: '/tmp/workspace' },
      {
        type: 'message',
        id: 'user-1',
        timestamp: '2026-03-21T00:00:01.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'Capture the durable decision for the project memory flow.' }] },
      },
      {
        type: 'message',
        id: 'assistant-1',
        timestamp: '2026-03-21T00:00:02.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'We should process all conversations but only promote reusable knowledge.' }] },
      },
    ]);

    const prepared = prepareConversationMemoryMaintenance({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-3',
      sessionFile,
      conversationTitle: 'Memory flow',
      cwd: '/tmp/workspace',
      relatedProjectIds: ['personal-agent'],
      trigger: 'turn_end',
      mode: 'auto',
    });

    const running = markConversationMemoryMaintenanceRunStarted({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-3',
      checkpointId: prepared.checkpoint.checkpointId,
      runId: 'run-123',
    });
    expect(running.status).toBe('running');
    expect(running.lastRunId).toBe('run-123');

    const snapshot = readConversationCheckpointSnapshotFromState({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-3',
      checkpointId: prepared.checkpoint.checkpointId,
    });
    expect(snapshot.anchor.preview).toContain('process all conversations');

    const completed = markConversationMemoryMaintenanceRunCompleted({
      stateRoot,
      profile: 'datadog',
      conversationId: 'conv-3',
      checkpointId: prepared.checkpoint.checkpointId,
      memoryId: 'personal-agent',
      referencePath: 'references/conversation-memory-flow.md',
    });
    expect(completed.status).toBe('promoted');
    expect(completed.promotedMemoryId).toBe('personal-agent');

    const workItems = buildConversationMemoryWorkItemsFromStates([completed]);
    expect(workItems).toEqual([]);
  });
});
