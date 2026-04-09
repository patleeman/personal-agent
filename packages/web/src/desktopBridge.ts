import type { DesktopConnectionsState, DesktopEnvironmentState, DesktopHostRecord } from './types';

export interface PersonalAgentDesktopBridge {
  getEnvironment(): Promise<DesktopEnvironmentState>;
  getConnections(): Promise<DesktopConnectionsState>;
  switchHost(hostId: string): Promise<void>;
  saveHost(host: DesktopHostRecord): Promise<DesktopConnectionsState>;
  deleteHost(hostId: string): Promise<DesktopConnectionsState>;
  openNewConversation(): Promise<void>;
  showConnectionsWindow(): Promise<void>;
  restartActiveHost(): Promise<void>;
}

export function getDesktopBridge(): PersonalAgentDesktopBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.personalAgentDesktop ?? null;
}

export function isDesktopShell(): boolean {
  return getDesktopBridge() !== null;
}

export async function readDesktopEnvironment(): Promise<DesktopEnvironmentState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return null;
  }

  return bridge.getEnvironment();
}

export async function readDesktopConnections(): Promise<DesktopConnectionsState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return null;
  }

  return bridge.getConnections();
}
