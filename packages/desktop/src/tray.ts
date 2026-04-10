import { Menu, Tray, nativeImage, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { HostManager } from './hosts/host-manager.js';

export type DesktopTrayStartupState =
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export interface DesktopTrayActions {
  onOpen: () => void;
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

function buildTrayToolTip(activeHostLabel: string, startupState: DesktopTrayStartupState): string {
  if (startupState.kind === 'ready') {
    return `Personal Agent — ${activeHostLabel}`;
  }

  if (startupState.kind === 'starting') {
    return `Personal Agent — starting ${activeHostLabel}`;
  }

  return `Personal Agent — startup failed (${activeHostLabel})`;
}

function truncateMenuLabel(value: string, maxLength = 90): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildDesktopTrayMenuTemplate(options: {
  activeHostLabel: string;
  startupState: DesktopTrayStartupState;
  actions: DesktopTrayActions;
}): MenuItemConstructorOptions[] {
  const { activeHostLabel, startupState, actions } = options;
  const controlsReady = startupState.kind === 'ready';
  const canRetry = startupState.kind !== 'starting';
  const statusLabel = startupState.kind === 'ready'
    ? `Connected to: ${activeHostLabel}`
    : startupState.kind === 'starting'
      ? `Starting: ${activeHostLabel}`
      : `Startup failed: ${activeHostLabel}`;

  const template: MenuItemConstructorOptions[] = [
    {
      label: statusLabel,
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
    template.push({
      label: truncateMenuLabel(startupState.message),
      enabled: false,
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: startupState.kind === 'error' ? 'Retry Personal Agent' : 'Show Personal Agent',
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
      label: 'Quit Personal Agent',
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
      this.refresh();
      this.tray.popUpContextMenu();
    });
    this.refresh();
  }

  setStartupState(state: DesktopTrayStartupState): void {
    this.startupState = state;
    this.refresh();
  }

  refresh(): void {
    const activeHost = this.options.hostManager.getActiveHostRecord();
    this.tray.setToolTip(buildTrayToolTip(activeHost.label, this.startupState));
    const menu = Menu.buildFromTemplate(buildDesktopTrayMenuTemplate({
      activeHostLabel: activeHost.label,
      startupState: this.startupState,
      actions: this.options,
    }));

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray.destroy();
  }
}
