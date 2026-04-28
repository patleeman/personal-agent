import { describe, expect, it } from 'vitest';
import type { ProjectRecord, ScheduledTaskDetail, SessionMeta } from '../shared/types';
import { buildTaskExistingThreadOptions, buildTaskProjectOptions, parseCatchUpWindowMinutes, shouldClearMissingExistingThreadSelection, shouldShowTaskModelControls, taskStatusMeta } from './ScheduledTaskPanel';

function createTask(overrides: Partial<ScheduledTaskDetail>): ScheduledTaskDetail {
  return {
    id: 'daily-report',
    title: 'Daily report',
    filePath: '/__automations__/daily-report.automation.md',
    scheduleType: 'cron',
    targetType: 'background-agent',
    running: false,
    enabled: true,
    cron: '0 9 * * *',
    prompt: 'Send report.',
    threadMode: 'dedicated',
    ...overrides,
  };
}

describe('ScheduledTaskPanel status presentation', () => {
  it('marks daemon failed status as failed', () => {
    expect(taskStatusMeta(createTask({ lastStatus: 'failed' }))).toEqual({
      text: 'failed',
      cls: 'text-danger',
    });
  });
});

describe('ScheduledTaskPanel editor capabilities', () => {
  it('rejects unsafe catch-up window minute values', () => {
    expect(parseCatchUpWindowMinutes(String(Number.MAX_SAFE_INTEGER + 1))).toBeNaN();
  });

  it('allows thread automations to choose a model', () => {
    expect(shouldShowTaskModelControls({ targetType: 'conversation' })).toBe(true);
  });

  it('uses only local conversation workspaces as project options', () => {
    const localSession: SessionMeta = {
      id: 'local-thread',
      file: '/tmp/local.jsonl',
      timestamp: '2026-04-01T00:00:00.000Z',
      cwd: '/tmp/local-worktree',
      cwdSlug: 'local-worktree',
      model: 'openai/gpt-5.4',
      title: 'Local thread',
      messageCount: 1,
    };
    const remoteSession: SessionMeta = {
      ...localSession,
      id: 'remote-thread',
      cwd: '/home/patrick/remote-worktree',
      cwdSlug: 'remote-worktree',
      remoteHostId: 'bender',
      remoteConversationId: 'remote-1',
    };
    const project: ProjectRecord = {
      id: 'project-1',
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
      title: 'Project Repo',
      description: '',
      repoRoot: '/tmp/project-repo',
      summary: '',
      requirements: { goal: '', acceptanceCriteria: [] },
      status: 'active',
      blockers: [],
      recentProgress: [],
      plan: { milestones: [] },
    };

    expect(buildTaskProjectOptions({
      defaultCwd: '/',
      savedWorkspacePaths: ['/tmp/saved-worktree'],
      sessions: [remoteSession, localSession],
      projects: [project],
    })).toEqual([
      { path: '/tmp/saved-worktree', label: 'saved-worktree' },
      { path: '/tmp/local-worktree', label: 'local-worktree' },
      { path: '/tmp/project-repo', label: 'Project Repo' },
    ]);
  });

  it('uses only local conversations as existing automation thread options', () => {
    const localSession: SessionMeta = {
      id: 'local-thread',
      file: '/tmp/local.jsonl',
      timestamp: '2026-04-01T00:00:00.000Z',
      cwd: '/tmp/worktree',
      cwdSlug: 'worktree',
      model: 'openai/gpt-5.4',
      title: 'Local thread',
      messageCount: 1,
    };
    const remoteSession: SessionMeta = {
      ...localSession,
      id: 'remote-thread',
      title: 'Remote thread',
      remoteHostId: 'bender',
      remoteConversationId: 'remote-1',
    };

    expect(buildTaskExistingThreadOptions({
      effectiveThreadCwd: '/tmp/worktree',
      sessions: [remoteSession, localSession],
    })).toEqual([
      { id: 'local-thread', label: 'Local thread', cwd: '/tmp/worktree' },
    ]);
  });

  it('keeps an existing thread selection while sessions are still loading', () => {
    expect(shouldClearMissingExistingThreadSelection({
      threadMode: 'existing',
      threadConversationId: 'thread-1',
      existingThreadOptions: [],
      sessionsLoaded: false,
    })).toBe(false);

    expect(shouldClearMissingExistingThreadSelection({
      threadMode: 'existing',
      threadConversationId: 'thread-1',
      existingThreadOptions: [],
      sessionsLoaded: true,
    })).toBe(true);

    expect(shouldClearMissingExistingThreadSelection({
      threadMode: 'existing',
      threadConversationId: 'thread-1',
      existingThreadOptions: [{ id: 'thread-1' }],
      sessionsLoaded: true,
    })).toBe(false);
  });
});
