import { Menu, Tray, nativeImage } from 'electron';
import type { HostManager } from './hosts/host-manager.js';

function createTrayIcon() {
  const image = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAOCAYAAAAfSC3RAAAAHElEQVR4AWP4//8/AzWAiSTVgA0YNYBNGJ0NAAD5Rw/xl3pNGQAAAABJRU5ErkJggg==',
  );
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
    this.tray.setToolTip('personal-agent');
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
        label: `Host: ${activeHost.label}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open personal-agent',
        click: this.options.onOpen,
      },
      {
        label: 'New conversation',
        click: this.options.onNewConversation,
      },
      {
        label: 'Connections…',
        click: this.options.onConnections,
      },
      {
        label: 'Restart backend',
        click: this.options.onRestartBackend,
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: this.options.onQuit,
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray.destroy();
  }
}
