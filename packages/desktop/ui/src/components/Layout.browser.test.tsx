// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BrowserTabItem, type BrowserTabsState, readBrowserTabsState } from '../local/workbenchBrowserTabs';
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

  it('uses a global session key independent of conversation', async () => {
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
    const navigateWorkbenchBrowser = vi.fn(async (input: { url: string; sessionKey?: string | null }) => ({
      url: input.url,
      title: 'Loaded',
      loading: false,
      canGoBack: false,
      canGoForward: false,
      browserRevision: 1,
      snapshotRevision: 0,
      changedSinceSnapshot: true,
    }));
    const browserTabsState: BrowserTabsState = readBrowserTabsState();
    const activeBrowserTab: BrowserTabItem =
      browserTabsState.tabs.find((t) => t.id === browserTabsState.activeTabId) ?? browserTabsState.tabs[0]!;

    window.personalAgentDesktop = { setWorkbenchBrowserBounds, navigateWorkbenchBrowser } as unknown as typeof window.personalAgentDesktop;

    const container = document.createElement('div');
    document.body.appendChild(container);
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, top: 30, width: 640, height: 480, right: 660, bottom: 510, x: 20, y: 30, toJSON: () => ({}) }),
    });

    root = createRoot(container);
    act(() => {
      root?.render(
        <WorkbenchBrowserTab
          tabsState={browserTabsState}
          activeTab={activeBrowserTab}
          onSetTabsState={vi.fn()}
          onClose={() => undefined}
          onNewTab={vi.fn()}
          onReopenTab={vi.fn()}
          onCloseCurrentTab={vi.fn()}
        />,
      );
    });
    await flushAsyncWork();

    // All bridge calls should use '@global:tab-' session keys
    for (const [args] of setWorkbenchBrowserBounds.mock.calls) {
      if (args?.sessionKey !== undefined) {
        expect(args.sessionKey).toMatch(/^@global:tab-/);
      }
    }
    for (const [args] of navigateWorkbenchBrowser.mock.calls) {
      if (args?.sessionKey !== undefined) {
        expect(args.sessionKey).toMatch(/^@global:tab-/);
      }
    }
  });
});
