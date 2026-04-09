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

  constructor(options: {
    hostManager: HostManager;
    onOpen: () => void;
    onNewConversation: () => void;
    onConnections: () => void;
    onRestartBackend: () => void;
    onQuit: () => void;
  }) {
    this.tray = new Tray(createTrayIcon());
    this.tray.setToolTip('personal-agent');
    this.tray.on('click', options.onOpen);

    const activeHost = options.hostManager.getActiveHostRecord();
    const menu = Menu.buildFromTemplate([
      {
        label: `Host: ${activeHost.label}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Open personal-agent',
        click: options.onOpen,
      },
      {
        label: 'New conversation',
        click: options.onNewConversation,
      },
      {
        label: 'Connections…',
        click: options.onConnections,
      },
      {
        label: 'Restart backend',
        click: options.onRestartBackend,
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: options.onQuit,
      },
    ]);

    this.tray.setContextMenu(menu);
  }

  destroy(): void {
    this.tray.destroy();
  }
}
