import { describe, expect, it } from 'vitest';
import { buildDeferredResumeAutoResumeKey, shouldAutoResumeDeferredResumes } from './deferredResumeAutoResume';
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

describe('shouldAutoResumeDeferredResumes', () => {
  it('allows one auto-resume attempt for a ready saved conversation', () => {
    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      lastAttemptedKey: null,
      draft: false,
      isLiveSession: false,
      deferredResumesBusy: false,
      resumeConversationBusy: false,
    })).toBe(true);
  });

  it('blocks duplicate attempts for the same ready resume set', () => {
    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      lastAttemptedKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      draft: false,
      isLiveSession: false,
      deferredResumesBusy: false,
      resumeConversationBusy: false,
    })).toBe(false);
  });

  it('stays idle while the conversation is already live, draft, or busy', () => {
    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      lastAttemptedKey: null,
      draft: true,
      isLiveSession: false,
      deferredResumesBusy: false,
      resumeConversationBusy: false,
    })).toBe(false);

    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      lastAttemptedKey: null,
      draft: false,
      isLiveSession: true,
      deferredResumesBusy: false,
      resumeConversationBusy: false,
    })).toBe(false);

    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      lastAttemptedKey: null,
      draft: false,
      isLiveSession: false,
      deferredResumesBusy: true,
      resumeConversationBusy: false,
    })).toBe(false);

    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: '/tmp/sessions/conv-123.jsonl::resume-1',
      lastAttemptedKey: null,
      draft: false,
      isLiveSession: false,
      deferredResumesBusy: false,
      resumeConversationBusy: true,
    })).toBe(false);

    expect(shouldAutoResumeDeferredResumes({
      autoResumeKey: null,
      lastAttemptedKey: null,
      draft: false,
      isLiveSession: false,
      deferredResumesBusy: false,
      resumeConversationBusy: false,
    })).toBe(false);
  });
});
