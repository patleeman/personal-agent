import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationQueueAgentExtension } from './conversationQueueAgentExtension.js';

const {
  createStoredAutomationMock,
  deleteStoredAutomationMock,
  listStoredAutomationsMock,
  loadAutomationRuntimeStateMapMock,
  loadDeferredResumeStateMock,
  getSessionDeferredResumeEntriesMock,
  parseDeferredResumeDelayMsMock,
  cancelDeferredResumeForSessionFileMock,
  applyScheduledTaskThreadBindingMock,
  listQueuedPromptPreviewsMock,
  promptSessionMock,
  cancelQueuedPromptMock,
  publishAppEventMock,
  invalidateAppTopicsMock,
} = vi.hoisted(() => ({
  createStoredAutomationMock: vi.fn(),
  deleteStoredAutomationMock: vi.fn(),
  listStoredAutomationsMock: vi.fn(),
  loadAutomationRuntimeStateMapMock: vi.fn(),
  loadDeferredResumeStateMock: vi.fn(),
  getSessionDeferredResumeEntriesMock: vi.fn(),
  parseDeferredResumeDelayMsMock: vi.fn(),
  cancelDeferredResumeForSessionFileMock: vi.fn(),
  applyScheduledTaskThreadBindingMock: vi.fn(),
  listQueuedPromptPreviewsMock: vi.fn(),
  promptSessionMock: vi.fn(),
  cancelQueuedPromptMock: vi.fn(),
  publishAppEventMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
}));

vi.mock('@personal-agent/daemon', () => ({
  createStoredAutomation: createStoredAutomationMock,
  deleteStoredAutomation: deleteStoredAutomationMock,
  listStoredAutomations: listStoredAutomationsMock,
  loadAutomationRuntimeStateMap: loadAutomationRuntimeStateMapMock,
}));

vi.mock('@personal-agent/core', () => ({
  loadDeferredResumeState: loadDeferredResumeStateMock,
  getSessionDeferredResumeEntries: getSessionDeferredResumeEntriesMock,
  parseDeferredResumeDelayMs: parseDeferredResumeDelayMsMock,
}));

vi.mock('../automation/deferredResumes.js', () => ({
  DEFAULT_DEFERRED_RESUME_PROMPT: 'Continue from where you left off and keep going.',
  cancelDeferredResumeForSessionFile: cancelDeferredResumeForSessionFileMock,
}));

vi.mock('../automation/scheduledTaskThreads.js', () => ({
  applyScheduledTaskThreadBinding: applyScheduledTaskThreadBindingMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  listQueuedPromptPreviews: listQueuedPromptPreviewsMock,
  promptSession: promptSessionMock,
  cancelQueuedPrompt: cancelQueuedPromptMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  publishAppEvent: publishAppEventMock,
  invalidateAppTopics: invalidateAppTopicsMock,
}));

type RegisteredTool = {
  promptGuidelines?: string[];
  execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
};

function registerConversationQueueTool(): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;

  createConversationQueueAgentExtension({
    getCurrentProfile: () => 'assistant',
  })({
    registerTool: (tool: unknown) => {
      registeredTool = tool as RegisteredTool;
    },
  } as never);

  if (!registeredTool) {
    throw new Error('Conversation queue tool was not registered.');
  }

  return registeredTool;
}

function createToolContext(conversationId = 'conv-123', sessionFile = '/tmp/sessions/conv-123.jsonl') {
  return {
    cwd: '/tmp/workspace',
    sessionManager: {
      getSessionId: () => conversationId,
      getSessionFile: () => sessionFile,
    },
  };
}

