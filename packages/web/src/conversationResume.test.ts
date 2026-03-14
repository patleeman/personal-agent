import { describe, expect, it } from 'vitest';
import type { DurableRunRecord, MessageBlock } from './types';
import { didConversationStopMidTurn, didConversationStopWithError, getConversationResumeState, hasPendingConversationOperation } from './conversationResume';

function createRun(input: {
  status?: string;
  pendingOperation?: Record<string, unknown> | null;
}): DurableRunRecord {
  return {
    runId: 'conversation-live-conv-123',
    paths: {
      root: '/tmp/run',
      manifestPath: '/tmp/run/manifest.json',
      statusPath: '/tmp/run/status.json',
      checkpointPath: '/tmp/run/checkpoint.json',
      eventsPath: '/tmp/run/events.jsonl',
      outputLogPath: '/tmp/run/output.log',
      resultPath: '/tmp/run/result.json',
    },
    manifest: {
      version: 1,
      id: 'conversation-live-conv-123',
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt: '2026-03-13T12:00:00.000Z',
      spec: {},
      source: {
        type: 'web-live-session',
        id: 'conv-123',
        filePath: '/tmp/session.jsonl',
      },
    },
    status: {
      version: 1,
      runId: 'conversation-live-conv-123',
      status: input.status ?? 'waiting',
      createdAt: '2026-03-13T12:00:00.000Z',
      updatedAt: '2026-03-13T12:05:00.000Z',
      activeAttempt: 1,
    },
    checkpoint: {
      version: 1,
      runId: 'conversation-live-conv-123',
      updatedAt: '2026-03-13T12:05:00.000Z',
      payload: input.pendingOperation === undefined
        ? {}
        : input.pendingOperation === null
          ? { pendingOperation: null }
          : { pendingOperation: input.pendingOperation },
    },
    problems: [],
    recoveryAction: 'resume',
  };
}

describe('conversation resume helpers', () => {
  it('detects replayable pending prompt operations', () => {
    const run = createRun({
      status: 'interrupted',
      pendingOperation: {
        type: 'prompt',
        text: 'continue working',
        enqueuedAt: '2026-03-13T12:04:59.000Z',
      },
    });

    expect(hasPendingConversationOperation(run)).toBe(true);
  });

  it('marks interrupted runs as resumable', () => {
    const state = getConversationResumeState({
      run: createRun({
        status: 'interrupted',
        pendingOperation: {
          type: 'prompt',
          text: 'continue working',
          enqueuedAt: '2026-03-13T12:04:59.000Z',
        },
      }),
      isLiveSession: false,
    });

    expect(state).toMatchObject({
      canResume: true,
      mode: 'replay',
      reason: 'interrupted',
      actionLabel: 'resume',
    });
  });

  it('keeps the resume label when replay is not available', () => {
    const state = getConversationResumeState({
      run: createRun({ status: 'interrupted', pendingOperation: null }),
      isLiveSession: false,
    });

    expect(state).toMatchObject({
      canResume: true,
      mode: 'continue',
      reason: 'interrupted',
      actionLabel: 'resume',
    });
  });

  it('falls back to a generic continue action after a tail error', () => {
    const lastMessage: MessageBlock = {
      type: 'error',
      ts: '2026-03-13T12:05:00.000Z',
      message: 'The model returned an error before completing its response.',
    };

    const state = getConversationResumeState({
      run: createRun({ status: 'waiting' }),
      isLiveSession: false,
      lastMessage,
    });

    expect(state).toMatchObject({
      canResume: true,
      mode: 'continue',
      reason: 'error',
      actionLabel: 'resume',
    });
  });

  it('treats failed tool and subagent tails as recoverable error endings', () => {
    expect(didConversationStopWithError({
      type: 'tool_use',
      ts: '2026-03-13T12:05:00.000Z',
      tool: 'bash',
      input: { command: 'exit 1' },
      output: 'boom',
      status: 'error',
    })).toBe(true);

    expect(didConversationStopWithError({
      type: 'subagent',
      ts: '2026-03-13T12:05:00.000Z',
      name: 'review',
      prompt: 'check this',
      status: 'failed',
    })).toBe(true);
  });

  it('treats a tail trace block as an unfinished turn even when the durable run says waiting', () => {
    const lastMessage: MessageBlock = {
      type: 'tool_use',
      ts: '2026-03-13T12:05:00.000Z',
      tool: 'read',
      input: { path: 'packages/web/src/components/chat/ChatView.tsx' },
      output: 'some output',
      status: 'ok',
    };

    expect(didConversationStopMidTurn(lastMessage)).toBe(true);

    const state = getConversationResumeState({
      run: createRun({ status: 'waiting' }),
      isLiveSession: false,
      lastMessage,
    });

    expect(state).toMatchObject({
      canResume: true,
      mode: 'continue',
      reason: 'interrupted',
      actionLabel: 'resume',
    });
  });

  it('does not offer resume for ordinary live conversations', () => {
    const state = getConversationResumeState({
      run: createRun({ status: 'interrupted' }),
      isLiveSession: true,
    });

    expect(state.canResume).toBe(false);
  });

  it('offers resume for a live conversation that ended with an error', () => {
    const state = getConversationResumeState({
      run: createRun({ status: 'waiting' }),
      isLiveSession: true,
      lastMessage: {
        type: 'error',
        ts: '2026-03-13T12:05:00.000Z',
        message: 'The model returned an error before completing its response.',
      },
    });

    expect(state).toMatchObject({
      canResume: true,
      mode: 'continue',
      reason: 'error',
      actionLabel: 'resume',
    });
  });
});
