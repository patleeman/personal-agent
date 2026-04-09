import { readFileSync } from 'node:fs';
import { Menu, Tray, nativeImage } from 'electron';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { HostManager } from './hosts/host-manager.js';

function createSvgImage(filePath: string) {
  const source = readFileSync(filePath, 'utf-8');
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`);
}

function createTrayIcon() {
  const { trayTemplateIconFile } = resolveDesktopRuntimePaths();
  const image = createSvgImage(trayTemplateIconFile).resize({ width: 18, height: 18 });
  image.setTemplateImage(true);
  return image;
}

export class DesktopTrayController {
  private tray: Tray;
  private readonly options: {
    hostManager: HostManager;
    onOpen: () => void;
    onNewConversation: () => void;
    onConnections: () => void;
    onRestartBackend: () => void;
    onQuit: () => void;
  };

  constructor(options: {
    hostManager: HostManager;
    onOpen: () => void;
    onNewConversation: () => void;
    onConnections: () => void;
    onRestartBackend: () => void;
    onQuit: () => void;
  }) {
    this.options = options;
    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip('Personal Agent');
    this.tray.on('click', () => {
      this.refresh();
      this.options.onOpen();
    });
    this.tray.on('right-click', () => {
      this.refresh();
      this.tray.popUpContextMenu();
    });
    this.refresh();
  }

  refresh(): void {
    const activeHost = this.options.hostManager.getActiveHostRecord();
    const menu = Menu.buildFromTemplate([
      {
        label: `Connected to: ${activeHost.label}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open Personal Agent',
        click: this.options.onOpen,
      },
      {
        label: 'New Conversation',
        click: this.options.onNewConversation,
      },
      {
        label: 'Connections…',
        click: this.options.onConnections,
      },
      {
        label: 'Restart Backend',
        click: this.options.onRestartBackend,
      },
      { type: 'separator' },
      {
        label: 'Quit Personal Agent',
        click: this.options.onQuit,
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray.destroy();
  }
}
