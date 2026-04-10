import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelDeferredResumeForSessionFileMock,
  fireDeferredResumeNowForSessionFileMock,
  listDeferredResumesForSessionFileMock,
  publishConversationSessionMetaChangedMock,
  resolveConversationSessionFileMock,
  scheduleDeferredResumeForSessionFileMock,
} = vi.hoisted(() => ({
  cancelDeferredResumeForSessionFileMock: vi.fn(),
  fireDeferredResumeNowForSessionFileMock: vi.fn(),
  listDeferredResumesForSessionFileMock: vi.fn(),
  publishConversationSessionMetaChangedMock: vi.fn(),
  resolveConversationSessionFileMock: vi.fn(),
  scheduleDeferredResumeForSessionFileMock: vi.fn(),
}));

vi.mock('../automation/deferredResumes.js', () => ({
  cancelDeferredResumeForSessionFile: cancelDeferredResumeForSessionFileMock,
  fireDeferredResumeNowForSessionFile: fireDeferredResumeNowForSessionFileMock,
  listDeferredResumesForSessionFile: listDeferredResumesForSessionFileMock,
  scheduleDeferredResumeForSessionFile: scheduleDeferredResumeForSessionFileMock,
}));

vi.mock('./conversationService.js', () => ({
  publishConversationSessionMetaChanged: publishConversationSessionMetaChangedMock,
  resolveConversationSessionFile: resolveConversationSessionFileMock,
}));

import {
  ConversationDeferredResumeCapabilityNotFoundError,
  cancelConversationDeferredResumeCapability,
  fireConversationDeferredResumeCapability,
  readConversationDeferredResumesCapability,
  scheduleConversationDeferredResumeCapability,
} from './conversationDeferredResumeCapability.js';

beforeEach(() => {
  cancelDeferredResumeForSessionFileMock.mockReset();
  fireDeferredResumeNowForSessionFileMock.mockReset();
  listDeferredResumesForSessionFileMock.mockReset();
  publishConversationSessionMetaChangedMock.mockReset();
  resolveConversationSessionFileMock.mockReset();
  scheduleDeferredResumeForSessionFileMock.mockReset();

  resolveConversationSessionFileMock.mockReturnValue('/sessions/conversation-1.jsonl');
  listDeferredResumesForSessionFileMock.mockReturnValue([{ id: 'resume-1' }]);
  scheduleDeferredResumeForSessionFileMock.mockResolvedValue({ id: 'resume-2', delay: '5m' });
  fireDeferredResumeNowForSessionFileMock.mockResolvedValue({ id: 'resume-1', fired: true });
});

describe('conversationDeferredResumeCapability', () => {
  it('reads deferred resumes for a saved conversation', () => {
    expect(readConversationDeferredResumesCapability(' conversation-1 ')).toEqual({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1' }],
    });
    expect(resolveConversationSessionFileMock).toHaveBeenCalledWith('conversation-1');
    expect(listDeferredResumesForSessionFileMock).toHaveBeenCalledWith('/sessions/conversation-1.jsonl');
  });

  it('throws a not-found error when the conversation session file cannot be resolved', async () => {
    resolveConversationSessionFileMock.mockReturnValue(undefined);

    expect(() => readConversationDeferredResumesCapability('conversation-missing')).toThrow(ConversationDeferredResumeCapabilityNotFoundError);
    await expect(scheduleConversationDeferredResumeCapability({ conversationId: 'conversation-missing', delay: '5m' })).rejects.toThrow(ConversationDeferredResumeCapabilityNotFoundError);
  });

  it('schedules deferred resumes and validates the delay input', async () => {
    await expect(scheduleConversationDeferredResumeCapability({ conversationId: 'conversation-1' })).rejects.toThrow('delay is required');

    await expect(scheduleConversationDeferredResumeCapability({
      conversationId: 'conversation-1',
      delay: ' 5m ',
      prompt: 'Follow up later.',
    })).resolves.toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', delay: '5m' },
      resumes: [{ id: 'resume-1' }],
    });
    expect(scheduleDeferredResumeForSessionFileMock).toHaveBeenCalledWith({
      sessionFile: '/sessions/conversation-1.jsonl',
      delay: '5m',
      prompt: 'Follow up later.',
    });
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-1');
  });

  it('cancels deferred resumes and refreshes the conversation snapshot', async () => {
    await expect(cancelConversationDeferredResumeCapability({
      conversationId: 'conversation-1',
      resumeId: 'resume-1',
    })).resolves.toEqual({
      conversationId: 'conversation-1',
      cancelledId: 'resume-1',
      resumes: [{ id: 'resume-1' }],
    });
    expect(cancelDeferredResumeForSessionFileMock).toHaveBeenCalledWith({
      sessionFile: '/sessions/conversation-1.jsonl',
      id: 'resume-1',
    });
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-1');
  });

  it('fires deferred resumes immediately and flushes live resumes when requested', async () => {
    const flushLiveDeferredResumes = vi.fn().mockResolvedValue(undefined);

    await expect(fireConversationDeferredResumeCapability({
      conversationId: 'conversation-1',
      resumeId: 'resume-1',
      flushLiveDeferredResumes,
    })).resolves.toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-1', fired: true },
      resumes: [{ id: 'resume-1' }],
    });
    expect(fireDeferredResumeNowForSessionFileMock).toHaveBeenCalledWith({
      sessionFile: '/sessions/conversation-1.jsonl',
      id: 'resume-1',
    });
    expect(flushLiveDeferredResumes).toHaveBeenCalledTimes(1);
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-1');
  });
});
