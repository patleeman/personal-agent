export interface WorkbenchBrowserToolHost {
  isActive(conversationId: string): Promise<boolean>;
  listTabs(): Promise<Array<{ sessionKey: string; url: string; title: string }>>;
  snapshot(conversationId: string, tabId?: string): Promise<unknown>;
  screenshot(conversationId: string, tabId?: string): Promise<unknown>;
  cdp(input: { conversationId: string; command: unknown; continueOnError?: boolean; tabId?: string }): Promise<unknown>;
}

const WORKBENCH_BROWSER_TOOL_HOST_KEY = Symbol.for('personal-agent.workbenchBrowserToolHost');

type WorkbenchBrowserToolHostGlobal = typeof globalThis & {
  [WORKBENCH_BROWSER_TOOL_HOST_KEY]?: WorkbenchBrowserToolHost | null;
};

function hostGlobal(): WorkbenchBrowserToolHostGlobal {
  return globalThis as WorkbenchBrowserToolHostGlobal;
}

export function setWorkbenchBrowserToolHost(nextHost: WorkbenchBrowserToolHost | null): void {
  hostGlobal()[WORKBENCH_BROWSER_TOOL_HOST_KEY] = nextHost;
}

export function getWorkbenchBrowserToolHost(): WorkbenchBrowserToolHost | null {
  return hostGlobal()[WORKBENCH_BROWSER_TOOL_HOST_KEY] ?? null;
}
