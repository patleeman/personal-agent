// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WorkbenchBrowserTab } from './Layout';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('WorkbenchBrowserTab', () => {
  let root: Root | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
      root = null;
    }
    delete window.personalAgentDesktop;
    vi.restoreAllMocks();
  });

  it('keeps the embedded browser alive when a draft conversation becomes saved', async () => {
    const setWorkbenchBrowserBounds = vi.fn(async () => ({
      url: 'https://example.com/',
      title: 'Example',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      browserRevision: 1,
      snapshotRevision: 0,
      changedSinceSnapshot: true,
    }));
    window.personalAgentDesktop = { setWorkbenchBrowserBounds } as unknown as typeof window.personalAgentDesktop;

    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, top: 30, width: 640, height: 480, right: 660, bottom: 510, x: 20, y: 30, toJSON: () => ({}) }),
    });

    root = createRoot(container);
    act(() => {
      root?.render(<WorkbenchBrowserTab conversationId={null} onClose={() => undefined} />);
    });
    await flushAsyncWork();

    act(() => {
      root?.render(<WorkbenchBrowserTab conversationId="conversation-1" onClose={() => undefined} />);
    });
    await flushAsyncWork();

    expect(setWorkbenchBrowserBounds).toHaveBeenCalledWith(expect.objectContaining({ visible: true, sessionKey: 'conversation-1' }));
  });
});
