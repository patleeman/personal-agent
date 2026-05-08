export interface WorkbenchBrowserToolHost {
  isActive(conversationId: string): Promise<boolean>;
  listTabs(): Promise<Array<{ sessionKey: string; url: string; title: string }>>;
  snapshot(conversationId: string, tabId?: string): Promise<unknown>;
  screenshot(conversationId: string, tabId?: string): Promise<unknown>;
  cdp(input: { conversationId: string; command: unknown; continueOnError?: boolean; tabId?: string }): Promise<unknown>;
}

let host: WorkbenchBrowserToolHost | null = null;

export function setWorkbenchBrowserToolHost(nextHost: WorkbenchBrowserToolHost | null): void {
  host = nextHost;
}

export function getWorkbenchBrowserToolHost(): WorkbenchBrowserToolHost | null {
  return host;
}