beforeEach(() => {
  createStoredAutomationMock.mockReset();
  deleteStoredAutomationMock.mockReset();
  listStoredAutomationsMock.mockReset();
  loadAutomationRuntimeStateMapMock.mockReset();
  loadDeferredResumeStateMock.mockReset();
  getSessionDeferredResumeEntriesMock.mockReset();
  parseDeferredResumeDelayMsMock.mockReset();
  cancelDeferredResumeForSessionFileMock.mockReset();
  applyScheduledTaskThreadBindingMock.mockReset();
  listQueuedPromptPreviewsMock.mockReset();
  promptSessionMock.mockReset();
  cancelQueuedPromptMock.mockReset();
  publishAppEventMock.mockReset();
  invalidateAppTopicsMock.mockReset();

  listQueuedPromptPreviewsMock.mockReturnValue({ steering: [], followUp: [] });
  listStoredAutomationsMock.mockReturnValue([]);
  loadAutomationRuntimeStateMapMock.mockReturnValue({});
  loadDeferredResumeStateMock.mockReturnValue({ resumes: {} });
  getSessionDeferredResumeEntriesMock.mockReturnValue([]);
  parseDeferredResumeDelayMsMock.mockImplementation((value: string) => {
    if (value === '10m') return 10 * 60 * 1000;
    return undefined;
  });
  createStoredAutomationMock.mockImplementation((input: Record<string, unknown>) => ({
    id: 'queue-automation',
    title: input.title,
    prompt: input.prompt,
    targetType: 'conversation',
    schedule: { type: 'at', at: input.at },
    threadSessionFile: undefined,
  }));
  applyScheduledTaskThreadBindingMock.mockImplementation((taskId: string) => ({
    id: taskId,
    prompt: 'Check the deployment again.',
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('conversation queue agent extension', () => {
  it('registers guidance for follow-up queueing', () => {
    const tool = registerConversationQueueTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(guidelines).toContain('standalone task');
    expect(guidelines).toContain('trigger="after_turn"');
    expect(guidelines).toContain('saved automations');
  });

  it('queues after-turn work onto the live follow-up queue', async () => {
    const tool = registerConversationQueueTool();

    const result = await tool.execute(
      'tool-1',
      { action: 'add', trigger: 'after_turn', prompt: 'Check the fresh logs after this reply finishes.' },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(promptSessionMock).toHaveBeenCalledWith(
      'conv-123',
      'Check the fresh logs after this reply finishes.',
      'followUp',
    );
    expect(result.content[0]?.text).toContain('Queued conversation continuation after the current turn');
    expect(result.details).toMatchObject({
      action: 'add',
      trigger: 'after_turn',
      sessionId: 'conv-123',
      deliverAs: 'followUp',
    });
  });

  it('queues delayed continuation work as a saved automation', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T12:00:00Z'));
    createStoredAutomationMock.mockReturnValue({
      id: 'resume-later',
      title: 'Check deployment',
      prompt: 'Check the deployment again.',
      targetType: 'conversation',
      schedule: { type: 'at', at: '2026-04-12T12:10:00.000Z' },
      threadSessionFile: '/tmp/sessions/conv-123.jsonl',
    });
    applyScheduledTaskThreadBindingMock.mockReturnValue({ id: 'resume-later', prompt: 'Check the deployment again.' });

    const tool = registerConversationQueueTool();
    const result = await tool.execute(
      'tool-1',
      { action: 'add', trigger: 'delay', delay: '10m', prompt: 'Check the deployment again.', deliverAs: 'followUp', title: 'Check deployment' },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(createStoredAutomationMock).toHaveBeenCalledWith({
      profile: 'assistant',
      title: 'Check deployment',
      enabled: true,
      at: '2026-04-12T12:10:00.000Z',
      prompt: 'Check the deployment again.',
      cwd: '/tmp/workspace',
      targetType: 'conversation',
      conversationBehavior: 'followUp',
    });
    expect(applyScheduledTaskThreadBindingMock).toHaveBeenCalledWith('resume-later', {
      threadMode: 'existing',
      threadConversationId: 'conv-123',
      threadSessionFile: '/tmp/sessions/conv-123.jsonl',
      cwd: '/tmp/workspace',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');
    expect(publishAppEventMock).toHaveBeenCalledWith({ type: 'session_meta_changed', sessionId: 'conv-123' });
    expect(result.content[0]?.text).toContain('Queued conversation continuation resume-later');
    expect(result.details).toMatchObject({
      action: 'add',
      trigger: 'delay',
      id: 'resume-later',
      dueAt: '2026-04-12T12:10:00.000Z',
      deliverAs: 'followUp',
    });
  });

  it('rejects malformed absolute continuation times', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T12:00:00Z'));

    const tool = registerConversationQueueTool();
    await expect(tool.execute(
      'tool-1',
      { action: 'add', trigger: 'at', at: '9999', prompt: 'Check the deployment again.' },
      undefined,
      undefined,
      createToolContext(),
    )).rejects.toThrow('Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.');

    expect(createStoredAutomationMock).not.toHaveBeenCalled();
  });

  it('lists live queued prompts, saved automations, and deferred resumes together', async () => {
    listQueuedPromptPreviewsMock.mockReturnValue({
      steering: [{ id: 'steer-1', text: 'Adjust the plan first.', imageCount: 0 }],
      followUp: [{ id: 'follow-1', text: 'Keep going after this turn.', imageCount: 0 }],
    });
    listStoredAutomationsMock.mockReturnValue([
      {
        id: 'resume-later',
        title: 'Check deployment',
        prompt: 'Check the deployment again.',
        targetType: 'conversation',
        schedule: { type: 'at', at: '2026-04-12T12:10:00.000Z' },
        threadSessionFile: '/tmp/sessions/conv-123.jsonl',
        conversationBehavior: 'followUp',
      },
    ]);
    getSessionDeferredResumeEntriesMock.mockReturnValue([
      {
        id: 'resume-1',
        sessionFile: '/tmp/sessions/conv-123.jsonl',
        prompt: 'Check the logs in 10 minutes.',
        dueAt: '2026-04-12T12:10:00.000Z',
        createdAt: '2026-04-12T12:00:00.000Z',
        attempts: 0,
        status: 'ready',
        readyAt: '2026-04-12T12:10:00.000Z',
        kind: 'continue',
        title: 'Check logs',
        behavior: 'followUp',
        delivery: { alertLevel: 'passive', autoResumeIfOpen: true, requireAck: false },
      },
    ]);

    const tool = registerConversationQueueTool();
    const result = await tool.execute('tool-1', { action: 'list' }, undefined, undefined, createToolContext());

    expect(result.content[0]?.text).toContain('Conversation queue (4):');
    expect(result.content[0]?.text).toContain('live:steer:steer-1');
    expect(result.content[0]?.text).toContain('live:followUp:follow-1');
    expect(result.content[0]?.text).toContain('resume-later');
    expect(result.content[0]?.text).toContain('resume-1');
    expect(result.details?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'live:steer:steer-1', status: 'queued', trigger: 'after_turn' }),
      expect.objectContaining({ id: 'resume-later', source: 'automation', status: 'scheduled', trigger: 'time' }),
      expect.objectContaining({ id: 'resume-1', source: 'deferred-resume', status: 'ready', trigger: 'time' }),
    ]));
  });

  it('cancels queued live prompts, saved automations, and deferred resumes by id', async () => {
    cancelQueuedPromptMock.mockResolvedValue({ id: 'follow-1', text: 'Keep going after this turn.', imageCount: 0 });
    listStoredAutomationsMock.mockReturnValue([
      {
        id: 'resume-later',
        title: 'Check deployment',
        prompt: 'Check the deployment again.',
        targetType: 'conversation',
        schedule: { type: 'at', at: '2026-04-12T12:10:00.000Z' },
        threadSessionFile: '/tmp/sessions/conv-123.jsonl',
      },
    ]);
    cancelDeferredResumeForSessionFileMock.mockResolvedValue({ id: 'resume-1', prompt: 'Check later.' });
    const tool = registerConversationQueueTool();

    const liveResult = await tool.execute(
      'tool-1',
      { action: 'cancel', id: 'live:followUp:follow-1' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(cancelQueuedPromptMock).toHaveBeenCalledWith('conv-123', 'followUp', 'follow-1');
    expect(liveResult.content[0]?.text).toContain('Cancelled queued followUp continuation.');

    const automationResult = await tool.execute(
      'tool-1',
      { action: 'cancel', id: 'resume-later' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(deleteStoredAutomationMock).toHaveBeenCalledWith('resume-later');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('tasks');
    expect(automationResult.content[0]?.text).toContain('Cancelled queued continuation resume-later.');

    const deferredResult = await tool.execute(
      'tool-1',
      { action: 'cancel', id: 'resume-1' },
      undefined,
      undefined,
      createToolContext(),
    );
    expect(cancelDeferredResumeForSessionFileMock).toHaveBeenCalledWith({
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      id: 'resume-1',
    });
    expect(deferredResult.content[0]?.text).toContain('Cancelled queued continuation resume-1.');
  });
});
