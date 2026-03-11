import { describe, expect, it } from 'vitest';
import {
  formatProjectStatus,
  getPlanProgress,
  hasMeaningfulBlockers,
  pickAttachProjectId,
  pickCurrentMilestone,
  pickFocusedProjectId,
  summarizeProjectPreview,
} from './contextRailProject.js';

describe('context rail project helpers', () => {
  it('keeps the current focused project when it is still linked', () => {
    expect(pickFocusedProjectId(['web-ui', 'artifact-model'], 'artifact-model')).toBe('artifact-model');
  });

  it('falls back to the first linked project when the focused one disappears', () => {
    expect(pickFocusedProjectId(['web-ui', 'artifact-model'], 'missing')).toBe('web-ui');
    expect(pickFocusedProjectId([], 'missing')).toBe('');
  });

  it('keeps the current attach selection when still available', () => {
    expect(pickAttachProjectId(['web-ui', 'artifact-model'], 'artifact-model')).toBe('artifact-model');
  });

  it('falls back to the first available attach option when needed', () => {
    expect(pickAttachProjectId(['web-ui', 'artifact-model'], 'missing')).toBe('web-ui');
    expect(pickAttachProjectId([], 'missing')).toBe('');
  });

  it('formats project status labels for UI display', () => {
    expect(formatProjectStatus('in_progress')).toBe('in progress');
    expect(formatProjectStatus('blocked')).toBe('blocked');
    expect(formatProjectStatus(undefined)).toBe('unknown');
  });

  it('detects whether blockers are meaningful', () => {
    expect(hasMeaningfulBlockers(['waiting on review'])).toBe(true);
    expect(hasMeaningfulBlockers([])).toBe(false);
    expect(hasMeaningfulBlockers(undefined)).toBe(false);
  });

  it('picks the current milestone from the explicit plan pointer first', () => {
    expect(pickCurrentMilestone({
      currentMilestoneId: 'execute-work',
      milestones: [
        { id: 'refine-plan', title: 'Refine the plan', status: 'completed' },
        { id: 'execute-work', title: 'Execute the work', status: 'pending' },
      ],
    })).toEqual({ id: 'execute-work', title: 'Execute the work', status: 'pending' });
  });

  it('falls back to the active or next incomplete milestone when needed', () => {
    expect(pickCurrentMilestone({
      milestones: [
        { id: 'refine-plan', title: 'Refine the plan', status: 'completed' },
        { id: 'execute-work', title: 'Execute the work', status: 'blocked' },
      ],
    }))?.toEqual({ id: 'execute-work', title: 'Execute the work', status: 'blocked' });

    expect(pickCurrentMilestone({
      milestones: [
        { id: 'refine-plan', title: 'Refine the plan', status: 'completed' },
        { id: 'verify-result', title: 'Verify the result', status: 'pending' },
      ],
    }))?.toEqual({ id: 'verify-result', title: 'Verify the result', status: 'pending' });
  });

  it('prefers the current focus for project previews and falls back to summary', () => {
    expect(summarizeProjectPreview({
      currentFocus: 'Unify the right rail around one coherent project view.',
      summary: 'The project is in progress.',
      blockers: [],
    })).toBe('Unify the right rail around one coherent project view.');

    expect(summarizeProjectPreview({
      summary: 'The project is in progress.',
      blockers: ['waiting on API'],
    })).toBe('The project is in progress.');
  });

  it('computes milestone progress counts and percentage', () => {
    expect(getPlanProgress([
      { id: 'one', title: 'One', status: 'completed' },
      { id: 'two', title: 'Two', status: 'pending' },
      { id: 'three', title: 'Three', status: 'completed' },
    ])).toEqual({ done: 2, total: 3, pct: 67 });

    expect(getPlanProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});
