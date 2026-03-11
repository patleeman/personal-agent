import { describe, expect, it } from 'vitest';
import {
  getPlanProgress,
  hasMeaningfulBlockers,
  normalizeWorkstreamText,
  pickAttachWorkstreamId,
  pickFocusedWorkstreamId,
  summarizeWorkstreamPreview,
} from './contextRailWorkstream.js';

describe('context rail workstream helpers', () => {
  it('keeps the current focused workstream when it is still linked', () => {
    expect(pickFocusedWorkstreamId(['web-ui', 'artifact-model'], 'artifact-model')).toBe('artifact-model');
  });

  it('falls back to the first linked workstream when the focused one disappears', () => {
    expect(pickFocusedWorkstreamId(['web-ui', 'artifact-model'], 'missing')).toBe('web-ui');
    expect(pickFocusedWorkstreamId([], 'missing')).toBe('');
  });

  it('keeps the current attach selection when still available', () => {
    expect(pickAttachWorkstreamId(['web-ui', 'artifact-model'], 'artifact-model')).toBe('artifact-model');
  });

  it('falls back to the first available attach option when needed', () => {
    expect(pickAttachWorkstreamId(['web-ui', 'artifact-model'], 'missing')).toBe('web-ui');
    expect(pickAttachWorkstreamId([], 'missing')).toBe('');
  });

  it('normalizes workstream text for UI display', () => {
    expect(normalizeWorkstreamText('- See [plan.md](./plan.md) and `ship` this.')).toBe('See plan.md and ship this.');
  });

  it('detects whether blockers are meaningful', () => {
    expect(hasMeaningfulBlockers('- waiting on review')).toBe(true);
    expect(hasMeaningfulBlockers('None')).toBe(false);
    expect(hasMeaningfulBlockers(undefined)).toBe(false);
  });

  it('prefers the plan summary for workstream previews and falls back to blockers', () => {
    expect(summarizeWorkstreamPreview('- Finish durable activity ranking', '- waiting on API')).toBe('Finish durable activity ranking');
    expect(summarizeWorkstreamPreview('- See [plan.md](./plan.md).', '- waiting on API')).toBe('See plan.md.');
    expect(summarizeWorkstreamPreview('', '- waiting on API')).toBe('Blocked: waiting on API');
    expect(summarizeWorkstreamPreview(undefined, 'None')).toBe('No plan summary yet.');
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
