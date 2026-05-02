import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEmptyTaskState,
  loadTaskState,
  saveTaskState,
  type TaskStateFile,
} from './tasks-store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('tasks-store', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates an empty state shape', () => {
    expect(createEmptyTaskState()).toEqual({
      version: 1,
      tasks: {},
    });
  });

  it('returns empty state when file does not exist', () => {
    const path = join(createTempDir('tasks-store-missing-'), 'task-state.json');

    expect(loadTaskState(path)).toEqual({
      version: 1,
      tasks: {},
    });
  });

  it('returns empty state and warns when JSON parsing fails', () => {
    const dir = createTempDir('tasks-store-invalid-json-');
    const path = join(dir, 'task-state.json');
    writeFileSync(path, '{not valid json');

    const warn = vi.fn();
    const loaded = loadTaskState(path, { warn });

    expect(loaded).toEqual({
      version: 1,
      tasks: {},
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('tasks state load failed');
  });

  it('sanitizes loaded task records and clears stale running flags', () => {
    const dir = createTempDir('tasks-store-load-');
    const path = join(dir, 'task-state.json');

    writeFileSync(path, JSON.stringify({
      version: 1,
      tasks: {
        valid: {
          id: 'valid',
          filePath: '/tmp/valid.task.md',
          scheduleType: 'at',
          running: true,
          runningStartedAt: '2026-03-01T00:00:00.000Z',
          activeRunId: 'run-active',
          lastRunId: 'run-last',
          lastStatus: 'success',
          lastRunAt: '2026-03-01T00:00:00.000Z',
          lastAttemptCount: 2,
          oneTimeResolvedStatus: 'failed',
          oneTimeResolvedAt: '2026-03-01T00:00:00.000Z',
          oneTimeCompletedAt: '2026-03-01T00:10:00.000Z',
        },
        malformedMissingId: {
          filePath: '/tmp/malformed.task.md',
        },
        malformedFields: {
          id: 'malformed',
          filePath: '/tmp/malformed.task.md',
          scheduleType: 'invalid',
          running: 'yes',
          lastStatus: 'unexpected',
          lastError: '',
          lastAttemptCount: '5',
          oneTimeResolvedStatus: 'bad-value',
        },
      },
    }, null, 2));

    const loaded = loadTaskState(path);

    expect(Object.keys(loaded.tasks).sort()).toEqual(['malformedFields', 'valid']);

    expect(loaded.tasks.valid).toMatchObject({
      id: 'valid',
      filePath: '/tmp/valid.task.md',
      scheduleType: 'at',
      running: false,
      runningStartedAt: undefined,
      activeRunId: 'run-active',
      lastRunId: 'run-last',
      lastStatus: 'success',
      lastAttemptCount: 2,
      oneTimeResolvedStatus: 'failed',
    });

    expect(loaded.tasks.malformedFields).toMatchObject({
      id: 'malformed',
      filePath: '/tmp/malformed.task.md',
      scheduleType: 'cron',
      running: false,
      runningStartedAt: undefined,
      lastStatus: undefined,
      lastError: undefined,
      lastAttemptCount: undefined,
      oneTimeResolvedStatus: undefined,
    });
  });

  it('loads and normalizes the last evaluated timestamp', () => {
    const dir = createTempDir('tasks-store-last-evaluated-');
    const path = join(dir, 'task-state.json');

    writeFileSync(path, JSON.stringify({
      version: 1,
      lastEvaluatedAt: '2026-03-02T10:00:00Z',
      tasks: {},
    }, null, 2));

    expect(loadTaskState(path)).toEqual({
      version: 1,
      lastEvaluatedAt: '2026-03-02T10:00:00.000Z',
      tasks: {},
    });
  });

  it('saves state files and creates parent directories', () => {
    const dir = createTempDir('tasks-store-save-');
    const path = join(dir, 'nested', 'state', 'task-state.json');

    const state: TaskStateFile = {
      version: 1,
      tasks: {
        daily: {
          id: 'daily',
          filePath: '/tmp/daily.task.md',
          scheduleType: 'cron',
          running: false,
          lastStatus: 'success',
        },
      },
    };

    saveTaskState(path, state);

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(state);
  });

  it('returns empty state for structurally invalid files', () => {
    const dir = createTempDir('tasks-store-invalid-structure-');
    const path = join(dir, 'task-state.json');

    writeFileSync(path, JSON.stringify({ version: 1, tasks: 'not-an-object' }));

    expect(loadTaskState(path)).toEqual({
      version: 1,
      tasks: {},
    });
  });
});
