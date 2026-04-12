import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationQueueAgentExtension } from './conversationQueueAgentExtension.js';

const {
  scheduleDeferredResumeForSessionFileMock,
  listDeferredResumesForSessionFileMock,
  cancelDeferredResumeForSessionFileMock,
  listQueuedPromptPreviewsMock,
  promptSessionMock,
  cancelQueuedPromptMock,
  publishAppEventMock,
} = vi.hoisted(() => ({
  scheduleDeferredResumeForSessionFileMock: vi.fn(),
  listDeferredResumesForSessionFileMock: vi.fn(),
  cancelDeferredResumeForSessionFileMock: vi.fn(),
  listQueuedPromptPreviewsMock: vi.fn(),
  promptSessionMock: vi.fn(),
  cancelQueuedPromptMock: vi.fn(),
  publishAppEventMock: vi.fn(),
}));

vi.mock('../automation/deferredResumes.js', () => ({
  DEFAULT_DEFERRED_RESUME_PROMPT: 'Continue from where you left off and keep going.',
  scheduleDeferredResumeForSessionFile: scheduleDeferredResumeForSessionFileMock,
  listDeferredResumesForSessionFile: listDeferredResumesForSessionFileMock,
  cancelDeferredResumeForSessionFile: cancelDeferredResumeForSessionFileMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  listQueuedPromptPreviews: listQueuedPromptPreviewsMock,
  promptSession: promptSessionMock,
  cancelQueuedPrompt: cancelQueuedPromptMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  publishAppEvent: publishAppEventMock,
}));

type RegisteredTool = {
  promptGuidelines?: string[];
  execute: (...args: unknown[]) => Promise<{ isError?: boolean; content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
};

function registerConversationQueueTool(): RegisteredTool {
  let registeredTool: RegisteredTool | undefined;

  createConversationQueueAgentExtension()({
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
  scheduleDeferredResumeForSessionFileMock.mockReset();
  listDeferredResumesForSessionFileMock.mockReset();
  cancelDeferredResumeForSessionFileMock.mockReset();
  listQueuedPromptPreviewsMock.mockReset();
  promptSessionMock.mockReset();
  cancelQueuedPromptMock.mockReset();
  publishAppEventMock.mockReset();
  listQueuedPromptPreviewsMock.mockReturnValue({ steering: [], followUp: [] });
  listDeferredResumesForSessionFileMock.mockReturnValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('conversation queue agent extension', () => {
  it('registers guidance for follow-up queueing', () => {
    const tool = registerConversationQueueTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(guidelines).toContain('standalone task');
    expect(guidelines).toContain('trigger="after_turn"');
    expect(guidelines).toContain('trigger="delay" or trigger="at"');
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

  it('queues delayed continuation work through deferred resume state', async () => {
    scheduleDeferredResumeForSessionFileMock.mockResolvedValue({
      id: 'resume-1',
      prompt: 'Check the deployment again.',
      dueAt: '2026-04-12T12:10:00.000Z',
    });

    const tool = registerConversationQueueTool();
    const result = await tool.execute(
      'tool-1',
      { action: 'add', trigger: 'delay', delay: '10m', prompt: 'Check the deployment again.', deliverAs: 'followUp' },
      undefined,
      undefined,
      createToolContext(),
    );

    expect(scheduleDeferredResumeForSessionFileMock).toHaveBeenCalledWith({
      sessionFile: '/tmp/sessions/conv-123.jsonl',
      conversationId: 'conv-123',
      delay: '10m',
      prompt: 'Check the deployment again.',
      title: undefined,
      behavior: 'followUp',
    });
    expect(publishAppEventMock).toHaveBeenCalledWith({ type: 'session_meta_changed', sessionId: 'conv-123' });
    expect(result.content[0]?.text).toContain('Queued conversation continuation resume-1');
    expect(result.details).toMatchObject({
      action: 'add',
      trigger: 'delay',
      id: 'resume-1',
      dueAt: '2026-04-12T12:10:00.000Z',
      deliverAs: 'followUp',
    });
  });

  it('lists live queued prompts and deferred resumes together', async () => {
    listQueuedPromptPreviewsMock.mockReturnValue({
      steering: [{ id: 'steer-1', text: 'Adjust the plan first.', imageCount: 0 }],
      followUp: [{ id: 'follow-1', text: 'Keep going after this turn.', imageCount: 0 }],
    });
    listDeferredResumesForSessionFileMock.mockReturnValue([
      {
        id: 'resume-1',
        sessionFile: '/tmp/sessions/conv-123.jsonl',
        prompt: 'Check the logs in 10 minutes.',
        dueAt: '2026-04-12T12:10:00.000Z',
        createdAt: '2026-04-12T12:00:00.000Z',
        attempts: 0,
        status: 'scheduled',
        kind: 'continue',
        title: 'Check logs',
        delivery: { alertLevel: 'none', autoResumeIfOpen: true, requireAck: false },
      },
    ]);

    const tool = registerConversationQueueTool();
    const result = await tool.execute('tool-1', { action: 'list' }, undefined, undefined, createToolContext());

    expect(result.content[0]?.text).toContain('Conversation queue (3):');
    expect(result.content[0]?.text).toContain('live:steer:steer-1');
    expect(result.content[0]?.text).toContain('live:followUp:follow-1');
    expect(result.content[0]?.text).toContain('resume-1');
    expect(result.details?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'live:steer:steer-1', status: 'queued', trigger: 'after_turn' }),
      expect.objectContaining({ id: 'resume-1', status: 'scheduled', trigger: 'time' }),
    ]));
  });

  it('cancels queued live prompts and deferred resumes by id', async () => {
    cancelQueuedPromptMock.mockResolvedValue({ id: 'follow-1', text: 'Keep going after this turn.', imageCount: 0 });
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
