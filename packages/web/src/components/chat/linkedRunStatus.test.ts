import { describe, expect, it } from 'vitest';
import { describeInlineRunStatus, inferStatusFromLinkedRunDetail } from './linkedRunStatus.js';

describe('linkedRunStatus', () => {
  it('infers known statuses from linked run detail prefix', () => {
    expect(inferStatusFromLinkedRunDetail('running · background run')).toBe('running');
    expect(inferStatusFromLinkedRunDetail('FAILED · agent run')).toBe('failed');
    expect(inferStatusFromLinkedRunDetail('background run')).toBeUndefined();
  });

  it('maps statuses to inline display tones', () => {
    expect(describeInlineRunStatus('running')).toEqual({ text: 'running', tone: 'accent' });
    expect(describeInlineRunStatus('recovering')).toEqual({ text: 'recovering', tone: 'warning' });
    expect(describeInlineRunStatus('completed')).toEqual({ text: 'completed', tone: 'success' });
    expect(describeInlineRunStatus('failed')).toEqual({ text: 'failed', tone: 'danger' });
    expect(describeInlineRunStatus(undefined)).toEqual({ text: 'linked', tone: 'muted' });
  });
});
