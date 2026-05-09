import { describe, expect, it } from 'vitest';

import { describeInlineRunStatus, inferStatusFromLinkedRunDetail } from './linkedRunStatus.js';

describe('linkedRunStatus', () => {
  it('infers known statuses from linked run detail prefix', () => {
    expect(inferStatusFromLinkedRunDetail('running · agent task')).toBe('running');
    expect(inferStatusFromLinkedRunDetail('FAILED · shell command')).toBe('failed');
    expect(inferStatusFromLinkedRunDetail('agent task')).toBeUndefined();
  });

  it('maps statuses to inline display tones', () => {
    expect(describeInlineRunStatus('running')).toEqual({ text: 'running', tone: 'accent' });
    expect(describeInlineRunStatus('recovering')).toEqual({ text: 'recovering', tone: 'warning' });
    expect(describeInlineRunStatus('completed')).toEqual({ text: 'completed', tone: 'success' });
    expect(describeInlineRunStatus('failed')).toEqual({ text: 'failed', tone: 'danger' });
    expect(describeInlineRunStatus(undefined)).toEqual({ text: 'linked', tone: 'muted' });
  });

  it('falls back to linked for malformed runtime statuses', () => {
    expect(describeInlineRunStatus({ status: 'completed' })).toEqual({ text: 'linked', tone: 'muted' });
    expect(inferStatusFromLinkedRunDetail({ detail: 'running' } as never)).toBeUndefined();
  });
});
