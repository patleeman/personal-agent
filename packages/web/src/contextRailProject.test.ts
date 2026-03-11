import { describe, expect, it } from 'vitest';
import {
  getPlanProgress,
  hasMeaningfulBlockers,
  normalizeProjectText,
  parseProjectListItems,
  pickAttachProjectId,
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

  it('normalizes project text for UI display', () => {
    expect(normalizeProjectText('- See [plan.md](./plan.md) and `ship` this.')).toBe('See plan.md and ship this.');
  });

  it('detects whether blockers are meaningful', () => {
    expect(hasMeaningfulBlockers('- waiting on review')).toBe(true);
    expect(hasMeaningfulBlockers('None')).toBe(false);
    expect(hasMeaningfulBlockers(undefined)).toBe(false);
  });

  it('parses markdown bullet lists into plain text items', () => {
    expect(parseProjectListItems('- first item\n- [linked](./plan.md) `task`\n- None')).toEqual([
      'first item',
      'linked task',
    ]);
    expect(parseProjectListItems(undefined)).toEqual([]);
  });

  it('prefers the plan summary for project previews and falls back to blockers', () => {
    expect(summarizeProjectPreview('- Finish durable activity ranking', '- waiting on API')).toBe('Finish durable activity ranking');
    expect(summarizeProjectPreview('- See [plan.md](./plan.md).', '- waiting on API')).toBe('See plan.md.');
    expect(summarizeProjectPreview('', '- waiting on API')).toBe('Blocked: waiting on API');
    expect(summarizeProjectPreview(undefined, 'None')).toBe('No plan summary yet.');
  });

  it('computes plan progress counts and percentage', () => {
    expect(getPlanProgress([
      { text: 'one', completed: true },
      { text: 'two', completed: false },
      { text: 'three', completed: true },
    ])).toEqual({ done: 2, total: 3, pct: 67 });

    expect(getPlanProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
});
