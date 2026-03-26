import { describe, expect, it } from 'vitest';
import {
  getRunCategory,
  getRunConnections,
  getRunHeadline,
  getRunImportState,
  getRunLocation,
  getRunMoment,
  getRunPrimaryActionLabel,
  getRunPrimaryConnection,
  getRunSortTimestamp,
  getRunTimeline,
  runNeedsAttention,
  summarizeActiveRuns,
} from './runPresentation';
import type { DurableRunRecord, ScheduledTaskSummary, SessionMeta } from './types';

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
    const tasks: ScheduledTaskSummary[] = [{
      id: 'daily-report',
      filePath: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
      scheduleType: 'cron',
      running: false,
      enabled: true,
      cron: '0 9 * * *',
      prompt: 'Summarize yesterday and today.\nInclude blockers.',
    }];

    expect(getRunHeadline(createRun(), { tasks })).toEqual({
      title: 'Summarize yesterday and today.',
      summary: 'Scheduled task · daily-report',
    });

    expect(getRunConnections(createRun(), { tasks })).toEqual([
      {
        key: 'task:daily-report',
        label: 'Scheduled task',
        value: 'daily-report',
        to: '/scheduled/daily-report',
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
    const sessions: SessionMeta[] = [{
      id: 'conv-123',
      file: '/tmp/sessions/conv-123.jsonl',
      timestamp: '2026-03-12T20:00:00.000Z',
      cwd: '/repo',
      cwdSlug: 'repo',
      model: 'openai/gpt-5',
      title: 'Fix runs navigation',
      messageCount: 8,
    }];

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
      summary: 'Live conversation · conv-123',
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
      summary: 'Deferred resume · conv-123',
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
        label: 'Deferred resume',
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

  it('builds remote execution headlines and keeps the conversation as the primary action', () => {
    const sessions: SessionMeta[] = [{
      id: 'conv-123',
      file: '/tmp/sessions/conv-123.jsonl',
      timestamp: '2026-03-12T20:00:00.000Z',
      cwd: '/repo',
      cwdSlug: 'repo',
      model: 'openai/gpt-5',
      title: 'Investigate regression',
      messageCount: 8,
    }];

    const run = createRun({
      manifest: {
        version: 1,
        id: 'run-remote-123',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {},
        source: {
          type: 'conversation-remote-run',
          id: 'conv-123',
          filePath: '/tmp/sessions/conv-123.jsonl',
        },
      },
      remoteExecution: {
        targetId: 'gpu-box',
        targetLabel: 'GPU Box',
        transport: 'ssh',
        conversationId: 'conv-123',
        localCwd: '/repo',
        remoteCwd: '/srv/agent/repo',
        prompt: 'Investigate the regression on the remote target.',
        submittedAt: '2026-03-12T20:31:00.000Z',
        importStatus: 'ready',
        transcriptAvailable: true,
        transcriptFileName: 'run-remote-123-remote-transcript.md',
      },
    });

    expect(getRunHeadline(run, { sessions })).toEqual({
      title: 'Investigate the regression on the remote target.',
      summary: 'Remote execution · GPU Box',
    });
    expect(getRunConnections(run, { sessions })).toContainEqual({
      key: 'conversation:conv-123',
      label: 'Conversation',
      value: 'Investigate regression',
      to: '/conversations/conv-123',
      detail: 'conv-123',
    });
    expect(getRunConnections(run, { sessions })).toContainEqual({
      key: 'target:gpu-box',
      label: 'Execution target',
      value: 'GPU Box',
      detail: '/srv/agent/repo · Investigate the regression on the remote target.',
    });
    expect(getRunLocation(run)).toBe('remote');
    expect(getRunImportState(run)).toBe('ready');
    expect(getRunPrimaryActionLabel(getRunPrimaryConnection(run, { sessions }))).toBe('Open conversation');
  });

  it('classifies run categories and primary links', () => {
    const scheduledRun = createRun();
    expect(getRunCategory(scheduledRun)).toBe('scheduled');
    expect(getRunPrimaryConnection(scheduledRun, {
      tasks: [{
        id: 'daily-report',
        filePath: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        prompt: 'Summarize yesterday and today.',
      }],
    })).toMatchObject({
      label: 'Scheduled task',
      to: '/scheduled/daily-report',
    });
    expect(getRunPrimaryActionLabel(getRunPrimaryConnection(scheduledRun))).toBe('Open task');

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
    expect(getRunCategory(deferredRun)).toBe('deferred');
    expect(getRunPrimaryActionLabel(getRunPrimaryConnection(deferredRun))).toBe('Open conversation');

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
    expect(getRunCategory(backgroundRun)).toBe('background');
  });

  it('links background runs started from a conversation back to that conversation', () => {
    const sessions: SessionMeta[] = [{
      id: 'conv-123',
      file: '/tmp/sessions/conv-123.jsonl',
      timestamp: '2026-03-12T20:00:00.000Z',
      cwd: '/repo',
      cwdSlug: 'repo',
      model: 'openai/gpt-5',
      title: 'Watch subagent run',
      messageCount: 12,
    }];

    const run = createRun({
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

    expect(getRunConnections(run, { sessions })).toContainEqual({
      key: 'conversation:conv-123',
      label: 'Conversation',
      value: 'Watch subagent run',
      to: '/conversations/conv-123',
      detail: 'conv-123',
    });

    expect(getRunPrimaryConnection(run, { sessions })).toMatchObject({
      label: 'Conversation',
      to: '/conversations/conv-123',
    });
    expect(getRunPrimaryActionLabel(getRunPrimaryConnection(run, { sessions }))).toBe('Open conversation');
  });

  it('shows conversation node distillation runs with a dedicated headline', () => {
    const sessions: SessionMeta[] = [{
      id: 'conv-123',
      file: '/tmp/sessions/conv-123.jsonl',
      timestamp: '2026-03-12T20:00:00.000Z',
      cwd: '/repo',
      cwdSlug: 'repo',
      model: 'openai/gpt-5',
      title: 'Notes pipeline cleanup',
      messageCount: 12,
    }];

    const run = createRun({
      manifest: {
        version: 1,
        id: 'run-distill-node-2026-03-12T20-30-00-000Z-abcd1234',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T20:30:00.000Z',
        spec: {
          taskSlug: 'distill-node-conv-123',
        },
        source: {
          type: 'conversation-node-distill',
          id: 'conv-123',
        },
      },
      checkpoint: {
        version: 1,
        runId: 'run-distill-node-2026-03-12T20-30-00-000Z-abcd1234',
        updatedAt: '2026-03-12T20:35:00.000Z',
        step: 'completed',
        payload: {},
      },
    });

    expect(getRunHeadline(run, { sessions })).toEqual({
      title: 'Distill node: Notes pipeline cleanup',
      summary: 'Conversation node distillation',
    });
  });

  it('summarizes active runs from live task and conversation state', () => {
    const activeRuns = summarizeActiveRuns({
      tasks: [{
        id: 'daily-report',
        filePath: '/repo/profiles/assistant/agent/tasks/daily-report.task.md',
        scheduleType: 'cron',
        running: true,
        enabled: true,
        prompt: 'Summarize yesterday and today.',
      }],
      sessions: [{
        id: 'conv-123',
        file: '/tmp/sessions/conv-123.jsonl',
        timestamp: '2026-03-12T20:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'openai/gpt-5',
        title: 'Watch subagent run',
        messageCount: 12,
        isRunning: true,
      }],
      runs: {
        scannedAt: '2026-03-12T20:35:00.000Z',
        runsRoot: '/tmp/runs',
        summary: {
          total: 3,
          recoveryActions: {},
          statuses: { running: 3 },
        },
        runs: [
          createRun({
            status: {
              version: 1,
              runId: 'run-123',
              status: 'running',
              createdAt: '2026-03-12T20:30:00.000Z',
              updatedAt: '2026-03-12T20:35:00.000Z',
              activeAttempt: 1,
              startedAt: '2026-03-12T20:31:00.000Z',
            },
          }),
          createRun({
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
              },
            },
            status: {
              version: 1,
              runId: 'conversation-live-conv-123',
              status: 'running',
              createdAt: '2026-03-12T20:30:00.000Z',
              updatedAt: '2026-03-12T20:35:00.000Z',
              activeAttempt: 1,
              startedAt: '2026-03-12T20:31:00.000Z',
            },
          }),
          createRun({
            runId: 'run-subagent-123',
            manifest: {
              version: 1,
              id: 'run-subagent-123',
              kind: 'background-run',
              resumePolicy: 'manual',
              createdAt: '2026-03-12T20:30:00.000Z',
              spec: {
                taskSlug: 'subagent',
              },
              source: {
                type: 'tool',
                id: 'conv-123',
              },
            },
            status: {
              version: 1,
              runId: 'run-subagent-123',
              status: 'running',
              createdAt: '2026-03-12T20:30:00.000Z',
              updatedAt: '2026-03-12T20:35:00.000Z',
              activeAttempt: 1,
              startedAt: '2026-03-12T20:31:00.000Z',
            },
          }),
        ],
      },
    });

    expect(activeRuns).toEqual({
      total: 3,
      scheduled: 1,
      conversation: 1,
      deferred: 0,
      background: 1,
      other: 0,
    });
  });

  it('ignores stale scheduled and conversation runs when live state says they are idle', () => {
    const activeRuns = summarizeActiveRuns({
      tasks: [],
      sessions: [],
      runs: {
        scannedAt: '2026-03-12T20:35:00.000Z',
        runsRoot: '/tmp/runs',
        summary: {
          total: 3,
          recoveryActions: {},
          statuses: { running: 3 },
        },
        runs: [
          createRun({
            status: {
              version: 1,
              runId: 'run-123',
              status: 'running',
              createdAt: '2026-03-12T20:30:00.000Z',
              updatedAt: '2026-03-12T20:35:00.000Z',
              activeAttempt: 1,
              startedAt: '2026-03-12T20:31:00.000Z',
            },
          }),
          createRun({
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
              },
            },
            status: {
              version: 1,
              runId: 'conversation-live-conv-123',
              status: 'running',
              createdAt: '2026-03-12T20:30:00.000Z',
              updatedAt: '2026-03-12T20:35:00.000Z',
              activeAttempt: 1,
              startedAt: '2026-03-12T20:31:00.000Z',
            },
          }),
          createRun({
            runId: 'run-subagent-123',
            manifest: {
              version: 1,
              id: 'run-subagent-123',
              kind: 'background-run',
              resumePolicy: 'manual',
              createdAt: '2026-03-12T20:30:00.000Z',
              spec: {
                taskSlug: 'subagent',
              },
              source: {
                type: 'tool',
                id: 'conv-123',
              },
            },
            status: {
              version: 1,
              runId: 'run-subagent-123',
              status: 'running',
              createdAt: '2026-03-12T20:30:00.000Z',
              updatedAt: '2026-03-12T20:35:00.000Z',
              activeAttempt: 1,
              startedAt: '2026-03-12T20:31:00.000Z',
            },
          }),
        ],
      },
    });

    expect(activeRuns).toEqual({
      total: 1,
      scheduled: 0,
      conversation: 0,
      deferred: 0,
      background: 1,
      other: 0,
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
    expect(getRunSortTimestamp(run)).toBe('2026-03-12T20:35:00.000Z');
    expect(getRunTimeline(run)).toEqual([
      { label: 'Created', at: '2026-03-12T20:30:00.000Z' },
      { label: 'Started', at: '2026-03-12T20:31:00.000Z' },
      { label: 'Updated', at: '2026-03-12T20:35:00.000Z' },
      { label: 'Completed', at: '2026-03-12T20:35:00.000Z' },
    ]);
  });
});
