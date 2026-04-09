import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTaskCallbackBinding } from '@personal-agent/core';
import { closeAutomationDbs, saveAutomationRuntimeStateMap } from '@personal-agent/daemon';
import * as daemon from '@personal-agent/daemon';
import * as daemonToolUtils from '../automation/daemonToolUtils.js';
import { loadScheduledTasksForProfile } from '../automation/scheduledTasks.js';
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

function createToolContext(sessionFile = '') {
  return {
    sessionManager: {
      getSessionFile: () => sessionFile,
    },
  };
}

function writeSessionFile(conversationId: string): string {
  const dir = createTempDir('pa-web-task-session-');
  const sessionFile = join(dir, `${conversationId}.jsonl`);
  writeFileSync(
    sessionFile,
    JSON.stringify({ type: 'session', id: conversationId, timestamp: '2026-04-10T09:00:00.000Z', cwd: '/tmp/workspace' }) + '\n',
    'utf-8',
  );
  return sessionFile;
}

beforeEach(() => {
  process.env = { ...originalEnv, PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-web-task-state-') };
});

afterEach(async () => {
  vi.restoreAllMocks();
  closeAutomationDbs();
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

    expect(saved.details?.filePath).toBe('/__automations__/daily-status.automation.md');

    const fetched = await taskTool.execute('tool-2', {
      action: 'get',
      taskId: 'daily-status',
    });

    expect(fetched.isError).not.toBe(true);
    expect(fetched.content[0]?.text).toContain('Task @daily-status');
    expect(fetched.content[0]?.text).toContain('Summarize yesterday and plan today.');
  });

  it('saves callback-enabled tasks and clears callback bindings on update', async () => {
    const taskTool = registerScheduledTaskTool();
    const sessionFile = writeSessionFile('conv-123');

    const saved = await taskTool.execute(
      'tool-1',
      {
        action: 'save',
        taskId: 'inbox-digest',
        at: '2026-04-10T09:00:00.000Z',
        model: 'openai-codex/gpt-5.4',
        cwd: '/tmp/workspace',
        timeoutSeconds: 45,
        prompt: 'Summarize the inbox.',
        deliverResultToConversation: true,
        notifyOnSuccess: false,
        notifyOnFailure: true,
        requireAck: false,
        autoResumeIfOpen: false,
      },
      undefined,
      undefined,
      createToolContext(sessionFile),
    );

    expect(saved.isError).not.toBe(true);
    expect(getTaskCallbackBinding({ profile: 'assistant', taskId: 'inbox-digest' })).toEqual(expect.objectContaining({
      conversationId: 'conv-123',
      deliverOnSuccess: false,
      deliverOnFailure: true,
      requireAck: false,
      autoResumeIfOpen: false,
    }));

    const fetched = await taskTool.execute('tool-2', {
      action: 'get',
      taskId: 'inbox-digest',
    });

    expect(fetched.content[0]?.text).toContain('schedule: at 2026-04-10T09:00:00.000Z');
    expect(fetched.content[0]?.text).toContain('model: openai-codex/gpt-5.4');
    expect(fetched.content[0]?.text).toContain('cwd: /tmp/workspace');
    expect(fetched.content[0]?.text).toContain('callbackConversationId: conv-123');
    expect(fetched.content[0]?.text).toContain('callbackOnSuccess: none');
    expect(fetched.content[0]?.text).toContain('callbackOnFailure: disruptive');

    const updated = await taskTool.execute('tool-3', {
      action: 'save',
      taskId: 'inbox-digest',
      prompt: 'Summarize the inbox again.',
      deliverResultToConversation: false,
    });

    expect(updated.content[0]?.text).toContain('Updated scheduled task @inbox-digest');
    expect(getTaskCallbackBinding({ profile: 'assistant', taskId: 'inbox-digest' })).toBeUndefined();
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

  it('surfaces parse errors when no valid tasks exist', async () => {
    const taskTool = registerScheduledTaskTool();
    const { taskDir } = loadScheduledTasksForProfile('assistant');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'broken.task.md'), 'not a valid task', 'utf-8');

    const listed = await taskTool.execute('tool-1', { action: 'list' });
    const validated = await taskTool.execute('tool-2', { action: 'validate', taskId: 'broken' });

    expect(listed.isError).not.toBe(true);
    expect(listed.content[0]?.text).toContain('No valid tasks found.');
    expect(listed.content[0]?.text).toContain('broken.task.md');
    expect(validated.isError).toBe(true);
    expect(validated.content[0]?.text).toContain('Task @broken is invalid:');
  });

  it('shows runtime details, validates a specific task, runs it, and deletes it', async () => {
    const taskTool = registerScheduledTaskTool();

    await taskTool.execute('tool-1', {
      action: 'save',
      taskId: 'daily-status',
      cron: '0 9 * * 1-5',
      prompt: 'Summarize yesterday and plan today.',
    });

    saveAutomationRuntimeStateMap({
      'daily-status': {
        id: 'daily-status',
        filePath: '/__automations__/daily-status.automation.md',
        scheduleType: 'cron',
        running: true,
        lastStatus: 'failed',
        lastRunAt: '2026-04-10T00:00:00.000Z',
        lastLogPath: '/tmp/run.log',
      } as never,
    });

    const { taskDir } = loadScheduledTasksForProfile('assistant');
    mkdirSync(taskDir, { recursive: true });
    writeFileSync(join(taskDir, 'broken.task.md'), 'not a valid task', 'utf-8');

    const listed = await taskTool.execute('tool-2', { action: 'list' });
    const fetched = await taskTool.execute('tool-3', { action: 'get', taskId: 'daily-status' });
    const validated = await taskTool.execute('tool-4', { action: 'validate', taskId: 'daily-status' });

    expect(listed.content[0]?.text).toContain('@daily-status [running]');
    expect(listed.content[0]?.text).toContain('Parse errors:');
    expect(fetched.content[0]?.text).toContain('lastStatus: failed');
    expect(fetched.content[0]?.text).toContain('lastRunAt: 2026-04-10T00:00:00.000Z');
    expect(fetched.content[0]?.text).toContain('lastLogPath: /tmp/run.log');
    expect(validated.isError).not.toBe(true);
    expect(validated.content[0]?.text).toContain('Task @daily-status is valid.');

    vi.spyOn(daemonToolUtils, 'ensureDaemonAvailable').mockResolvedValue(undefined);
    const startScheduledTaskRunSpy = vi.spyOn(daemon, 'startScheduledTaskRun').mockResolvedValue({
      accepted: true,
      runId: 'run-task-123',
    } as never);

    const started = await taskTool.execute('tool-5', { action: 'run', taskId: 'daily-status' });
    const deleted = await taskTool.execute('tool-6', { action: 'delete', taskId: 'daily-status' });

    expect(startScheduledTaskRunSpy).toHaveBeenCalledWith('daily-status');
    expect(started.content[0]?.text).toContain('Started scheduled task @daily-status as run run-task-123.');
    expect(deleted.content[0]?.text).toContain('Deleted scheduled task @daily-status.');
  });

  it('returns tool errors for missing conversations, unknown tasks, and rejected runs', async () => {
    const taskTool = registerScheduledTaskTool();

    const missingConversation = await taskTool.execute(
      'tool-1',
      {
        action: 'save',
        taskId: 'notify-me',
        cron: '0 9 * * 1-5',
        prompt: 'Ping me.',
        deliverResultToConversation: true,
      },
      undefined,
      undefined,
      createToolContext(''),
    );
    const missingTask = await taskTool.execute('tool-2', { action: 'validate', taskId: 'missing-task' });

    await taskTool.execute('tool-3', {
      action: 'save',
      taskId: 'run-me',
      cron: '0 9 * * 1-5',
      prompt: 'Run me.',
    });

    vi.spyOn(daemonToolUtils, 'ensureDaemonAvailable').mockResolvedValue(undefined);
    vi.spyOn(daemon, 'startScheduledTaskRun').mockResolvedValue({
      accepted: false,
      reason: 'daemon busy',
    } as never);

    const rejectedRun = await taskTool.execute('tool-4', { action: 'run', taskId: 'run-me' });

    expect(missingConversation.isError).toBe(true);
    expect(missingConversation.content[0]?.text).toContain('deliverResultToConversation requires an active persisted conversation.');
    expect(missingTask.isError).toBe(true);
    expect(missingTask.content[0]?.text).toContain('Task not found: missing-task');
    expect(rejectedRun.isError).toBe(true);
    expect(rejectedRun.content[0]?.text).toContain('daemon busy');
  });
});
