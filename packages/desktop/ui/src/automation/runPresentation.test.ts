import { describe, expect, it } from 'vitest';

import type { DurableRunRecord, ScheduledTaskSummary, SessionMeta } from '../shared/types';
import {
  getRunConnections,
  getRunHeadline,
  getRunMoment,
  getRunPrimaryConnection,
  getRunResultSummary,
  getRunTimeline,
  isRunActive,
  listConnectedConversationBackgroundRuns,
  listRecentConversationBackgroundRuns,
  runNeedsAttention,
} from './runPresentation';

function createRun(overrides: Partial<DurableRunRecord> = {}): DurableRunRecord {
  return {
    runId: 'run-123',
    paths: {
      root: '/tmp/run-123',
      manifestPath: '/tmp/run-123/manifest.json',
      statusPath: '/tmp/run-123/status.json',
      checkpointPath: '/tmp/run-123/checkpoint.json',
      eventsPath: '/tmp/run-123/events.jsonl',
      outputLogPath: '/tmp/run-123/output.log',
      resultPath: '/tmp/run-123/result.json',
    },
    manifest: {
      version: 1,
      id: 'run-123',
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: '2026-03-12T20:30:00.000Z',
      spec: {},
      source: {
        type: 'scheduled-task',
        id: 'daily-report',
        filePath: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
      },
    },
    status: {
      version: 1,
      runId: 'run-123',
      status: 'completed',
      createdAt: '2026-03-12T20:30:00.000Z',
      updatedAt: '2026-03-12T20:35:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-12T20:31:00.000Z',
      completedAt: '2026-03-12T20:35:00.000Z',
    },
    checkpoint: {
      version: 1,
      runId: 'run-123',
      updatedAt: '2026-03-12T20:35:00.000Z',
      step: 'completed',
      payload: {},
    },
    problems: [],
    recoveryAction: 'none',
    ...overrides,
  };
}

