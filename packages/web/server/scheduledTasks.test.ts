import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inferTaskProfileFromFilePath,
  readScheduledTaskFileMetadata,
  taskBelongsToProfile,
} from './scheduledTasks.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-scheduled-tasks-'));
  tempDirs.push(dir);
  return dir;
}

describe('scheduledTasks', () => {
  it('infers the profile from repo-managed task paths', () => {
    expect(inferTaskProfileFromFilePath('/repo/profiles/datadog/agent/tasks/daily.task.md')).toBe('datadog');
    expect(inferTaskProfileFromFilePath('/repo/custom/daily.task.md')).toBeUndefined();
  });

  it('reads simple scheduled-task metadata from the file', () => {
    const dir = createTempDir();
    const filePath = join(dir, 'demo.task.md');

    writeFileSync(filePath, `---\nenabled: false\ncron: "0 9 * * *"\nprofile: "assistant"\nmodel: "openai-codex/gpt-5.4"\ncwd: "~/agent-workspace"\n---\nSummarize the last run.\nInclude the top blockers.\n`);

    expect(readScheduledTaskFileMetadata(filePath)).toEqual({
      fileContent: expect.any(String),
      enabled: false,
      cron: '0 9 * * *',
      profile: 'assistant',
      model: 'openai-codex/gpt-5.4',
      cwd: '~/agent-workspace',
      prompt: 'Summarize the last run.',
    });
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
