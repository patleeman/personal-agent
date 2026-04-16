import { describe, expect, it } from 'vitest';
import { buildDeferredResumeAutoResumeKey } from './deferredResumeAutoResume';
import type { DeferredResumeSummary } from '../types';

function scheduled(id: string): DeferredResumeSummary {
  return {
    id,
    sessionFile: '/tmp/sessions/conv-123.jsonl',
    prompt: 'check back in',
    dueAt: '2026-03-12T13:10:00.000Z',
    createdAt: '2026-03-12T13:00:00.000Z',
    attempts: 0,
    status: 'scheduled',
  };
}

function ready(id: string): DeferredResumeSummary {
  return {
    ...scheduled(id),
    status: 'ready',
    readyAt: '2026-03-12T13:10:00.000Z',
  };
}

describe('buildDeferredResumeAutoResumeKey', () => {
  it('returns null for live sessions', () => {
    expect(buildDeferredResumeAutoResumeKey({
      resumes: [ready('resume-1')],
      isLiveSession: true,
      sessionFile: '/tmp/sessions/conv-123.jsonl',
    })).toBeNull();
  });

  it('returns null when the saved session file is unavailable', () => {
    expect(buildDeferredResumeAutoResumeKey({
      resumes: [ready('resume-1')],
      isLiveSession: false,
      sessionFile: '',
    })).toBeNull();
  });

  it('returns null when nothing is ready yet', () => {
    expect(buildDeferredResumeAutoResumeKey({
      resumes: [scheduled('resume-1')],
      isLiveSession: false,
      sessionFile: '/tmp/sessions/conv-123.jsonl',
    })).toBeNull();
  });

  it('builds a stable key from the ready resume ids', () => {
    expect(buildDeferredResumeAutoResumeKey({
      resumes: [scheduled('resume-3'), ready('resume-2'), ready('resume-1')],
      isLiveSession: false,
      sessionFile: '/tmp/sessions/conv-123.jsonl',
    })).toBe('/tmp/sessions/conv-123.jsonl::resume-1,resume-2');
  });
});
