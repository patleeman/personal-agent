import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDeferredResumeState } from '@personal-agent/core';
import { createConversationSelfDistillAgentExtension } from './conversationSelfDistillAgentExtension.js';

const tempDirs: string[] = [];
const originalEnv = process.env;
type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0];
type ExecuteContext = Parameters<NonNullable<RegisteredTool['execute']>>[4];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeSessionFile(path: string, conversationId: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ type: 'session', id: conversationId, timestamp: '2026-03-28T10:00:00.000Z', cwd: '/tmp/workspace' })}\n`, 'utf-8');
}

function registerSelfDistillTool() {
  let registeredTool: RegisteredTool | undefined;
  createConversationSelfDistillAgentExtension({
    getCurrentProfile: () => 'assistant',
  })({
    registerTool: (tool: RegisteredTool) => {
      registeredTool = tool;
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Self-distill tool was not registered.');
  }

  return registeredTool;
}

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterEach(async () => {
  process.env = originalEnv;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('conversation self-distill agent extension', () => {
  it('registers conservative guidance', () => {
    const registeredTool = registerSelfDistillTool();
    const guidelines = registeredTool.promptGuidelines?.join('\n') ?? '';

    expect(guidelines).toContain('High bar');
    expect(guidelines).toContain('no-op');
    expect(guidelines).toContain('AGENTS.md edits or skill mutation');
    expect(guidelines).toContain('deduped');
  });

  it('schedules and dedupes a self-distill wakeup for the current session', async () => {
    const stateRoot = createTempDir('pa-web-self-distill-tool-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const sessionFile = join(stateRoot, 'sessions', 'conv-123.jsonl');
    writeSessionFile(sessionFile, 'conv-123');
    const registeredTool = registerSelfDistillTool();

    const first = await registeredTool.execute(
      'tool-1',
      { delay: '10m' },
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => sessionFile,
          getSessionId: () => 'conv-123',
        },
      } as ExecuteContext,
    );
    const second = await registeredTool.execute(
      'tool-2',
      { delay: '10m' },
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => sessionFile,
          getSessionId: () => 'conv-123',
        },
      } as ExecuteContext,
    );

    const firstText = first.content[0] && 'text' in first.content[0] ? first.content[0].text : '';
    const secondText = second.content[0] && 'text' in second.content[0] ? second.content[0].text : '';
    expect(firstText).toContain('Scheduled self-distill wakeup');
    expect(secondText).toContain('already scheduled');
    expect(first.details).toEqual(expect.objectContaining({
      mode: 'web',
      sessionFile,
      deduped: false,
    }));
    expect(second.details).toEqual(expect.objectContaining({
      mode: 'web',
      sessionFile,
      deduped: true,
    }));

    const resumes = Object.values(loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json')).resumes);
    expect(resumes).toHaveLength(1);
  });

  it('requires a persisted session file', async () => {
    const registeredTool = registerSelfDistillTool();

    await expect(registeredTool.execute(
      'tool-1',
      {},
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => undefined,
        },
      } as ExecuteContext,
    )).rejects.toThrow('Self-distill wakeup requires a persisted session file.');
  });
});
