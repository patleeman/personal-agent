import type {
  ConversationBootstrapState,
  DesktopConnectionsState,
  DesktopEnvironmentState,
  DesktopHostRecord,
  DesktopNavigationState,
} from './types';

export interface PersonalAgentDesktopBridge {
  getEnvironment(): Promise<DesktopEnvironmentState>;
  getConnections(): Promise<DesktopConnectionsState>;
  getNavigationState(): Promise<DesktopNavigationState>;
  switchHost(hostId: string): Promise<void>;
  saveHost(host: DesktopHostRecord): Promise<DesktopConnectionsState>;
  deleteHost(hostId: string): Promise<DesktopConnectionsState>;
  openNewConversation(): Promise<void>;
  readConversationBootstrap(
    conversationId: string,
    options?: {
      tailBlocks?: number;
      knownSessionSignature?: string;
      knownBlockOffset?: number;
      knownTotalBlocks?: number;
      knownLastBlockId?: string;
    },
  ): Promise<ConversationBootstrapState>;
  openHostWindow(hostId: string): Promise<void>;
  showConnectionsWindow(): Promise<void>;
  goBack(): Promise<DesktopNavigationState>;
  goForward(): Promise<DesktopNavigationState>;
  restartActiveHost(): Promise<void>;
}

export function getDesktopBridge(): PersonalAgentDesktopBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.personalAgentDesktop ?? null;
}

export function isDesktopShell(): boolean {
  if (getDesktopBridge() !== null) {
    return true;
  }

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('desktop-shell') === '1') {
      return true;
    }

    try {
      if (window.sessionStorage.getItem('__pa_desktop_shell__') === '1') {
        return true;
      }
    } catch {
      // Ignore storage failures.
    }
  }

  if (typeof document !== 'undefined' && document.documentElement.dataset.personalAgentDesktop === '1') {
    return true;
  }

  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Electron/i.test(navigator.userAgent);
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
