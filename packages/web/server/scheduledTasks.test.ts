import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildScheduledTaskMarkdown,
  inferTaskProfileFromFilePath,
  loadScheduledTasksForProfile,
  readScheduledTaskFileMetadata,
  resolveScheduledTaskForProfile,
  taskBelongsToProfile,
  taskDirForProfile,
} from './scheduledTasks.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv, PERSONAL_AGENT_STATE_ROOT: createTempDir('pa-web-scheduled-tasks-state-') };
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(prefix = 'pa-web-scheduled-tasks-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('scheduledTasks', () => {
  it('infers the profile from repo-managed task paths', () => {
    expect(inferTaskProfileFromFilePath('/repo/profiles/datadog/agent/tasks/daily.task.md')).toBe('datadog');
    expect(inferTaskProfileFromFilePath('/repo/custom/daily.task.md')).toBeUndefined();
  });

  it('reads canonical scheduled-task metadata from the file', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'demo.task.md');

    writeFileSync(filePath, `---\nenabled: false\ncron: "0 9 * * *"\nprofile: "assistant"\nmodel: "openai-codex/gpt-5.4"\ncwd: "~/agent-workspace"\n---\nSummarize the last run.\nInclude the top blockers.\n`);

    expect(readScheduledTaskFileMetadata(filePath)).toEqual({
      id: 'demo',
      fileContent: expect.any(String),
      enabled: false,
      scheduleType: 'cron',
      cron: '0 9 * * *',
      at: undefined,
      profile: 'assistant',
      model: 'openai-codex/gpt-5.4',
      cwd: expect.stringContaining('agent-workspace'),
      timeoutSeconds: 1800,
      prompt: 'Summarize the last run.',
      promptBody: 'Summarize the last run.\nInclude the top blockers.',
    });
  });

  it('builds canonical task markdown for recurring tasks', () => {
    expect(buildScheduledTaskMarkdown({
      taskId: 'daily-status',
      profile: 'assistant',
      enabled: true,
      cron: '11 */4 * * *',
      model: 'openai-codex/gpt-5.4',
      cwd: '~/agent-workspace',
      timeoutSeconds: 900,
      prompt: 'Run maintenance.',
    })).toBe(`---\nid: "daily-status"\nenabled: true\ncron: "11 */4 * * *"\nprofile: "assistant"\nmodel: "openai-codex/gpt-5.4"\ncwd: "~/agent-workspace"\ntimeoutSeconds: 900\n---\nRun maintenance.\n`);
  });

  it('loads parsed tasks and runtime state for a profile', () => {
    const tasksDir = taskDirForProfile('assistant');
    mkdirSync(tasksDir, { recursive: true });

    const validFilePath = join(tasksDir, 'daily.task.md');
    const invalidFilePath = join(tasksDir, 'broken.task.md');
    writeFileSync(validFilePath, `---\ncron: "0 9 * * *"\nprofile: "assistant"\n---\nDaily task\n`);
    writeFileSync(invalidFilePath, `---\ncron: "0 9 * *"\n---\nBroken task\n`);

    const daemonDir = join(process.env.PERSONAL_AGENT_STATE_ROOT!, 'daemon');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(join(daemonDir, 'task-state.json'), JSON.stringify({
      tasks: {
        [validFilePath]: {
          id: 'daily',
          filePath: validFilePath,
          running: true,
          lastStatus: 'success',
          lastAttemptCount: 2,
        },
      },
    }));

    const loaded = loadScheduledTasksForProfile('assistant');

    expect(loaded.taskDir).toBe(tasksDir);
    expect(loaded.tasks.map((task) => task.id)).toEqual(['daily']);
    expect(loaded.parseErrors).toEqual([
      expect.objectContaining({ filePath: invalidFilePath, error: expect.any(String) }),
    ]);
    expect(loaded.runtimeEntries).toEqual([
      expect.objectContaining({
        id: 'daily',
        filePath: validFilePath,
        running: true,
        lastStatus: 'success',
        lastAttemptCount: 2,
      }),
    ]);

    const resolved = resolveScheduledTaskForProfile('assistant', 'daily');
    expect(resolved.task.filePath).toBe(validFilePath);
    expect(resolved.runtime).toEqual(expect.objectContaining({ running: true, lastStatus: 'success' }));
  });

  it('filters repo-managed tasks by the current profile', () => {
    const dir = createTempDir();
    const datadogTasksDir = join(dir, 'profiles', 'datadog', 'agent', 'tasks');
    const assistantTasksDir = join(dir, 'profiles', 'assistant', 'agent', 'tasks');
    mkdirSync(datadogTasksDir, { recursive: true });
    mkdirSync(assistantTasksDir, { recursive: true });

    const datadogTaskPath = join(datadogTasksDir, 'datadog.task.md');
    const assistantTaskPath = join(assistantTasksDir, 'assistant.task.md');
    writeFileSync(datadogTaskPath, `---\ncron: "0 9 * * *"\n---\nDatadog task\n`);
    writeFileSync(assistantTaskPath, `---\ncron: "0 9 * * *"\n---\nAssistant task\n`);

    expect(taskBelongsToProfile({ filePath: datadogTaskPath }, 'datadog')).toBe(true);
    expect(taskBelongsToProfile({ filePath: assistantTaskPath }, 'datadog')).toBe(false);
  });

  it('falls back to frontmatter profile for tasks outside the repo profile tree', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'standalone.task.md');

    writeFileSync(filePath, `---\ncron: "0 9 * * *"\nprofile: "assistant"\n---\nStandalone task\n`);

    expect(taskBelongsToProfile({ filePath }, 'assistant')).toBe(true);
    expect(taskBelongsToProfile({ filePath }, 'datadog')).toBe(false);
  });
});
