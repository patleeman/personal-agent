import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { clearTaskCallbackBinding, getTaskCallbackBinding, setTaskCallbackBinding } from './task-callback-bindings.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('task callback bindings', () => {
  it('stores and retrieves bindings per profile/task id', () => {
    const stateRoot = createTempDir('pa-task-callbacks-');

    const binding = setTaskCallbackBinding({
      stateRoot,
      profile: 'datadog',
      taskId: 'watch-prod-gates',
      conversationId: 'conv-123',
      sessionFile: '/tmp/conv-123.jsonl',
      notifyOnSuccess: 'disruptive',
      notifyOnFailure: 'disruptive',
    });

    expect(binding).toEqual(
      expect.objectContaining({
        taskId: 'watch-prod-gates',
        conversationId: 'conv-123',
        deliverOnSuccess: true,
        deliverOnFailure: true,
      }),
    );
    expect(getTaskCallbackBinding({ stateRoot, profile: 'datadog', taskId: 'watch-prod-gates' })).toEqual(
      expect.objectContaining({ sessionFile: '/tmp/conv-123.jsonl' }),
    );
  });

  it('rejects invalid updatedAt timestamps when setting bindings', () => {
    const stateRoot = createTempDir('pa-task-callbacks-');

    expect(() =>
      setTaskCallbackBinding({
        stateRoot,
        profile: 'datadog',
        taskId: 'watch-prod-gates',
        conversationId: 'conv-123',
        sessionFile: '/tmp/conv-123.jsonl',
        updatedAt: 'not-a-date',
      }),
    ).toThrow('Invalid task callback updatedAt');
  });

  it('clears bindings cleanly', () => {
    const stateRoot = createTempDir('pa-task-callbacks-');

    setTaskCallbackBinding({
      stateRoot,
      profile: 'datadog',
      taskId: 'watch-prod-gates',
      conversationId: 'conv-123',
      sessionFile: '/tmp/conv-123.jsonl',
    });

    expect(clearTaskCallbackBinding({ stateRoot, profile: 'datadog', taskId: 'watch-prod-gates' })).toBe(true);
    expect(getTaskCallbackBinding({ stateRoot, profile: 'datadog', taskId: 'watch-prod-gates' })).toBeUndefined();
  });
});
