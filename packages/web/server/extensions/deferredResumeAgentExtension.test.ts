import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { loadDeferredResumeState } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferredResumeAgentExtension } from './deferredResumeAgentExtension.js';

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

function registerDeferredResumeTool() {
  let registeredTool: RegisteredTool | undefined;
  createDeferredResumeAgentExtension()({
    registerTool: (tool: RegisteredTool) => {
      registeredTool = tool;
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Deferred resume tool was not registered.');
  }

  return registeredTool;
}

describe('deferred resume agent extension', () => {
  it('registers proactive follow-up guidance', () => {
    const registeredTool = registerDeferredResumeTool();
    const guidelines = registeredTool.promptGuidelines?.join('\n') ?? '';

    expect(guidelines).toContain('check back later');
    expect(guidelines).toContain('do not need user confirmation');
    expect(guidelines).toContain('monitoring an external system again later');
  });

  it('registers deferred_resume and schedules durable state for the current session', async () => {
    const stateRoot = createTempDir('pa-web-deferred-tool-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    const registeredTool = registerDeferredResumeTool();
    const result = await registeredTool.execute(
      'tool-1',
      { delay: '10m', prompt: 'check the logs and continue', behavior: 'followUp' },
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
    expect(firstContent && 'text' in firstContent ? firstContent.text : '').toContain('Scheduled deferred resume');
    expect(result.details).toEqual(expect.objectContaining({
      mode: 'web',
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      prompt: 'check the logs and continue',
    }));

    const state = loadDeferredResumeState(join(stateRoot, 'pi-agent', 'deferred-resumes-state.json'));
    expect(Object.values(state.resumes)[0]?.behavior).toBe('followUp');
  });

  it('requires a persisted session file', async () => {
    const registeredTool = registerDeferredResumeTool();

    await expect(registeredTool.execute(
      'tool-1',
      { delay: '10m' },
      undefined,
      undefined,
      {
        sessionManager: {
          getSessionFile: () => undefined,
        },
      } as ExecuteContext,
    )).rejects.toThrow('Deferred resume requires a persisted session file.');
  });
});
