import { describe, expect, it, vi } from 'vitest';
import { finalizeLiveSessionBashExecution } from './liveSessionBashFinalization.js';
import type { LiveSessionBashFinalizationHost } from './liveSessionBashFinalization.js';

function createMockEntry(overrides?: Partial<LiveSessionBashFinalizationHost>): LiveSessionBashFinalizationHost {
  return {
    sessionId: 'test-session-1',
    session: {
      isStreaming: false,
      sessionName: '',
      getSessionStats: vi.fn().mockReturnValue({ tokens: 42, cost: 0.01 }),
    } as unknown as LiveSessionBashFinalizationHost['session'],
    title: 'New conversation',
    ...overrides,
  };
}

function createMockCallbacks() {
  return {
    broadcastTitle: vi.fn(),
    broadcast: vi.fn(),
    clearContextUsageTimer: vi.fn(),
    broadcastContextUsage: vi.fn(),
    broadcastSnapshot: vi.fn(),
    publishSessionMetaChanged: vi.fn(),
  };
}

describe('finalizeLiveSessionBashExecution', () => {
  it('returns early when the session is still streaming', () => {
    const entry = createMockEntry({ session: { isStreaming: true, sessionName: '', getSessionStats: vi.fn() } as unknown as LiveSessionBashFinalizationHost['session'] });
    const callbacks = createMockCallbacks();

    finalizeLiveSessionBashExecution(entry, 'ls', callbacks);

    expect(callbacks.broadcastTitle).not.toHaveBeenCalled();
    expect(callbacks.broadcast).not.toHaveBeenCalled();
    expect(callbacks.clearContextUsageTimer).not.toHaveBeenCalled();
  });

  it('generates a fallback title when the session has no name and the title is a placeholder', () => {
    const entry = createMockEntry({
      title: 'New conversation',
      session: { isStreaming: false, sessionName: '', getSessionStats: vi.fn().mockReturnValue({ tokens: 42, cost: 0.01 }) } as unknown as LiveSessionBashFinalizationHost['session'],
    });
    const callbacks = createMockCallbacks();

    finalizeLiveSessionBashExecution(entry, 'npm install', callbacks);

    expect(entry.title).not.toBe('New conversation');
    expect(callbacks.broadcastTitle).toHaveBeenCalledWith(entry);
  });

  it('skips title generation when the session already has a name', () => {
    const entry = createMockEntry({
      title: 'Custom title',
      session: { isStreaming: false, sessionName: 'My Session', getSessionStats: vi.fn().mockReturnValue({ tokens: 42, cost: 0.01 }) } as unknown as LiveSessionBashFinalizationHost['session'],
    });
    const callbacks = createMockCallbacks();

    finalizeLiveSessionBashExecution(entry, 'ls', callbacks);

    expect(entry.title).toBe('Custom title');
    expect(callbacks.broadcastTitle).not.toHaveBeenCalled();
  });

  it('skips title generation when the title is not a placeholder', () => {
    const entry = createMockEntry({
      title: 'Debugging auth flow',
      session: { isStreaming: false, sessionName: '', getSessionStats: vi.fn().mockReturnValue({ tokens: 42, cost: 0.01 }) } as unknown as LiveSessionBashFinalizationHost['session'],
    });
    const callbacks = createMockCallbacks();

    finalizeLiveSessionBashExecution(entry, 'kubectl get pods', callbacks);

    expect(entry.title).toBe('Debugging auth flow');
    expect(callbacks.broadcastTitle).not.toHaveBeenCalled();
  });

  it('broadcasts session stats after execution', () => {
    const getSessionStats = vi.fn().mockReturnValue({ tokens: 150, cost: 0.05 });
    const entry = createMockEntry({
      session: { isStreaming: false, sessionName: '', getSessionStats } as unknown as LiveSessionBashFinalizationHost['session'],
    });
    const callbacks = createMockCallbacks();

    finalizeLiveSessionBashExecution(entry, 'ls', callbacks);

    expect(callbacks.broadcast).toHaveBeenCalledWith(
      entry,
      { type: 'stats_update', tokens: 150, cost: 0.05 },
    );
  });

  it('handles session stats errors gracefully without crashing', () => {
    const getSessionStats = vi.fn().mockImplementation(() => { throw new Error('stats error'); });
    const entry = createMockEntry({
      session: { isStreaming: false, sessionName: '', getSessionStats } as unknown as LiveSessionBashFinalizationHost['session'],
    });
    const callbacks = createMockCallbacks();

    expect(() => finalizeLiveSessionBashExecution(entry, 'ls', callbacks)).not.toThrow();
  });

  it('calls all finalization callbacks after successful execution', () => {
    const entry = createMockEntry();
    const callbacks = createMockCallbacks();

    finalizeLiveSessionBashExecution(entry, 'echo hello', callbacks);

    expect(callbacks.clearContextUsageTimer).toHaveBeenCalledWith(entry);
    expect(callbacks.broadcastContextUsage).toHaveBeenCalledWith(entry, true);
    expect(callbacks.broadcastSnapshot).toHaveBeenCalledWith(entry);
    expect(callbacks.publishSessionMetaChanged).toHaveBeenCalledWith('test-session-1');
  });
});
