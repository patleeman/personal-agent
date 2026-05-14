import {
  type BrowserTabsState,
  createNewTab,
  cx,
  getAdjacentTabId,
  getDesktopBridge,
  getTabSessionKey,
  readBrowserTabsState,
  WorkbenchBrowserTab,
  writeBrowserTabsState,
} from '@personal-agent/extensions/workbench-browser';
import { useCallback, useEffect, useState } from 'react';

import { BrowserToolBlock } from './BrowserToolBlock.js';

const BROWSER_TABS_CHANGED_EVENT = 'pa:system-browser-tabs-changed';

export function BrowserTranscriptRenderer({ block, context }: { block: never; context: { onOpenBrowser?: () => void } }) {
  return <BrowserToolBlock block={block} onOpenBrowser={context.onOpenBrowser} />;
}

let browserTabsSnapshot: BrowserTabsState = readBrowserTabsState();

function publishBrowserTabsState(next: BrowserTabsState) {
  browserTabsSnapshot = next;
  writeBrowserTabsState(next);
  window.dispatchEvent(new CustomEvent(BROWSER_TABS_CHANGED_EVENT, { detail: next }));
}

function useBrowserTabsState(): [
  BrowserTabsState,
  (updater: BrowserTabsState | ((current: BrowserTabsState) => BrowserTabsState)) => void,
] {
  const [tabsState, setTabsState] = useState(browserTabsSnapshot);

  useEffect(() => {
    const handleChange = (event: Event) => {
      setTabsState((event as CustomEvent<BrowserTabsState>).detail ?? browserTabsSnapshot);
    };
    window.addEventListener(BROWSER_TABS_CHANGED_EVENT, handleChange);
    return () => window.removeEventListener(BROWSER_TABS_CHANGED_EVENT, handleChange);
  }, []);

  const updateTabsState = useCallback((updater: BrowserTabsState | ((current: BrowserTabsState) => BrowserTabsState)) => {
    const next = typeof updater === 'function' ? updater(browserTabsSnapshot) : updater;
    publishBrowserTabsState(next);
  }, []);

  return [tabsState, updateTabsState];
}

function useBrowserTabActions() {
  const [tabsState, setTabsState] = useBrowserTabsState();

  const switchTab = useCallback(
    (tabId: string) => {
      setTabsState((prev) => ({ ...prev, activeTabId: tabId }));
    },
    [setTabsState],
  );

  const addTab = useCallback(() => {
    const newTab = createNewTab();
    setTabsState((prev) => ({ ...prev, tabs: [...prev.tabs, newTab], activeTabId: newTab.id }));
  }, [setTabsState]);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabsState((prev) => {
        const closedTab = prev.tabs.find((tab) => tab.id === tabId) ?? null;
        if (prev.tabs.length <= 1) {
          const newTab = createNewTab();
          return {
            tabs: [newTab],
            activeTabId: newTab.id,
            closedTabs: closedTab ? [closedTab, ...prev.closedTabs].slice(0, 10) : prev.closedTabs,
          };
        }
        const newTabId = getAdjacentTabId(prev, tabId) ?? prev.tabs[0]!.id;
        return {
          ...prev,
          tabs: prev.tabs.filter((tab) => tab.id !== tabId),
          activeTabId: newTabId,
          closedTabs: closedTab ? [closedTab, ...prev.closedTabs].slice(0, 10) : prev.closedTabs,
        };
      });
      void getDesktopBridge()
        ?.setWorkbenchBrowserBounds({ visible: false, sessionKey: getTabSessionKey(tabId), deactivate: true })
        .catch(() => undefined);
    },
    [setTabsState],
  );

  const reopenTab = useCallback(() => {
    setTabsState((prev) => {
      if (prev.closedTabs.length === 0) return prev;
      const [restored, ...remaining] = prev.closedTabs;
      const newTab = { ...restored, id: crypto.randomUUID(), urlDraft: '' };
      return { ...prev, tabs: [...prev.tabs, newTab], activeTabId: newTab.id, closedTabs: remaining };
    });
  }, [setTabsState]);

  return { tabsState, setTabsState, switchTab, addTab, closeTab, reopenTab };
}

export function BrowserTabsPanel() {
  const { tabsState, switchTab, addTab, closeTab } = useBrowserTabActions();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 px-3 py-2">
        <p className="ui-section-label">Browser</p>
      </div>
      <div className="min-h-0 flex-1 flex flex-col gap-px overflow-y-auto px-1.5 py-1.5">
        {tabsState.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cx(
              'group flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12px] transition-colors',
              tab.id === tabsState.activeTabId ? 'bg-elevated text-primary' : 'text-secondary hover:bg-elevated/70 hover:text-primary',
            )}
            onClick={() => switchTab(tab.id)}
            title={tab.title}
          >
            <span className="min-w-0 flex-1 truncate">{tab.title}</span>
            <span
              className="ml-auto flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-[10px] opacity-0 transition-opacity hover:bg-border-subtle hover:opacity-100 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                closeTab(tab.id);
              }}
              role="button"
              aria-label={`Close ${tab.title}`}
              tabIndex={-1}
            >
              ×
            </span>
          </button>
        ))}
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[12px] text-secondary transition-colors hover:bg-elevated/70 hover:text-primary"
          onClick={addTab}
          title="New tab"
          aria-label="New tab"
        >
          <span className="text-[14px] leading-none">+</span>
          <span className="text-left">New tab</span>
        </button>
      </div>
    </div>
  );
}

export function BrowserWorkbenchPanel() {
  const { tabsState, setTabsState, addTab, closeTab, reopenTab } = useBrowserTabActions();
  const activeTab = tabsState.tabs.find((tab) => tab.id === tabsState.activeTabId) ?? tabsState.tabs[0] ?? createNewTab();

  return (
    <WorkbenchBrowserTab
      tabsState={tabsState}
      activeTab={activeTab}
      onSetTabsState={setTabsState}
      onClose={() => undefined}
      onNewTab={addTab}
      onReopenTab={reopenTab}
      onCloseCurrentTab={() => closeTab(activeTab.id)}
    />
  );
}
