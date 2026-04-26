import { describe, expect, it } from 'vitest';
import type { DurableRunRecord } from '../../shared/types';
import type { LinkedRunPresentation } from './linkedRuns.js';
import { extractLinkedTaskSlugFromRunId, pickBestResolvedLinkedRunCandidate, resolveLinkedRunRecord } from './linkedRunResolution.js';

const emptyPaths = {
  root: '',
  manifestPath: '',
  statusPath: '',
  checkpointPath: '',
  eventsPath: '',
  outputLogPath: '',
  resultPath: '',
};

function runRecord(runId: string, options: {
  taskSlug?: string;
  prompt?: string;
  status?: string;
  updatedAt?: string;
} = {}): DurableRunRecord {
  return {
    runId,
    paths: emptyPaths,
    problems: [],
    recoveryAction: 'none',
    manifest: {
      version: 1,
      id: runId,
      kind: 'background-run',
      resumePolicy: 'none',
      createdAt: options.updatedAt ?? '2026-04-26T00:00:00.000Z',
      spec: {
        taskSlug: options.taskSlug,
        prompt: options.prompt,
      },
    },
    status: {
      version: 1,
      runId,
      status: options.status ?? 'completed',
      createdAt: '2026-04-26T00:00:00.000Z',
      updatedAt: options.updatedAt ?? '2026-04-26T00:00:00.000Z',
      activeAttempt: 1,
    },
  };
}

describe('linkedRunResolution', () => {
  it('extracts task slug from timestamped run ids', () => {
    expect(extractLinkedTaskSlugFromRunId('run-architecture-pass-2026-04-26T12-30-00-abc123')).toBe('architecture-pass');
    expect(extractLinkedTaskSlugFromRunId('task-architecture-pass')).toBeNull();
    expect(extractLinkedTaskSlugFromRunId('run-no-timestamp')).toBeNull();
  });

  it('prefers active candidates before newer inactive candidates', () => {
    const active = runRecord('run-active', { status: 'running', updatedAt: '2026-04-25T00:00:00.000Z' });
    const newer = runRecord('run-newer', { status: 'completed', updatedAt: '2026-04-26T00:00:00.000Z' });

    expect(pickBestResolvedLinkedRunCandidate([newer, active])).toBe(active);
  });

  it('resolves exact run ids first', () => {
    const exact = runRecord('run-exact');
    expect(resolveLinkedRunRecord({ runId: 'run-exact', title: 'Other', detail: null }, [exact], { tasks: null, sessions: null })).toBe(exact);
  });

  it('resolves timestamped linked ids by task slug', () => {
    const older = runRecord('run-old', { taskSlug: 'architecture-pass', updatedAt: '2026-04-24T00:00:00.000Z' });
    const newer = runRecord('run-new', { taskSlug: 'architecture-pass', updatedAt: '2026-04-26T00:00:00.000Z' });
    const linkedRun: LinkedRunPresentation = {
      runId: 'run-architecture-pass-2026-04-26T12-30-00-abc123',
      title: 'Architecture pass',
      detail: null,
    };

    expect(resolveLinkedRunRecord(linkedRun, [older, newer], { tasks: null, sessions: null })).toBe(newer);
  });

  it('falls back to resolved run titles', () => {
    const target = runRecord('run-target', { prompt: 'Chat cleanup' });
    const linkedRun: LinkedRunPresentation = { runId: 'run-unresolved', title: 'chat_cleanup', detail: null };

    expect(resolveLinkedRunRecord(linkedRun, [target], { tasks: null, sessions: null })).toBe(target);
  });
});
