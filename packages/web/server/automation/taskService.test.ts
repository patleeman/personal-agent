import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resolveScheduledTaskForProfileMock } = vi.hoisted(() => ({
  resolveScheduledTaskForProfileMock: vi.fn(),
}));

vi.mock('./scheduledTasks.js', () => ({
  resolveScheduledTaskForProfile: resolveScheduledTaskForProfileMock,
}));

import { findTaskForProfile, readRequiredTaskId } from './taskService.js';

describe('taskService', () => {
  beforeEach(() => {
    resolveScheduledTaskForProfileMock.mockReset();
  });

  describe('readRequiredTaskId', () => {
    it('returns a trimmed task id', () => {
      expect(readRequiredTaskId('  nightly-report  ')).toBe('nightly-report');
    });

    it('rejects missing task ids', () => {
      expect(() => readRequiredTaskId('   ')).toThrow('taskId is required.');
      expect(() => readRequiredTaskId(undefined)).toThrow('taskId is required.');
    });

    it('rejects invalid task id characters', () => {
      expect(() => readRequiredTaskId('bad/id')).toThrow('taskId must use only letters, numbers, hyphens, or underscores.');
    });
  });

  describe('findTaskForProfile', () => {
    it('returns the resolved task when present', () => {
      const resolvedTask = { task: { id: 'nightly-report' } };
      resolveScheduledTaskForProfileMock.mockReturnValue(resolvedTask);

      expect(findTaskForProfile('assistant', 'nightly-report')).toBe(resolvedTask);
      expect(resolveScheduledTaskForProfileMock).toHaveBeenCalledWith('assistant', 'nightly-report');
    });

    it('returns undefined when the task is missing', () => {
      resolveScheduledTaskForProfileMock.mockImplementation(() => {
        throw new Error('Task not found: nightly-report');
      });

      expect(findTaskForProfile('assistant', 'nightly-report')).toBeUndefined();
    });

    it('rethrows unexpected lookup failures', () => {
      resolveScheduledTaskForProfileMock.mockImplementation(() => {
        throw new Error('database unavailable');
      });

      expect(() => findTaskForProfile('assistant', 'nightly-report')).toThrow('database unavailable');
    });
  });
});
