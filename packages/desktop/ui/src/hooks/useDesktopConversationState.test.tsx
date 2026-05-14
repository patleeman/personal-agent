// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeDesktopConversationStateTailBlocks, useDesktopConversationState } from './useDesktopConversationState.js';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];
let latestReconnect: (() => void) | null = null;

function HookProbe() {
  latestReconnect = useDesktopConversationState('conv-1', { tailBlocks: 20 }).reconnect;
  return null;
}

function flushPromises() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

describe('normalizeDesktopConversationStateTailBlocks', () => {
  it('drops unsafe desktop conversation tail block limits', () => {
    expect(normalizeDesktopConversationStateTailBlocks(20)).toBe(20);
    expect(normalizeDesktopConversationStateTailBlocks(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it('caps expensive desktop conversation tail block limits', () => {
    expect(normalizeDesktopConversationStateTailBlocks(50000)).toBe(10000);
  });
});

describe('useDesktopConversationState', () => {
  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => root.unmount());
    }
    latestReconnect = null;
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'personalAgentDesktop');
  });

  it('resubscribes when reconnect is requested after a same-conversation cwd change', async () => {
    let nextSubscriptionId = 0;
    const subscribeConversationState = vi.fn().mockImplementation(() => {
      nextSubscriptionId += 1;
      return Promise.resolve({ subscriptionId: `sub-${nextSubscriptionId}` });
    });
    const unsubscribeConversationState = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(window, 'personalAgentDesktop', {
      configurable: true,
      value: {
        getEnvironment: vi.fn().mockResolvedValue({ activeHostKind: 'local' }),
        subscribeConversationState,
        unsubscribeConversationState,
      },
    });

    const root = createRoot(document.createElement('div'));
    mountedRoots.push(root);

    await act(async () => {
      root.render(<HookProbe />);
      await flushPromises();
      await flushPromises();
    });

    const initialSubscribeCount = subscribeConversationState.mock.calls.length;
    expect(initialSubscribeCount).toBeGreaterThan(0);
    expect(subscribeConversationState).toHaveBeenLastCalledWith({
      conversationId: 'conv-1',
      tailBlocks: 20,
      surfaceId: expect.any(String),
      surfaceType: 'desktop_web',
    });

    await act(async () => {
      latestReconnect?.();
      await flushPromises();
      await flushPromises();
    });

    expect(subscribeConversationState).toHaveBeenCalledTimes(initialSubscribeCount + 1);
    expect(unsubscribeConversationState).toHaveBeenCalledWith(`sub-${initialSubscribeCount}`);
  });
});
