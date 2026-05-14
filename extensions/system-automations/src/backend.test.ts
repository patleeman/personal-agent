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
}));

// Mock the backend API for the reminder handler
vi.mock('@personal-agent/extensions/backend', () => backendAutomationMock);
vi.mock('@personal-agent/extensions/backend/automations', () => backendAutomationMock);
vi.mock('@personal-agent/extensions/backend/telemetry', () => ({ recordTelemetryEvent: vi.fn() }), { virtual: true });

import { reminder } from './backend.js';
import { conversationQueue } from './conversationQueueBackend.js';

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

  describe('reminder handler', () => {
    it('schedules a deferred resume with delay', async () => {
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'rem-1', dueAt: '2025-01-01T01:00:00Z', prompt: 'Wake up!', title: 'Alert' });

      const result = await reminder({ prompt: 'Wake up!', title: 'Alert', delay: '1h' }, createCtx());
      expect(result.text).toContain('Scheduled reminder rem-1');
      expect(result.text).toContain('in 1h');
      expect(result.id).toBe('rem-1');
      expect(mocks.scheduleDeferredResume).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionFile: '/tmp/session.json',
          delay: '1h',
          prompt: 'Wake up!',
          title: 'Alert',
          kind: 'reminder',
          source: { kind: 'reminder-tool' },
        }),
      );
    });

    it('schedules a deferred resume with at time', async () => {
      mocks.parseFutureDateTime.mockReturnValue({
        input: 'tomorrow 9am',
        dueAt: '2025-01-02T09:00:00Z',
        interpretation: '2025-01-02 09:00:00',
      });
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'rem-2', dueAt: '2025-01-02T09:00:00Z', prompt: 'Meeting', title: 'Meeting' });

      const result = await reminder({ prompt: 'Meeting', title: 'Meeting', at: 'tomorrow 9am' }, createCtx());
      expect(result.text).toContain('Scheduled reminder rem-2');
      expect(result.localDueAt).toBe('2025-01-02 09:00:00');
      expect(mocks.scheduleDeferredResume).toHaveBeenCalledWith(
        expect.objectContaining({
          delay: undefined,
          at: '2025-01-02T09:00:00Z',
        }),
      );
    });

    it('uses disruptive notify and requireAck true by default', async () => {
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'rem-3', dueAt: '2025-01-01T00:00:00Z', prompt: 'Ping' });

      await reminder({ prompt: 'Ping' }, createCtx());
      expect(mocks.scheduleDeferredResume).toHaveBeenCalledWith(
        expect.objectContaining({
          notify: 'disruptive',
          requireAck: true,
          autoResumeIfOpen: true,
        }),
      );
    });

    it('invalidates sessions and runs topics', async () => {
      const invalidate = vi.fn();
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'rem-4', dueAt: '2025-01-01T00:00:00Z', prompt: 'Ping' });

      await reminder({ prompt: 'Ping' }, createCtx({ ui: { invalidate } }));
      expect(invalidate).toHaveBeenCalledWith(['sessions', 'runs']);
    });

    it('throws when sessionFile is missing', async () => {
      await expect(reminder({ prompt: 'Wake up!' }, createCtx({ toolContext: { sessionId: 'sess-1' } }))).rejects.toThrow(
        'Reminder requires a persisted session file',
      );
    });
  });

  describe('conversationQueue handler', () => {
    it('requires trigger for add action', async () => {
      await expect(conversationQueue({ action: 'add' } as never, createCtx())).rejects.toThrow('trigger is required');
    });

    it('throws for cancel action without id', async () => {
      await expect(conversationQueue({ action: 'cancel' } as never, createCtx())).rejects.toThrow('id is required');
    });

    it('schedules time-based queue entries as visible deferred resumes', async () => {
      const invalidate = vi.fn();
      mocks.parseDeferredResumeDelayMs.mockReturnValue(4 * 60 * 60 * 1000);
      mocks.scheduleDeferredResume.mockResolvedValue({ id: 'resume-1', dueAt: '2025-01-01T04:00:00.000Z', prompt: 'Keep going' });

      const result = await conversationQueue(
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
          source: { kind: 'conversation-queue-tool' },
        }),
      );
      expect(invalidate).toHaveBeenCalledWith(['sessions', 'runs']);
    });

    it('throws for unsupported action', async () => {
      await expect(conversationQueue({ action: 'unknown' } as never, createCtx())).rejects.toThrow('Unsupported conversation queue action');
    });

    it('throws for invalid trigger value', async () => {
      await expect(conversationQueue({ action: 'add', prompt: 'Do thing', trigger: 'invalid' } as never, createCtx())).rejects.toThrow(
        'trigger',
      );
    });
  });
});
