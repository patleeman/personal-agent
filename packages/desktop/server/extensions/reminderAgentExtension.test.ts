import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { loadDeferredResumeState } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReminderAgentExtension } from './reminderAgentExtension.js';

const tempDirs: string[] = [];
const originalEnv = process.env;
type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type ExecuteContext = Parameters<NonNullable<RegisteredTool['execute']>>[4];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function registerReminderTool() {
  let registeredTool: RegisteredTool | undefined;
  createReminderAgentExtension()({
    registerTool: (tool: RegisteredTool) => {
      registeredTool = tool;
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Reminder tool was not registered.');
  }

  return registeredTool;
}

describe('reminder agent extension', () => {
  it('registers reminder-specific guidance', () => {
    const registeredTool = registerReminderTool();
    const guidelines = registeredTool.promptGuidelines?.join('\n') ?? '';

    expect(guidelines).toContain('current conversation');
    expect(guidelines).toContain('tell me later');
    expect(guidelines).toContain('Provide either delay or at, not both');
  });

  it('schedules a disruptive acknowledged reminder with reminder metadata', async () => {
    const stateRoot = createTempDir('pa-web-reminder-tool-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const registeredTool = registerReminderTool();
    const result = await registeredTool.execute(
      'tool-1',
      {
        delay: '15m',
        prompt: 'Watch Mosaic and approve the kube changes.',
        title: 'Watch the prod gates',
      },
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => '/tmp/sessions/conv-123.jsonl',
        },
      } as ExecuteContext,
    );

    const firstContent = result.content[0];
    expect(firstContent?.type).toBe('text');
    expect(firstContent && 'text' in firstContent ? firstContent.text : '').toContain('Scheduled reminder');

    const state = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
    const storedReminder = Object.values(state.resumes)[0];
    expect(storedReminder).toEqual(
      expect.objectContaining({
        sessionFile: '/tmp/sessions/conv-123.jsonl',
        prompt: 'Watch Mosaic and approve the kube changes.',
        title: 'Watch the prod gates',
        kind: 'reminder',
        status: 'scheduled',
        source: { kind: 'reminder-tool' },
        delivery: {
          alertLevel: 'disruptive',
          autoResumeIfOpen: true,
          requireAck: true,
        },
      }),
    );
  });

  it('accepts absolute reminder times', async () => {
    const stateRoot = createTempDir('pa-web-reminder-tool-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const registeredTool = registerReminderTool();
    await registeredTool.execute(
      'tool-1',
      {
        at: '2030-03-27T09:00:00-04:00',
        prompt: 'Check the prod train.',
      },
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => '/tmp/sessions/conv-123.jsonl',
        },
      } as ExecuteContext,
    );

    const state = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
    const storedReminder = Object.values(state.resumes)[0];
    expect(storedReminder?.dueAt).toBe('2030-03-27T13:00:00.000Z');
  });

  it('requires a persisted session file', async () => {
    const registeredTool = registerReminderTool();

    await expect(
      registeredTool.execute('tool-1', { delay: '10m', prompt: 'Ping me later.' }, undefined, undefined, {
        sessionManager: {
          getSessionFile: () => undefined,
        },
      } as ExecuteContext),
    ).rejects.toThrow('Reminder requires a persisted session file.');
  });
});
