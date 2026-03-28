import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addConversationProjectLink, loadDeferredResumeState } from '@personal-agent/core';
import {
  CONVERSATION_SELF_DISTILL_SOURCE_KIND,
  CONVERSATION_SELF_DISTILL_TITLE,
  maybeScheduleAutomaticConversationSelfDistillWakeup,
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
    expect(first.resume.prompt).toContain('Review the recent progress in this conversation with a high bar for durable updates.');
    expect(first.resume.prompt).toContain('Do exactly one of these:');
    expect(first.resume.prompt).toContain('- no durable update');
    expect(first.resume.prompt).toContain('- update an existing note node or create a new note node');
    expect(first.resume.prompt).toContain('- update linked project state or project notes');
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
        autoResumeIfOpen: true,
        requireAck: false,
      },
    });
  });

  it('uses the automatic default only for conservative one-project conversations and dedupes follow-up lifecycle events', async () => {
    const stateRoot = createTempDir('pa-web-self-distill-auto-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const sessionFile = join(stateRoot, 'sessions', 'conv-eligible.jsonl');
    writeSessionFile(sessionFile, 'conv-eligible');
    addConversationProjectLink({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-eligible',
      projectId: 'personal-agent',
      updatedAt: '2026-03-28T10:00:00.000Z',
    });

    const first = await maybeScheduleAutomaticConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-eligible',
      sessionFile,
      title: 'Conversation about project state',
      now: new Date('2026-03-28T10:00:00.000Z'),
    });
    const second = await maybeScheduleAutomaticConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-eligible',
      sessionFile,
      title: 'Conversation about project state',
      now: new Date('2026-03-28T10:01:00.000Z'),
    });

    expect(first).toEqual(expect.objectContaining({
      scheduled: true,
      deduped: false,
      reason: 'scheduled',
      resume: expect.objectContaining({
        title: CONVERSATION_SELF_DISTILL_TITLE,
        sessionFile,
      }),
    }));
    expect(second).toEqual(expect.objectContaining({
      scheduled: true,
      deduped: true,
      reason: 'deduped',
      resume: expect.objectContaining({
        id: first.resume?.id,
      }),
    }));

    const resumes = Object.values(loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json')).resumes);
    expect(resumes).toHaveLength(1);
    expect(resumes[0]?.source).toEqual({
      kind: CONVERSATION_SELF_DISTILL_SOURCE_KIND,
      id: 'conv-eligible',
    });
  });

  it('skips the automatic default for recovery conversations, missing session files, and non-eligible conversations', async () => {
    const stateRoot = createTempDir('pa-web-self-distill-skip-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const sessionFile = join(stateRoot, 'sessions', 'conv-skip.jsonl');
    writeSessionFile(sessionFile, 'conv-skip');

    await expect(maybeScheduleAutomaticConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-skip',
      sessionFile: join(stateRoot, 'sessions', 'missing.jsonl'),
      title: 'Ordinary conversation',
    })).resolves.toEqual({
      scheduled: false,
      deduped: false,
      reason: 'missing-session-file',
    });

    await expect(maybeScheduleAutomaticConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-skip',
      sessionFile,
      title: 'Recover node distillation: Fix the failed update',
    })).resolves.toEqual({
      scheduled: false,
      deduped: false,
      reason: 'recovery-conversation',
    });

    const ineligible = await maybeScheduleAutomaticConversationSelfDistillWakeup({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-skip',
      sessionFile,
      title: 'No linked project here',
    });

    expect(ineligible).toEqual({
      scheduled: false,
      deduped: false,
      reason: 'not-eligible',
    });
    expect(existsSync(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'))).toBe(false);
  });
});