describe('runPresentation', () => {
  it('builds a human headline for scheduled task runs', () => {
    const tasks: ScheduledTaskSummary[] = [
      {
        id: 'daily-report',
        filePath: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        cron: '0 9 * * *',
        prompt: 'Summarize yesterday and today.\nInclude blockers.',
      },
    ];

    expect(getRunHeadline(createRun(), { tasks })).toEqual({
      title: 'Summarize yesterday and today.',
      summary: 'Automation execution · daily-report',
    });

    expect(getRunConnections(createRun(), { tasks })).toEqual([
      {
        key: 'task:daily-report',
        label: 'Automation',
        value: 'daily-report',
        to: '/automations/daily-report',
        detail: 'Summarize yesterday and today.',
      },
      {
        key: 'file:/repo/profiles/assistant/agent/tasks/daily-report.task.md',
        label: 'Source file',
        value: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
      },
    ]);
  });

  it('resolves live conversation titles and routes', () => {
    const sessions: SessionMeta[] = [
      {
        id: 'conv-123',
        file: '/tmp/sessions/conv-123.jsonl',
        timestamp: '2026-03-12T20:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'openai/gpt-5',
        title: 'Fix runs navigation',
        messageCount: 8,
      },
    ];

    const run = createRun({
      manifest: {
        version: 1,
        id: 'conversation-live-conv-123',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          conversationId: 'conv-123',
        },
        source: {
          type: 'web-live-session',
          id: 'conv-123',
          filePath: '/tmp/sessions/conv-123.jsonl',
        },
      },
      checkpoint: {
        version: 1,
        runId: 'conversation-live-conv-123',
        updatedAt: '2026-03-12T20:35:00.000Z',
        step: 'web-live-session.running',
        payload: {
          conversationId: 'conv-123',
        },
      },
    });

    expect(getRunHeadline(run, { sessions })).toEqual({
      title: 'Fix runs navigation',
      summary: 'Conversation session · conv-123',
    });

    expect(getRunConnections(run, { sessions })).toEqual([
      {
        key: 'conversation:conv-123',
        label: 'Conversation',
        value: 'Fix runs navigation',
        to: '/conversations/conv-123',
        detail: 'conv-123',
      },
      {
        key: 'file:/tmp/sessions/conv-123.jsonl',
        label: 'Source file',
        value: '/tmp/sessions/conv-123.jsonl',
      },
    ]);
  });

  it('surfaces deferred resume prompt and conversation target', () => {
    const run = createRun({
      manifest: {
        version: 1,
        id: 'conversation-deferred-resume-resume-123',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          conversationId: 'conv-123',
          prompt: 'Check back in after the build finishes.',
        },
        source: {
          type: 'deferred-resume',
          id: 'resume-123',
          filePath: '/tmp/sessions/conv-123.jsonl',
        },
      },
      checkpoint: {
        version: 1,
        runId: 'conversation-deferred-resume-resume-123',
        updatedAt: '2026-03-12T20:35:00.000Z',
        step: 'deferred-resume.ready',
        payload: {
          conversationId: 'conv-123',
          prompt: 'Check back in after the build finishes.',
        },
      },
    });

    expect(getRunHeadline(run)).toEqual({
      title: 'Check back in after the build finishes.',
      summary: 'Wakeup · conv-123',
    });

    expect(getRunConnections(run)).toEqual([
      {
        key: 'conversation:conv-123',
        label: 'Conversation to reopen',
        value: 'conv-123',
        to: '/conversations/conv-123',
        detail: undefined,
      },
      {
        key: 'deferred-resume:resume-123',
        label: 'Wakeup',
        value: 'resume-123',
        detail: 'Check back in after the build finishes.',
      },
      {
        key: 'file:/tmp/sessions/conv-123.jsonl',
        label: 'Source file',
        value: '/tmp/sessions/conv-123.jsonl',
      },
    ]);
  });

  it('resolves primary links for scheduled, deferred, and background runs', () => {
    const scheduledRun = createRun();
    expect(
      getRunPrimaryConnection(scheduledRun, {
        tasks: [
          {
            id: 'daily-report',
            filePath: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
            scheduleType: 'cron',
            running: false,
            enabled: true,
            prompt: 'Summarize yesterday and today.',
          },
        ],
      }),
    ).toMatchObject({
      label: 'Automation',
      to: '/automations/daily-report',
    });

    const deferredRun = createRun({
      manifest: {
        version: 1,
        id: 'conversation-deferred-resume-resume-123',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          conversationId: 'conv-123',
        },
        source: {
          type: 'deferred-resume',
          id: 'resume-123',
        },
      },
      checkpoint: {
        version: 1,
        runId: 'conversation-deferred-resume-resume-123',
        updatedAt: '2026-03-12T20:35:00.000Z',
        step: 'deferred-resume.ready',
        payload: {
          conversationId: 'conv-123',
        },
      },
    });
    expect(getRunPrimaryConnection(deferredRun)).toMatchObject({
      label: 'Conversation to reopen',
      to: '/conversations/conv-123',
    });

    const backgroundRun = createRun({
      manifest: {
        version: 1,
        id: 'run-shell-123',
        kind: 'raw-shell',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          shellCommand: 'npm test -- --run smoke',
        },
        source: {
          type: 'background-run',
          id: 'smoke-check',
        },
      },
    });
    expect(getRunPrimaryConnection(backgroundRun)).toBeUndefined();
  });

  it('reads persisted run result summaries and recent completed conversation runs', () => {
    const completed = createRun({
      runId: 'run-completed',
      manifest: {
        version: 1,
        id: 'run-completed',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {},
        source: { type: 'tool', id: 'conv-123' },
      },
      status: {
        version: 1,
        runId: 'run-completed',
        status: 'completed',
        createdAt: '2026-03-12T20:30:00.000Z',
        updatedAt: '2026-03-12T20:35:00.000Z',
        activeAttempt: 1,
        completedAt: '2026-03-12T20:35:00.000Z',
      },
      result: { summary: 'Uploaded the dataset successfully.' },
    });
    const running = createRun({
      runId: 'run-running',
      manifest: {
        version: 1,
        id: 'run-running',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:31:00.000Z',
        spec: {},
        source: { type: 'tool', id: 'conv-123' },
      },
      status: {
        version: 1,
        runId: 'run-running',
        status: 'running',
        createdAt: '2026-03-12T20:31:00.000Z',
        updatedAt: '2026-03-12T20:36:00.000Z',
        activeAttempt: 1,
      },
    });

    expect(getRunResultSummary(completed)).toBe('Uploaded the dataset successfully.');
    expect(
      listRecentConversationBackgroundRuns({
        conversationId: 'conv-123',
        runs: {
          scannedAt: '2026-03-12T20:36:00.000Z',
          runsRoot: '/tmp/runs',
          summary: { total: 2, recoveryActions: {}, statuses: {} },
          runs: [running, completed],
        },
      }).map((run) => run.runId),
    ).toEqual(['run-completed']);
  });

  it('prefers a run transcript conversation while still linking back to the originating conversation', () => {
    const sessions: SessionMeta[] = [
      {
        id: 'conv-123',
        file: '/tmp/sessions/conv-123.jsonl',
        timestamp: '2026-03-12T20:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'openai/gpt-5',
        title: 'Watch subagent run',
        messageCount: 12,
      },
      {
        id: 'subagent-456',
        file: '/tmp/sessions/__runs/run-subagent-2026-03-12T20-30-00-000Z-abcd1234/subagent-456.jsonl',
        timestamp: '2026-03-12T20:31:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'openai/gpt-5',
        title: 'Focused work transcript',
        messageCount: 9,
        sourceRunId: 'run-subagent-2026-03-12T20-30-00-000Z-abcd1234',
      },
    ];

    const run = createRun({
      runId: 'run-subagent-2026-03-12T20-30-00-000Z-abcd1234',
      manifest: {
        version: 1,
        id: 'run-subagent-2026-03-12T20-30-00-000Z-abcd1234',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          taskSlug: 'subagent',
          shellCommand: 'pa tui -p "focused work"',
        },
        source: {
          type: 'tool',
          id: 'conv-123',
        },
      },
      checkpoint: {
        version: 1,
        runId: 'run-subagent-2026-03-12T20-30-00-000Z-abcd1234',
        updatedAt: '2026-03-12T20:35:00.000Z',
        step: 'completed',
        payload: {},
      },
    });

    expect(getRunConnections(run, { sessions })).toEqual(
      expect.arrayContaining([
        {
          key: 'transcript:subagent-456',
          label: 'Conversation transcript',
          value: 'Focused work transcript',
          to: '/conversations/subagent-456',
          detail: 'subagent-456',
        },
        {
          key: 'conversation:conv-123',
          label: 'Conversation',
          value: 'Watch subagent run',
          to: '/conversations/conv-123',
          detail: 'conv-123',
        },
      ]),
    );

    expect(getRunPrimaryConnection(run, { sessions })).toMatchObject({
      label: 'Conversation transcript',
      to: '/conversations/subagent-456',
    });
  });

  it('finds connected conversation background runs before session metadata has loaded', () => {
    const queuedBackgroundRun = createRun({
      runId: 'run-background-newer',
      manifest: {
        version: 1,
        id: 'run-background-newer',
        kind: 'raw-shell',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:32:00.000Z',
        spec: {
          shellCommand: 'sleep 120',
        },
        source: {
          type: 'tool',
          id: 'conv-123',
        },
      },
      status: {
        version: 1,
        runId: 'run-background-newer',
        status: 'queued',
        createdAt: '2026-03-12T20:32:00.000Z',
        updatedAt: '2026-03-12T20:36:00.000Z',
        activeAttempt: 0,
      },
    });

    const completedBackgroundRun = createRun({
      runId: 'run-background-older',
      manifest: {
        version: 1,
        id: 'run-background-older',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          taskSlug: 'deploy-check',
        },
        source: {
          type: 'tool',
          id: 'conv-123',
        },
      },
    });

    const unrelatedBackgroundRun = createRun({
      runId: 'run-background-other',
      manifest: {
        version: 1,
        id: 'run-background-other',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:33:00.000Z',
        spec: {
          taskSlug: 'other-task',
        },
        source: {
          type: 'tool',
          id: 'conv-999',
        },
      },
    });

    const connected = listConnectedConversationBackgroundRuns({
      conversationId: 'conv-123',
      runs: {
        scannedAt: '2026-03-12T20:36:00.000Z',
        runsRoot: '/tmp/runs',
        summary: {
          total: 3,
          recoveryActions: {},
          statuses: { queued: 1, completed: 2 },
        },
        runs: [completedBackgroundRun, unrelatedBackgroundRun, queuedBackgroundRun],
      },
      excludeConversationRunId: 'conversation-live-conv-123',
    });

    expect(connected.map((run) => run.runId)).toEqual(['run-background-newer', 'run-background-older']);
    expect(isRunActive(connected[0])).toBe(true);
    expect(isRunActive(connected[1])).toBe(false);
  });

  it('strips leading environment wrappers from background shell headlines', () => {
    const run = createRun({
      manifest: {
        version: 1,
        id: 'run-ui-123',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          taskSlug: 'ui-smoke',
          shellCommand: 'npm --prefix packages/desktop run dev:client -- --port 4232',
        },
        source: {
          type: 'tool',
          id: 'conv-123',
        },
      },
    });

    expect(getRunHeadline(run)).toEqual({
      title: 'npm --prefix packages/desktop run dev',
      summary: 'Shell command · ui-smoke',
    });
  });

  it('strips env command wrappers from raw shell headlines', () => {
    const run = createRun({
      manifest: {
        version: 1,
        id: 'run-raw-shell-123',
        kind: 'raw-shell',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          shellCommand: 'env -u PERSONAL_AGENT_APP_REVISION npm --prefix packages/desktop run dev:client',
        },
        source: {
          type: 'cli',
          id: 'ui-dev-server',
        },
      },
    });

    expect(getRunHeadline(run)).toEqual({
      title: 'npm --prefix packages/desktop run dev',
      summary: 'Shell command',
    });
  });

  it('reads unified schedule-run metadata for raw shell headlines', () => {
    const run = createRun({
      manifest: {
        version: 1,
        id: 'run-raw-shell-456',
        kind: 'raw-shell',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          target: {
            type: 'shell',
            command: 'printf ok',
            cwd: '/Users/patrick/workingdir/personal-agent',
          },
          metadata: {
            taskSlug: 'ui-preview-check',
            cwd: '/Users/patrick/workingdir/personal-agent',
          },
        },
        source: {
          type: 'tool',
          id: 'conv-123',
        },
      },
      checkpoint: {
        version: 1,
        runId: 'run-raw-shell-456',
        updatedAt: '2026-03-12T20:35:00.000Z',
        step: 'completed',
        payload: {
          target: {
            type: 'shell',
            command: 'printf ok',
            cwd: '/Users/patrick/workingdir/personal-agent',
          },
          metadata: {
            taskSlug: 'ui-preview-check',
            cwd: '/Users/patrick/workingdir/personal-agent',
          },
        },
      },
    });

    expect(getRunHeadline(run)).toEqual({
      title: 'printf ok',
      summary: 'Shell command · ui-preview-check',
    });
  });

  it('reads unified schedule-run metadata for background agent headlines', () => {
    const run = createRun({
      manifest: {
        version: 1,
        id: 'run-background-456',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          target: {
            type: 'agent',
            prompt: 'Inspect git diff and summarize the result.',
            model: 'openai-codex/gpt-5.4',
          },
          metadata: {
            taskSlug: 'ui-polish',
            cwd: '/Users/patrick/workingdir/personal-agent',
          },
        },
        source: {
          type: 'tool',
          id: 'conv-123',
        },
      },
    });

    expect(getRunHeadline(run)).toEqual({
      title: 'Inspect git diff and summarize the result.',
      summary: 'Agent task · ui-polish',
    });
  });

  it('treats dismissed attention states as reviewed until the run changes again', () => {
    const run = createRun({
      status: {
        version: 1,
        runId: 'run-123',
        status: 'failed',
        createdAt: '2026-03-12T20:30:00.000Z',
        updatedAt: '2026-03-12T20:35:00.000Z',
        activeAttempt: 1,
        startedAt: '2026-03-12T20:31:00.000Z',
        completedAt: '2026-03-12T20:35:00.000Z',
      },
    });

    expect(runNeedsAttention(run)).toBe(true);
    expect(runNeedsAttention({ ...run, attentionDismissed: true })).toBe(false);
    expect(runNeedsAttention({ ...run, attentionDismissed: true }, { includeDismissed: true })).toBe(true);
  });

  it('prefers completion time for run timing and timeline', () => {
    const run = createRun();

    expect(getRunMoment(run)).toEqual({
      label: 'completed',
      at: '2026-03-12T20:35:00.000Z',
    });
    expect(getRunTimeline(run)).toEqual([
      { label: 'Created', at: '2026-03-12T20:30:00.000Z' },
      { label: 'Started', at: '2026-03-12T20:31:00.000Z' },
      { label: 'Updated', at: '2026-03-12T20:35:00.000Z' },
      { label: 'Completed', at: '2026-03-12T20:35:00.000Z' },
    ]);
  });
});
