import { describe, expect, it } from 'vitest';

import type { LiveSessionReadHost } from './liveSessionReadApi.js';
import { computeLiveSessionRunning } from './liveSessionReadApi.js';

function makeEntry(overrides: Partial<LiveSessionReadHost> = {}): LiveSessionReadHost {
  return {
    cwd: '/repo',
    session: { isStreaming: false } as any,
    title: 'Test',
    activeHiddenTurnCustomType: null,
    pendingHiddenTurnCustomTypes: [],
    ...overrides,
  } as LiveSessionReadHost;
}

describe('computeLiveSessionRunning', () => {
  it('returns false when lastDurableRunState is waiting and no hidden turn is active', () => {
    expect(computeLiveSessionRunning(makeEntry({ lastDurableRunState: 'waiting' }))).toBe(false);
  });

  it('returns false when lastDurableRunState is waiting and session is not streaming', () => {
    expect(
      computeLiveSessionRunning(
        makeEntry({
          lastDurableRunState: 'waiting',
          session: { isStreaming: false } as any,
        }),
      ),
    ).toBe(false);
  });

  it('returns true during compaction even when the durable run is waiting', () => {
    expect(computeLiveSessionRunning(makeEntry({ isCompacting: true, lastDurableRunState: 'waiting' }))).toBe(true);
  });

  it('returns true when session.isStreaming is true and no hidden turn masks it', () => {
    expect(
      computeLiveSessionRunning(
        makeEntry({
          session: { isStreaming: true } as any,
          activeHiddenTurnCustomType: null,
        }),
      ),
    ).toBe(true);
  });

  it('returns true when session.isStreaming is true even if a stale hidden-turn marker exists', () => {
    expect(
      computeLiveSessionRunning(
        makeEntry({
          session: { isStreaming: true } as any,
          activeHiddenTurnCustomType: 'auto_mode',
        }),
      ),
    ).toBe(true);
  });

  it('returns false when lastDurableRunState is waiting but session.isStreaming has not cleared yet (race guard)', () => {
    // This simulates the agent_end → syncDurableConversationRun('waiting') race:
    // lastDurableRunState flips to 'waiting' synchronously but session.isStreaming
    // is still true because the Pi runtime hasn't called finishRun() yet.
    expect(
      computeLiveSessionRunning(
        makeEntry({
          session: { isStreaming: true } as any,
          lastDurableRunState: 'waiting',
        }),
      ),
    ).toBe(false);
  });

  it('ignores stale hidden-turn markers when the session is otherwise idle', () => {
    expect(
      computeLiveSessionRunning(
        makeEntry({
          session: { isStreaming: false } as any,
          lastDurableRunState: 'waiting',
          pendingHiddenTurnCustomTypes: ['auto_mode'],
          activeHiddenTurnCustomType: 'auto_mode',
        }),
      ),
    ).toBe(false);
  });

  it('returns true when lastDurableRunState is running', () => {
    expect(computeLiveSessionRunning(makeEntry({ lastDurableRunState: 'running' }))).toBe(true);
  });

  it('returns true when lastDurableRunState is recovering', () => {
    expect(computeLiveSessionRunning(makeEntry({ lastDurableRunState: 'recovering' }))).toBe(true);
  });

  it('returns true when both session.isStreaming and hidden turn are present', () => {
    expect(
      computeLiveSessionRunning(
        makeEntry({
          session: { isStreaming: true } as any,
          activeHiddenTurnCustomType: 'auto_mode',
        }),
      ),
    ).toBe(true);
  });

  it('returns false for an idle session with no lastDurableRunState set', () => {
    expect(computeLiveSessionRunning(makeEntry({ lastDurableRunState: undefined }))).toBe(false);
  });

  it('returns false when interrupted durable run only has a stale hidden-turn marker', () => {
    expect(
      computeLiveSessionRunning(
        makeEntry({
          lastDurableRunState: 'interrupted',
          activeHiddenTurnCustomType: 'auto_mode',
        }),
      ),
    ).toBe(false);
  });
});
