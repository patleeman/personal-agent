const STORAGE_KEY = 'pa:workbench-browser-tabs';
const DEFAULT_URL = 'https://www.google.com/';

export interface BrowserTabItem {
  id: string;
  title: string;
  url: string;
  urlDraft: string;
}

export interface BrowserTabsState {
  version: 1;
  tabs: BrowserTabItem[];
  activeTabId: string;
  closedTabs: BrowserTabItem[];
}

function generateId(): string {
  return crypto.randomUUID();
}

function createDefaultState(): BrowserTabsState {
  const id = generateId();
  return {
    version: 1,
    tabs: [{ id, title: 'New Tab', url: DEFAULT_URL, urlDraft: '' }],
    activeTabId: id,
    closedTabs: [],
  };
}

function validateState(raw: unknown): BrowserTabsState | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const state = raw as Record<string, unknown>;
  if (state.version !== 1) {
    return null;
  }

  if (!Array.isArray(state.tabs) || state.tabs.length === 0) {
    return null;
  }

  if (typeof state.activeTabId !== 'string') {
    return null;
  }

  const hasActive = state.tabs.some((t: unknown) => {
    if (!t || typeof t !== 'object') {
      return false;
    }

    const tab = t as Record<string, unknown>;
    return tab.id === state.activeTabId;
  });

  if (!hasActive) {
    return null;
  }

  const closedTabs = Array.isArray(state.closedTabs)
    ? state.closedTabs
        .map((t: unknown) => {
          const tab = t as Record<string, unknown>;
          if (!tab.id) return null;
          return {
            id: String(tab.id ?? ''),
            title: String(tab.title ?? 'New Tab'),
            url: String(tab.url ?? DEFAULT_URL),
            urlDraft: String(tab.urlDraft ?? ''),
          };
        })
        .filter((t): t is BrowserTabItem => t !== null)
        .slice(0, 10)
    : [];

  return {
    version: 1,
    tabs: state.tabs.map((t: unknown) => {
      const tab = t as Record<string, unknown>;
      return {
        id: String(tab.id ?? ''),
        title: String(tab.title ?? 'New Tab'),
        url: String(tab.url ?? DEFAULT_URL),
        urlDraft: String(tab.urlDraft ?? ''),
      };
    }),
    activeTabId: String(state.activeTabId),
    closedTabs,
  };
}

export function readBrowserTabsState(): BrowserTabsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const validated = validateState(parsed);
      if (validated) {
        return validated;
      }
    }
  } catch {
    // ignore
  }

  return createDefaultState();
}

export function writeBrowserTabsState(state: BrowserTabsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function createNewTab(): BrowserTabItem {
  return {
    id: generateId(),
    title: 'New Tab',
    url: DEFAULT_URL,
    urlDraft: '',
  };
}

export function getTabSessionKey(tabId: string): string {
  return `@global:tab-${tabId}`;
}

export function getAdjacentTabId(state: BrowserTabsState, closedTabId: string): string | null {
  const index = state.tabs.findIndex((t) => t.id === closedTabId);
  if (index < 0) {
    return null;
  }

  if (index > 0) {
    return state.tabs[index - 1]!.id;
  }

  if (state.tabs.length > 1) {
    return state.tabs[1]!.id;
  }

  return null;
}
