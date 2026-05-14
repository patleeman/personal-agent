import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { DeferredResumeSummary, DurableRunRecord } from '../../shared/types';
import { ConversationActivityShelf } from './ConversationActivityShelf';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const run: DurableRunRecord = {
  runId: 'run-1',
  conversationId: 'conv-1',
  manifest: { kind: 'background-run', spec: { metadata: { taskSlug: 'code-review' } } },
  status: { status: 'running' },
} as DurableRunRecord;

const resume: DeferredResumeSummary = {
  id: 'resume-1',
  sessionFile: '/tmp/conv-1.jsonl',
  prompt: 'wake me',
  dueAt: '2026-04-01T10:00:00.000Z',
  createdAt: '2026-04-01T09:00:00.000Z',
  attempts: 1,
  status: 'scheduled',
};

describe('ConversationActivityShelf', () => {
  it('renders background run summary and expanded details', () => {
    const html = renderToString(
      <ConversationActivityShelf
        backgroundRuns={[run]}
        backgroundRunIndicatorText="running · code-review"
        showBackgroundRunDetails
        runLookups={{}}
        onToggleBackgroundRunDetails={vi.fn()}
        onCancelBackgroundRun={vi.fn()}
        deferredResumes={[]}
        deferredResumeIndicatorText="none"
        deferredResumeNowMs={Date.parse('2026-04-01T09:00:00.000Z')}
        hasReadyDeferredResumes={false}
        isLiveSession={false}
        deferredResumesBusy={false}
        showDeferredResumeDetails={false}
        onContinueDeferredResumesNow={vi.fn()}
        onToggleDeferredResumeDetails={vi.fn()}
        onFireDeferredResumeNow={vi.fn()}
        onCancelDeferredResume={vi.fn()}
      />,
    );

    expect(html).toContain('Background Work');
    expect(html).toContain('running · code-review');
    expect(html).toContain('code-review');
    expect(html).toContain('cancel');
    expect(html).toContain('hide');
  });

  it('labels shell-backed background runs as Bash', () => {
    const shellRun = {
      ...run,
      manifest: { kind: 'background-run', spec: { shellCommand: 'npm test', metadata: { taskSlug: 'tests' } } },
      status: { status: 'completed' },
    } as DurableRunRecord;

    const html = renderToString(
      <ConversationActivityShelf
        backgroundRuns={[shellRun]}
        backgroundRunIndicatorText="completed · tests"
        showBackgroundRunDetails
        runLookups={{}}
        onToggleBackgroundRunDetails={vi.fn()}
        deferredResumes={[]}
        deferredResumeIndicatorText="none"
        deferredResumeNowMs={Date.parse('2026-04-01T09:00:00.000Z')}
        hasReadyDeferredResumes={false}
        isLiveSession={false}
        deferredResumesBusy={false}
        showDeferredResumeDetails={false}
        onContinueDeferredResumesNow={vi.fn()}
        onToggleDeferredResumeDetails={vi.fn()}
        onFireDeferredResumeNow={vi.fn()}
        onCancelDeferredResume={vi.fn()}
      />,
    );

    expect(html).toContain('Bash');
    expect(html).not.toContain('Shell');
  });

  it('renders deferred resume summary and expanded actions', () => {
    const html = renderToString(
      <ConversationActivityShelf
        backgroundRuns={[]}
        backgroundRunIndicatorText=""
        showBackgroundRunDetails={false}
        runLookups={{}}
        onToggleBackgroundRunDetails={vi.fn()}
        deferredResumes={[resume]}
        deferredResumeIndicatorText="1 scheduled · next in 1h 0m"
        deferredResumeNowMs={Date.parse('2026-04-01T09:00:00.000Z')}
        hasReadyDeferredResumes={false}
        isLiveSession={false}
        deferredResumesBusy={false}
        showDeferredResumeDetails
        onContinueDeferredResumesNow={vi.fn()}
        onToggleDeferredResumeDetails={vi.fn()}
        onFireDeferredResumeNow={vi.fn()}
        onCancelDeferredResume={vi.fn()}
      />,
    );

    expect(html).toContain('Wakeups');
    expect(html).toContain('1 scheduled');
    expect(html).toContain('wake me');
    expect(html).toContain('fire now');
    expect(html).toContain('cancel');
    expect(html).toContain('retries 1');
  });
});
