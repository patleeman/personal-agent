import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopWorkspaceServerState } from './hosts/types.js';
import { desktopWorkspaceServerManager } from './workspace-server.js';

export type DesktopTrayStartupState =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface DesktopTrayRecentConversation {
  id: string;
  title: string;
  cwd: string;
  timestamp: string;
  lastActivityAt?: string;
  isRunning?: boolean;
  needsAttention?: boolean;
}

export type DesktopTrayRecentConversationsState =
  | { kind: 'hidden'; conversations: []; totalCount: 0 }
  | { kind: 'loading'; conversations: DesktopTrayRecentConversation[]; totalCount: number }
  | { kind: 'ready'; conversations: DesktopTrayRecentConversation[]; totalCount: number };

export interface DesktopTrayActions {
  onOpen: () => void;
  onOpenConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onSettings: () => void;
  onCheckForUpdates: () => void;
  onRestartRuntime: () => void;
  onOpenLogs: () => void;
  onQuit: () => void;
}

function createTrayIcon(): string | NativeImage {
  const runtime = resolveDesktopRuntimePaths();
  if (process.platform === 'darwin') {
    return runtime.trayTemplateIconFile;
  }

  return nativeImage.createFromPath(runtime.colorIconFile).resize({ width: 18, height: 18 });
}

function buildTrayToolTip(appName: string, activeHostLabel: string, startupState: DesktopTrayStartupState): string {
  if (startupState.kind === 'ready') {
    return `${appName} — ${activeHostLabel}`;
  }

  if (startupState.kind === 'starting') {
    return `${appName} — starting ${activeHostLabel}`;
  }

  return `${appName} — startup failed (${activeHostLabel})`;
}

function truncateMenuLabel(value: string, maxLength = 90): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildWorkspaceServerStatus(options: {
  state: DesktopWorkspaceServerState | null;
  loading: boolean;
}): { label: string; sublabel?: string } {
  const { state, loading } = options;

  if (!state) {
    return {
      label: loading ? 'Remote API: Checking…' : 'Remote API: Unknown',
    };
  }

  if (state.error) {
    return {
      label: 'Remote API: Error',
      sublabel: truncateMenuLabel(state.error),
    };
  }

  if (state.running) {
    return {
      label: 'Remote API: On',
      sublabel: truncateMenuLabel(state.tailnetWebsocketUrl ?? state.localWebsocketUrl),
    };
  }

  if (state.enabled) {
    return {
      label: 'Remote API: Starting…',
      sublabel: truncateMenuLabel(state.localWebsocketUrl),
    };
  }

  return {
    label: 'Remote API: Off',
  };
}

export function buildDesktopTrayMenuTemplate(options: {
  appName?: string;
  activeHostLabel: string;
  startupState: DesktopTrayStartupState;
  recentConversationsState?: DesktopTrayRecentConversationsState;
  workspaceServerState?: DesktopWorkspaceServerState | null;
  workspaceServerLoading?: boolean;
  actions: DesktopTrayActions;
}): MenuItemConstructorOptions[] {
  const {
    appName = 'Personal Agent',
    activeHostLabel,
    startupState,
    actions,
    workspaceServerState = null,
    workspaceServerLoading = false,
  } = options;
  const controlsReady = startupState.kind === 'ready';
  const canRetry = startupState.kind !== 'starting';
  const workspaceServerStatus = buildWorkspaceServerStatus({
    state: workspaceServerState,
    loading: workspaceServerLoading,
  });

  const template: MenuItemConstructorOptions[] = [
    {
      label: workspaceServerStatus.label,
      enabled: false,
      ...(workspaceServerStatus.sublabel ? { sublabel: workspaceServerStatus.sublabel } : {}),
    },
  ];

  if (startupState.kind === 'starting') {
    template.push({
      label: 'Launching desktop backend…',
      enabled: false,
    });
  }

  if (startupState.kind === 'error') {
    template.push(
      {
        label: `Startup failed: ${activeHostLabel}`,
        enabled: false,
      },
      {
        label: truncateMenuLabel(startupState.message),
        enabled: false,
      },
    );
  }

  template.push(
    { type: 'separator' },
    {
      label: startupState.kind === 'error' ? `Retry ${appName}` : `Show ${appName}`,
      click: actions.onOpen,
      enabled: canRetry,
    },
    {
      label: 'New Conversation',
      click: actions.onNewConversation,
      enabled: controlsReady,
    },
    {
      label: 'Settings…',
      click: actions.onSettings,
      enabled: controlsReady,
    },
    {
      label: 'Check for Updates…',
      click: actions.onCheckForUpdates,
    },
    {
      label: 'Restart Runtime',
      click: actions.onRestartRuntime,
      enabled: canRetry,
    },
  );

  if (startupState.kind === 'error') {
    template.push({
      label: 'Open Desktop Logs',
      click: actions.onOpenLogs,
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: `Quit ${appName}`,
      click: actions.onQuit,
    },
  );

  return template;
}

export class DesktopTrayController {
  private tray: Tray;
  private startupState: DesktopTrayStartupState = { kind: 'starting' };
  private workspaceServerState: DesktopWorkspaceServerState | null = null;
  private workspaceServerLoadingPromise: Promise<void> | null = null;

  constructor(
    private readonly options: {
      hostManager: HostManager;
    } & DesktopTrayActions,
  ) {
    this.tray = new Tray(createTrayIcon());
    this.tray.on('click', () => {
      this.refresh();
      if (this.startupState.kind === 'starting') {
        return;
      }

      this.options.onOpen();
    });
    this.tray.on('right-click', () => {
      void this.showContextMenu();
    });
    this.refresh();
  }

  setStartupState(state: DesktopTrayStartupState): void {
    this.startupState = state;
    this.refresh();
  }

  refresh(): void {
    this.renderMenu();
    void this.ensureWorkspaceServerStateLoaded();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private async showContextMenu(): Promise<void> {
    await this.ensureWorkspaceServerStateLoaded({ force: true });
    this.renderMenu();
    this.tray.popUpContextMenu();
  }

  private renderMenu(): void {
    const activeHost = this.options.hostManager.getActiveHostRecord();
    const appName = typeof app.name === 'string' && app.name.trim().length > 0
      ? app.name.trim()
      : 'Personal Agent';
    this.tray.setToolTip(buildTrayToolTip(appName, activeHost.label, this.startupState));
    const menu = Menu.buildFromTemplate(buildDesktopTrayMenuTemplate({
      appName,
      activeHostLabel: activeHost.label,
      startupState: this.startupState,
      workspaceServerState: this.workspaceServerState,
      workspaceServerLoading: this.workspaceServerLoadingPromise !== null,
      actions: this.options,
    }));

    this.tray.setContextMenu(menu);
  }

  private async ensureWorkspaceServerStateLoaded(options: { force?: boolean } = {}): Promise<void> {
    if (this.workspaceServerLoadingPromise) {
      await this.workspaceServerLoadingPromise;
      return;
    }

    if (!options.force && this.workspaceServerState) {
      return;
    }

    const loadPromise = (async () => {
      try {
        const nextState = await desktopWorkspaceServerManager.readState();
        this.workspaceServerState = nextState;
      } catch {
        // Keep the last known workspace server state when reads fail.
      } finally {
        this.workspaceServerLoadingPromise = null;
        this.renderMenu();
      }
    })();

    this.workspaceServerLoadingPromise = loadPromise;
    this.renderMenu();
    await loadPromise;
  }
}
