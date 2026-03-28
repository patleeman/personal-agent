import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addConversationProjectLink, loadDeferredResumeState } from '@personal-agent/core';
import {
  cancelConversationSelfDistillWakeups,
  CONVERSATION_SELF_DISTILL_SOURCE_KIND,
  CONVERSATION_SELF_DISTILL_TITLE,
  listConversationSelfDistillWakeupRecords,
  scheduleConversationSelfDistillWakeup,
} from './conversationSelfDistill.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSessionFile(path: string, conversationId: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ type: 'session', id: conversationId, timestamp: '2026-03-28T10:00:00.000Z', cwd: '/tmp/workspace' })}\n`, 'utf-8');
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversation self-distill wakeups', () => {
  it('schedules one conservative wakeup per conversation and dedupes repeats', async () => {
    const stateRoot = createTempDir('pa-web-self-distill-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const sessionFile = join(stateRoot, 'sessions', 'conv-123.jsonl');
    writeSessionFile(sessionFile, 'conv-123');
    addConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      projectId: 'personal-agent',
      updatedAt: '2026-03-28T10:00:00.000Z',
    });

    const first = await scheduleConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      sessionFile,
      delay: '10m',
      now: new Date('2026-03-28T10:00:00.000Z'),
    });
    const second = await scheduleConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      sessionFile,
      delay: '10m',
      now: new Date('2026-03-28T10:01:00.000Z'),
    });

    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.resume.id).toBe(first.resume.id);
    expect(first.resume.title).toBe(CONVERSATION_SELF_DISTILL_TITLE);
    expect(first.resume.prompt).toContain('This conversation was just closed in the web UI.');
    expect(first.resume.prompt).toContain('If nothing clearly deserves a durable update, reply exactly: No durable update needed.');
    expect(first.resume.prompt).toContain('- create or update a shared note node for reusable knowledge');
    expect(first.resume.prompt).toContain('- update an already-linked project');
    expect(first.resume.prompt).toContain('Do not create a new project from this pass.');
    expect(first.resume.prompt).toContain('Do not edit AGENTS.md or create/update skills');
    expect(first.resume.prompt).toContain('Currently linked projects: @personal-agent');
    expect(first.resume.dueAt).toBe('2026-03-28T10:10:00.000Z');

    const resumes = Object.values(loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json')).resumes);
    expect(resumes).toHaveLength(1);
    expect(resumes[0]).toMatchObject({
      id: first.resume.id,
      sessionFile,
      status: 'scheduled',
      title: CONVERSATION_SELF_DISTILL_TITLE,
      source: {
        kind: CONVERSATION_SELF_DISTILL_SOURCE_KIND,
        id: 'conv-123',
      },
      delivery: {
        alertLevel: 'none',
        autoResumeIfOpen: false,
        requireAck: false,
      },
    });
    expect(listConversationSelfDistillWakeupRecords({ stateRoot, sessionFile })).toHaveLength(1);
  });

  it('cancels pending self-distill wakeups when the conversation becomes visible again', async () => {
    const stateRoot = createTempDir('pa-web-self-distill-cancel-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const sessionFile = join(stateRoot, 'sessions', 'conv-456.jsonl');
    writeSessionFile(sessionFile, 'conv-456');

    const scheduled = await scheduleConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      sessionFile,
      now: new Date('2026-03-28T10:00:00.000Z'),
    });

    const cancelledIds = await cancelConversationSelfDistillWakeups({
      stateRoot,
      sessionFile,
      conversationId: 'conv-456',
    });

    expect(cancelledIds).toEqual([scheduled.resume.id]);
    expect(listConversationSelfDistillWakeupRecords({ stateRoot, sessionFile })).toEqual([]);
    expect(Object.values(loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json')).resumes)).toEqual([]);
  });
});
