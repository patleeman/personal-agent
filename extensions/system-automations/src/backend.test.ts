import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scheduleDeferredResume: vi.fn(),
  parseFutureDateTime: vi.fn(),
  parseDeferredResumeDelayMs: vi.fn(),
  invalidateTopics: vi.fn(),
}));

const backendAutomationMock = vi.hoisted(() => ({
  scheduleDeferredResumeForSessionFile: (...args: unknown[]) => mocks.scheduleDeferredResume(...args),
  parseFutureHumanDateTime: (...args: unknown[]) => mocks.parseFutureDateTime(...args),
  applyScheduledTaskThreadBinding: vi.fn(),
  buildScheduledTaskThreadDetail: vi.fn(),
  cancelDeferredResumeForSessionFile: vi.fn(),
  cancelQueuedPrompt: vi.fn(),
  createStoredAutomation: vi.fn(),
  deleteStoredAutomation: vi.fn(),
  DEFAULT_DEFERRED_RESUME_PROMPT: '<default>',
  getSessionDeferredResumeEntries: vi.fn(),
  getTaskCallbackBinding: vi.fn(),
  listQueuedPromptPreviews: vi.fn(),
  listStoredAutomations: vi.fn(),
  loadAutomationRuntimeStateMap: vi.fn(),
  loadDeferredResumeState: vi.fn(),
  loadScheduledTasksForProfile: vi.fn(),
  normalizeAutomationTargetTypeForSelection: vi.fn(),
  invalidateAppTopics: (...args: unknown[]) => mocks.invalidateTopics(...args),
  pingDaemon: vi.fn().mockResolvedValue(true),
  parseDeferredResumeDelayMs: (...args: unknown[]) => mocks.parseDeferredResumeDelayMs(...args),
  promptSession: vi.fn(),
  readSessionConversationId: vi.fn(),
  resolveScheduledTaskForProfile: vi.fn(),
  resolveScheduledTaskThreadBinding: vi.fn(),
  setTaskCallbackBinding: vi.fn(),
  startScheduledTaskRun: vi.fn(),
  updateStoredAutomation: vi.fn(),
  clearTaskCallbackBinding: vi.fn(),
  recordTelemetryEvent: vi.fn(),
}));

vi.mock('@personal-agent/extensions/backend', () => backendAutomationMock);
vi.mock('@personal-agent/extensions/backend/automations', () => backendAutomationMock);

import { queueFollowup } from './conversationQueueBackend.js';
import { scheduledTask } from './scheduledTaskBackend.js';

function createCtx(overrides?: Record<string, unknown>) {
  return {
    toolContext: { sessionFile: '/tmp/session.json', sessionId: 'sess-1', cwd: '/tmp/repo' },
    profile: 'shared',
    ui: { invalidate: vi.fn() },
    ...overrides,
  };
}

describe('system-automations backend', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('scheduledTask handler', () => {
    it('awaits task resolution before starting an immediate run', async () => {
      const invalidate = vi.fn();
      backendAutomationMock.resolveScheduledTaskForProfile.mockResolvedValue({
        task: { id: 'daily-check', title: 'Daily Check' },
      });
      backendAutomationMock.startScheduledTaskRun.mockResolvedValue({ accepted: true, runId: 'run-1' });

      const result = await scheduledTask({ action: 'run', taskId: 'daily-check' }, createCtx({ ui: { invalidate } }));

      expect(result.text).toContain('Started scheduled task @daily-check as run run-1');
      expect(backendAutomationMock.resolveScheduledTaskForProfile).toHaveBeenCalledWith('shared', 'daily-check');
      expect(backendAutomationMock.startScheduledTaskRun).toHaveBeenCalledWith('daily-check');
      expect(mocks.invalidateTopics).toHaveBeenCalledWith(['tasks', 'runs']);
      expect(invalidate).toHaveBeenCalledWith(['tasks', 'runs', 'sessions']);
    });

    it('does not fail when UI invalidation is unavailable', async () => {
      backendAutomationMock.resolveScheduledTaskForProfile.mockResolvedValue({
        task: { id: 'daily-check', title: 'Daily Check' },
      });
      backendAutomationMock.startScheduledTaskRun.mockResolvedValue({ accepted: true, runId: 'run-1' });

      const result = await scheduledTask({ action: 'run', taskId: 'daily-check' }, createCtx({ ui: undefined }));

      expect(result.text).toContain('Started scheduled task @daily-check as run run-1');
    });
  });

  describe('queueFollowup handler', () => {
    it('requires trigger for add action', async () => {
      await expect(queueFollowup({ action: 'add' } as never, createCtx())).rejects.toThrow('trigger is required');
    });

    it('throws for cancel action without id', async () => {
      await expect(queueFollowup({ action: 'cancel' } as never, createCtx())).rejects.toThrow('id is required');
    });

    it('schedules time-based queue entries as visible deferred resumes', async () => {
      const invalidate = vi.fn();
      mocks.parseDeferredResumeDelayMs.mockReturnValue(4 * 60 * 60 * 1000);
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'resume-1', dueAt: '2025-01-01T04:00:00.000Z', prompt: 'Keep going' });

      const result = await queueFollowup(
        { action: 'add', trigger: 'delay', delay: '4h', prompt: 'Keep going', deliverAs: 'followUp', title: 'Resume later' },
        createCtx({ ui: { invalidate } }),
      );

      expect(result.id).toBe('resume-1');
      expect(result.text).toContain('in 4h');
      expect(mocks.scheduleDeferredResume).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionFile: '/tmp/session.json',
          conversationId: 'sess-1',
          delay: '4h',
          prompt: 'Keep going',
          title: 'Resume later',
          kind: 'continue',
          behavior: 'followUp',
          notify: 'passive',
          requireAck: false,
          autoResumeIfOpen: true,
          source: { kind: 'queue-followup-tool' },
        }),
      );
      expect(invalidate).toHaveBeenCalledWith(['sessions', 'runs']);
    });

    it('does not fail scheduling when UI invalidation is unavailable', async () => {
      mocks.parseDeferredResumeDelayMs.mockReturnValue(4 * 60 * 60 * 1000);
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'resume-1', dueAt: '2025-01-01T04:00:00.000Z', prompt: 'Keep going' });

      const result = await queueFollowup(
        { action: 'add', trigger: 'delay', delay: '4h', prompt: 'Keep going' },
        createCtx({ ui: undefined }),
      );

      expect(result.id).toBe('resume-1');
    });

    it('throws for unsupported action', async () => {
      await expect(queueFollowup({ action: 'unknown' } as never, createCtx())).rejects.toThrow('Unsupported queue follow-up action');
    });

    it('throws for invalid trigger value', async () => {
      await expect(queueFollowup({ action: 'add', prompt: 'Do thing', trigger: 'invalid' } as never, createCtx())).rejects.toThrow(
        'trigger',
      );
    });
  });
});
