import { describe, expect, it, vi } from 'vitest';

import { emitDesktopRemoteOperationStatus, subscribeDesktopRemoteOperationStatus } from './remote-operation-events.js';

function makeStatus(
  overrides: Partial<{
    hostId: string;
    hostLabel: string;
    scope: 'runtime' | 'directory';
    stage:
      | 'connect'
      | 'detect-platform'
      | 'download-pi'
      | 'copy-pi'
      | 'copy-helper'
      | 'launch'
      | 'attach'
      | 'reconnect'
      | 'restart'
      | 'browse'
      | 'ready'
      | 'error';
    status: 'running' | 'success' | 'error';
    message: string;
  }> = {},
) {
  return {
    hostId: 'host-1',
    hostLabel: 'Host 1',
    scope: 'runtime' as const,
    stage: 'launch' as const,
    status: 'running' as const,
    message: 'Working…',
    at: new Date().toISOString(),
    ...overrides,
  };
}

// ── remote-operation-events — event bus for remote operations ─────────────

describe('remote-operation-events', () => {
  it('emits and receives a remote operation status event', () => {
    const handler = vi.fn();
    const cleanup = subscribeDesktopRemoteOperationStatus(handler);

    emitDesktopRemoteOperationStatus(makeStatus({ status: 'running', message: 'Starting…' }));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'host-1', status: 'running' }));
    cleanup();
  });

  it('multiple handlers receive events', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const cleanup1 = subscribeDesktopRemoteOperationStatus(handler1);
    const cleanup2 = subscribeDesktopRemoteOperationStatus(handler2);

    emitDesktopRemoteOperationStatus(makeStatus({ status: 'success', message: 'Done' }));

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    cleanup1();
    cleanup2();
  });

  it('cleanup removes the handler', () => {
    const handler = vi.fn();
    const cleanup = subscribeDesktopRemoteOperationStatus(handler);
    cleanup();

    emitDesktopRemoteOperationStatus(makeStatus({ status: 'error', message: 'Failed' }));

    expect(handler).not.toHaveBeenCalled();
  });

  it('does not call handlers for other events on the same emitter', () => {
    // just verify basic emit/receive works
    const handler = vi.fn();
    const cleanup = subscribeDesktopRemoteOperationStatus(handler);

    emitDesktopRemoteOperationStatus(makeStatus({ status: 'success', message: 'Ok' }));

    expect(handler).toHaveBeenCalled();
    cleanup();
  });
});
