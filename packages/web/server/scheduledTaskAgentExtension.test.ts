import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScheduledTaskAgentExtension } from './scheduledTaskAgentExtension.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function registerScheduledTaskTool() {
  let registeredTool:
    | { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> }
    | undefined;

  createScheduledTaskAgentExtension({
    getCurrentProfile: () => 'assistant',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as { execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }> };
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Scheduled task tool was not registered.');
  }

  return registeredTool;
}

beforeEach(() => {
  process.env = { ...originalEnv, PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-web-task-state-') };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('scheduled task agent extension', () => {
  it('saves and retrieves scheduled task definitions', async () => {
    const taskTool = registerScheduledTaskTool();

    const saved = await taskTool.execute('tool-1', {
      action: 'save',
      taskId: 'daily-status',
      cron: '0 9 * * 1-5',
      model: 'openai-codex/gpt-5.4',
      prompt: 'Summarize yesterday and plan today.',
    });

    expect(saved.isError).not.toBe(true);
    expect(saved.content[0]?.text).toContain('Saved scheduled task @daily-status');

    const filePath = join(process.env.PERSONAL_AGENT_STATE_ROOT!, 'sync', 'tasks', 'daily-status.task.md');
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toContain('cron: "0 9 * * 1-5"');

    const fetched = await taskTool.execute('tool-2', {
      action: 'get',
      taskId: 'daily-status',
    });

    expect(fetched.isError).not.toBe(true);
    expect(fetched.content[0]?.text).toContain('Task @daily-status');
    expect(fetched.content[0]?.text).toContain('Summarize yesterday and plan today.');
  });

  it('lists and validates scheduled task definitions', async () => {
    const taskTool = registerScheduledTaskTool();

    await taskTool.execute('tool-1', {
      action: 'save',
      taskId: 'daily-status',
      cron: '0 9 * * 1-5',
      prompt: 'Summarize yesterday and plan today.',
    });

    const listed = await taskTool.execute('tool-2', { action: 'list' });
    expect(listed.isError).not.toBe(true);
    expect(listed.content[0]?.text).toContain('@daily-status');

    const validated = await taskTool.execute('tool-3', { action: 'validate' });
    expect(validated.isError).not.toBe(true);
    expect(validated.content[0]?.text).toContain('Validated 1 scheduled task');
  });
});
