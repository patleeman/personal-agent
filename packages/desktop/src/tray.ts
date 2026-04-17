import { Menu, Tray, app, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { HostManager } from './hosts/host-manager.js';

export type DesktopTrayStartupState =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

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

function buildTrayToolTip(appName: string, startupState: DesktopTrayStartupState): string {
  if (startupState.kind === 'ready') {
    return `${appName} — Local`;
  }

  if (startupState.kind === 'starting') {
    return `${appName} — starting`;
  }

  return `${appName} — startup failed`;
}

function truncateMenuLabel(value: string, maxLength = 90): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildDesktopTrayMenuTemplate(options: {
  appName?: string;
  startupState: DesktopTrayStartupState;
  actions: DesktopTrayActions;
}): MenuItemConstructorOptions[] {
  const {
    appName = 'Personal Agent',
    startupState,
    actions,
  } = options;
  const controlsReady = startupState.kind === 'ready';
  const canRetry = startupState.kind !== 'starting';

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Remote execution: SSH-only',
      enabled: false,
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
        label: 'Startup failed',
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
      this.renderMenu();
      this.tray.popUpContextMenu();
    });
    this.refresh();
  }

  setStartupState(state: DesktopTrayStartupState): void {
    this.startupState = state;
    this.refresh();
  }

  refresh(): void {
    this.renderMenu();
  }

  destroy(): void {
    this.tray.destroy();
  }

  private renderMenu(): void {
    const appName = typeof app.name === 'string' && app.name.trim().length > 0
      ? app.name.trim()
      : 'Personal Agent';
    this.tray.setToolTip(buildTrayToolTip(appName, this.startupState));
    const menu = Menu.buildFromTemplate(buildDesktopTrayMenuTemplate({
      appName,
      startupState: this.startupState,
      actions: this.options,
    }));
    this.tray.setContextMenu(menu);
  }
}
