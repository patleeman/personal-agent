import { describe, expect, it } from 'vitest';
import {
  buildDeferredResumeIndicatorText,
  compareDeferredResumes,
  describeDeferredResumeStatus,
  formatDeferredResumeWhen,
  resolveDeferredResumePresentationState,
} from './deferredResumeIndicator';
import type { DeferredResumeSummary } from '../shared/types';

function scheduled(id: string, dueAt: string): DeferredResumeSummary {
  return {
    id,
    sessionFile: `/tmp/${id}.jsonl`,
    prompt: `resume ${id}`,
    dueAt,
    createdAt: '2026-03-12T13:00:00.000Z',
    attempts: 0,
    status: 'scheduled',
  };
}

function ready(id: string, readyAt: string): DeferredResumeSummary {
  return {
    id,
    sessionFile: `/tmp/${id}.jsonl`,
    prompt: `resume ${id}`,
    dueAt: '2026-03-12T13:00:00.000Z',
    createdAt: '2026-03-12T12:00:00.000Z',
    attempts: 0,
    status: 'ready',
    readyAt,
  };
}

describe('deferredResumeIndicator', () => {
  it('describes scheduled resume timing compactly', () => {
    expect(describeDeferredResumeStatus(
      scheduled('one', '2026-03-12T13:08:30.000Z'),
      Date.parse('2026-03-12T13:00:00.000Z'),
    )).toBe('in 8m 30s');
  });

  it('does not render absurd resume timing for unsafe clocks', () => {
    expect(describeDeferredResumeStatus(
      scheduled('one', '2026-03-12T13:08:30.000Z'),
      -Number.MAX_SAFE_INTEGER - 1,
    )).toBe('due now');
  });

  it('treats ready resumes as ready now', () => {
    expect(describeDeferredResumeStatus(
      ready('one', '2026-03-12T13:00:00.000Z'),
      Date.parse('2026-03-12T13:05:00.000Z'),
    )).toBe('ready now');
  });

  it('sorts resumes by effective target time', () => {
    const resumes = [
      scheduled('later', '2026-03-12T13:20:00.000Z'),
      ready('ready', '2026-03-12T13:01:00.000Z'),
      scheduled('soon', '2026-03-12T13:05:00.000Z'),
    ];

    expect([...resumes].sort(compareDeferredResumes).map((resume) => resume.id)).toEqual([
      'ready',
      'soon',
      'later',
    ]);
  });

  it('sorts malformed resume timestamps after valid targets', () => {
    const resumes = [
      scheduled('bad', 'not-a-date'),
      scheduled('soon', '2026-03-12T13:05:00.000Z'),
    ];

    expect([...resumes].sort(compareDeferredResumes).map((resume) => resume.id)).toEqual([
      'soon',
      'bad',
    ]);
  });

  it('builds a compact indicator for scheduled resumes', () => {
    expect(buildDeferredResumeIndicatorText([
      scheduled('one', '2026-03-12T13:08:00.000Z'),
      scheduled('two', '2026-03-12T13:30:00.000Z'),
    ], Date.parse('2026-03-12T13:00:00.000Z'))).toBe('2 scheduled · next in 8m 0s');
  });

  it('builds a compact indicator when ready resumes exist', () => {
    expect(buildDeferredResumeIndicatorText([
      ready('one', '2026-03-12T13:01:00.000Z'),
      scheduled('two', '2026-03-12T13:08:00.000Z'),
      ready('three', '2026-03-12T13:02:00.000Z'),
    ], Date.parse('2026-03-12T13:03:00.000Z'))).toBe('2 ready now · 1 scheduled');
  });

  it('resolves ordered presentation state and auto-resume key together', () => {
    const state = resolveDeferredResumePresentationState({
      resumes: [
        scheduled('later', '2026-03-12T13:30:00.000Z'),
        ready('ready', '2026-03-12T13:01:00.000Z'),
      ],
      nowMs: Date.parse('2026-03-12T13:03:00.000Z'),
      isLiveSession: false,
      sessionFile: '/tmp/session.jsonl',
    });

    expect(state.orderedResumes.map((resume) => resume.id)).toEqual(['ready', 'later']);
    expect(state.hasReadyResumes).toBe(true);
    expect(state.autoResumeKey).toBe('/tmp/session.jsonl::ready');
    expect(state.indicatorText).toBe('1 ready now · 1 scheduled');
  });

  it('formats the visible due/ready timestamp for deferred resumes', () => {
    expect(formatDeferredResumeWhen(scheduled('one', '2026-03-12T13:08:00.000Z'))).toContain('Mar');
    expect(formatDeferredResumeWhen(ready('one', '2026-03-12T13:01:00.000Z'))).toContain('Mar');
    expect(formatDeferredResumeWhen(scheduled('bad', 'not-a-date'))).toBe('not-a-date');
  });
});
