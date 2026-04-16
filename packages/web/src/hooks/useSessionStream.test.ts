import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageBlock } from '../shared/types';
import type { StreamState } from './useSessionStream';
import {
  applyEvent,
  INITIAL_STREAM_STATE,
  normalizePendingQueueItems,
  retryLiveSessionActionAfterTakeover,
  submitLivePromptWithControlRetry,
  waitForSurfaceRegistration,
} from './useSessionStream';

describe('applyEvent cwd changes', () => {
  it('stores pending working-directory redirects from the live stream', () => {
    const state = applyEvent(
      INITIAL_STREAM_STATE,
      { current: [] as MessageBlock[] },
      { current: false },
      {
        type: 'cwd_changed',
        newConversationId: 'conv-next',
        cwd: '/tmp/next-repo',
        autoContinued: true,
      },
    );

    expect(state.cwdChange).toEqual({
      newConversationId: 'conv-next',
      cwd: '/tmp/next-repo',
      autoContinued: true,
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForSurfaceRegistration', () => {
  it('returns immediately when the surface is already present', async () => {
    const reconnect = vi.fn();

    await expect(waitForSurfaceRegistration({
      surfaceId: 'surface-1',
      hasSurface: () => true,
      reconnect,
    })).resolves.toBe(true);

    expect(reconnect).not.toHaveBeenCalled();
  });

  it('nudges a reconnect and waits for the surface to appear', async () => {
    vi.useFakeTimers();
    let connected = false;
    const reconnect = vi.fn();

    const waiting = waitForSurfaceRegistration({
      surfaceId: 'surface-1',
      hasSurface: () => connected,
      reconnect,
      timeoutMs: 200,
      pollMs: 25,
    });

    expect(reconnect).toHaveBeenCalledTimes(1);

    setTimeout(() => {
      connected = true;
    }, 60);

    await vi.advanceTimersByTimeAsync(100);
    await expect(waiting).resolves.toBe(true);
  });

  it('returns false when the surface never reconnects', async () => {
    vi.useFakeTimers();

    const waiting = waitForSurfaceRegistration({
      surfaceId: 'surface-1',
      hasSurface: () => false,
      timeoutMs: 100,
      pollMs: 25,
    });

    await vi.advanceTimersByTimeAsync(125);
    await expect(waiting).resolves.toBe(false);
  });
});

describe('retryLiveSessionActionAfterTakeover', () => {
  it('retries generic live-session actions after taking over on control errors', async () => {
    const attemptAction = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('This conversation is controlled by another surface. Take over here to continue.'))
      .mockResolvedValueOnce('ok');
    const takeOver = vi.fn(async () => undefined);

    await expect(retryLiveSessionActionAfterTakeover({
      attemptAction,
      takeOverSessionControl: takeOver,
    })).resolves.toBe('ok');

    expect(attemptAction).toHaveBeenCalledTimes(2);
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it('does not retry unrelated live-session action failures', async () => {
    const error = new Error('provider unavailable');
    const attemptAction = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const takeOver = vi.fn(async () => undefined);

    await expect(retryLiveSessionActionAfterTakeover({
      attemptAction,
      takeOverSessionControl: takeOver,
    })).rejects.toBe(error);

    expect(attemptAction).toHaveBeenCalledTimes(1);
    expect(takeOver).not.toHaveBeenCalled();
  });
});

describe('submitLivePromptWithControlRetry', () => {
  it('retries after reconnecting and taking over on control errors', async () => {
    const attemptPrompt = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('This conversation is controlled by another surface. Take over here to continue.'))
      .mockResolvedValueOnce(undefined);
    const waitForRegistration = vi.fn(async () => true);
    const takeOver = vi.fn(async () => undefined);

    await expect(submitLivePromptWithControlRetry({
      attemptPrompt,
      waitForSurfaceRegistration: waitForRegistration,
      takeOverSessionControl: takeOver,
    })).resolves.toBeUndefined();

    expect(attemptPrompt).toHaveBeenCalledTimes(2);
    expect(waitForRegistration).toHaveBeenCalledTimes(1);
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original control error when the surface never comes back', async () => {
    const error = new Error('This conversation is controlled by another surface. Take over here to continue.');
    const attemptPrompt = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const waitForRegistration = vi.fn(async () => false);
    const takeOver = vi.fn(async () => undefined);

    await expect(submitLivePromptWithControlRetry({
      attemptPrompt,
      waitForSurfaceRegistration: waitForRegistration,
      takeOverSessionControl: takeOver,
    })).rejects.toBe(error);

    expect(attemptPrompt).toHaveBeenCalledTimes(1);
    expect(takeOver).not.toHaveBeenCalled();
  });

  it('does not retry unrelated prompt failures', async () => {
    const error = new Error('provider unavailable');
    const attemptPrompt = vi.fn<() => Promise<void>>().mockRejectedValueOnce(error);
    const waitForRegistration = vi.fn(async () => true);
    const takeOver = vi.fn(async () => undefined);

    await expect(submitLivePromptWithControlRetry({
      attemptPrompt,
      waitForSurfaceRegistration: waitForRegistration,
      takeOverSessionControl: takeOver,
    })).rejects.toBe(error);

    expect(waitForRegistration).not.toHaveBeenCalled();
    expect(takeOver).not.toHaveBeenCalled();
  });
});

describe('normalizePendingQueueItems', () => {
  it('normalizes string queue entries into structured previews', () => {
    expect(normalizePendingQueueItems(['first', 2, null, 'second'])).toEqual([
      { id: expect.any(String), text: 'first', imageCount: 0, restorable: false },
      { id: expect.any(String), text: 'second', imageCount: 0, restorable: false },
    ]);
  });

  it('preserves structured queue previews from the server', () => {
    expect(normalizePendingQueueItems([{ id: 'steer-0', text: 'draft', imageCount: 1 }])).toEqual([
      { id: 'steer-0', text: 'draft', imageCount: 1 },
    ]);
  });

  it('keeps image-only queue previews empty so the UI can render attachment chrome separately', () => {
    expect(normalizePendingQueueItems([{ id: 'steer-1', text: '', imageCount: 2 }])).toEqual([
      { id: 'steer-1', text: '', imageCount: 2 },
    ]);
  });

  it('falls back to an empty queue for non-array payloads', () => {
    expect(normalizePendingQueueItems(undefined)).toEqual([]);
    expect(normalizePendingQueueItems({ steering: ['bad-shape'] })).toEqual([]);
  });
});

describe('applyEvent', () => {
  it('clears stale streaming state when a fresh snapshot arrives after reconnect', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      blocks: [{ type: 'text', ts: '2026-03-25T00:00:00.000Z', text: 'partial response' }],
      isStreaming: true,
      error: 'stale error',
    };
    const blocksRef = { current: state.blocks };
    const streamingRef = { current: true };

    const next = applyEvent(state, blocksRef, streamingRef, {
      type: 'snapshot',
      blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-03-25T00:00:01.000Z', text: 'finished response' }],
      blockOffset: 0,
      totalBlocks: 1,
    });

    expect(next.isStreaming).toBe(false);
    expect(streamingRef.current).toBe(false);
    expect(next.error).toBeNull();
    expect(next.blocks).toEqual([{ type: 'text', id: 'assistant-1', ts: '2026-03-25T00:00:01.000Z', text: 'finished response' }]);
    expect(blocksRef.current).toEqual(next.blocks);
  });

  it('marks direct bang bash executions for terminal-style rendering', () => {
    let state: StreamState = {
      ...INITIAL_STREAM_STATE,
    };
    const blocksRef = { current: state.blocks };
    const streamingRef = { current: false };

    state = applyEvent(state, blocksRef, streamingRef, {
      type: 'tool_start',
      toolCallId: 'user-bash-1',
      toolName: 'bash',
      args: {
        command: 'npm run release:publish',
        displayMode: 'terminal',
        excludeFromContext: true,
      },
    });

    state = applyEvent(state, blocksRef, streamingRef, {
      type: 'tool_end',
      toolCallId: 'user-bash-1',
      toolName: 'bash',
      isError: true,
      durationMs: 42,
      output: '/bin/bash: npm: command not found',
      details: {
        displayMode: 'terminal',
        exitCode: 127,
        excludeFromContext: true,
      },
    });

    expect(state.blocks).toEqual([
      {
        type: 'tool_use',
        tool: 'bash',
        input: {
          command: 'npm run release:publish',
          displayMode: 'terminal',
          excludeFromContext: true,
        },
        output: '/bin/bash: npm: command not found',
        status: 'error',
        durationMs: 42,
        details: {
          displayMode: 'terminal',
          exitCode: 127,
          excludeFromContext: true,
        },
        ts: expect.any(String),
        _toolCallId: 'user-bash-1',
      },
    ]);
  });
});

