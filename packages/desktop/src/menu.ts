import { Menu, app, type MenuItemConstructorOptions } from 'electron';

export interface DesktopApplicationMenuActions {
  onOpen: () => void;
  onNewConversation: () => void;
  onConnections: () => void;
  onCheckForUpdates: () => void;
  onRestartBackend: () => void;
  onQuit: () => void;
}

interface DesktopApplicationMenuTemplateOptions {
  platform?: NodeJS.Platform;
  appName?: string;
}

export function buildDesktopApplicationMenuTemplate(
  actions: DesktopApplicationMenuActions,
  options: DesktopApplicationMenuTemplateOptions = {},
): MenuItemConstructorOptions[] {
  const platform = options.platform ?? process.platform;
  const appName = options.appName ?? 'Personal Agent';
  const isMac = platform === 'darwin';

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: 'Open Personal Agent',
        accelerator: 'CommandOrControl+Shift+A',
        click: actions.onOpen,
      },
      {
        label: 'New Conversation',
        accelerator: 'CommandOrControl+N',
        click: actions.onNewConversation,
      },
      ...(isMac
        ? []
        : [
            {
              label: 'Connections…',
              accelerator: 'CommandOrControl+,',
              click: actions.onConnections,
            },
            {
              label: 'Check for Updates…',
              click: actions.onCheckForUpdates,
            },
          ]),
      {
        type: 'separator',
      },
      {
        label: 'Restart Backend',
        click: actions.onRestartBackend,
      },
      {
        type: 'separator',
      },
      isMac
        ? {
            role: 'close',
          }
        : {
            label: `Quit ${appName}`,
            accelerator: 'Alt+F4',
            click: actions.onQuit,
          },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: isMac
      ? [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ]
      : [
          { role: 'minimize' },
          { role: 'close' },
        ],
  };

  if (!isMac) {
    return [fileMenu, editMenu, viewMenu, windowMenu];
  }

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: 'about' },
      { type: 'separator' },
      {
        label: 'Check for Updates…',
        click: actions.onCheckForUpdates,
      },
      {
        label: 'Connections…',
        accelerator: 'CommandOrControl+,',
        click: actions.onConnections,
      },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      {
        label: `Quit ${appName}`,
        accelerator: 'CommandOrControl+Q',
        click: actions.onQuit,
      },
    ],
  };

  return [appMenu, fileMenu, editMenu, viewMenu, windowMenu];
}

export function installDesktopApplicationMenu(actions: DesktopApplicationMenuActions): void {
  const menu = Menu.buildFromTemplate(buildDesktopApplicationMenuTemplate(actions, {
    platform: process.platform,
    appName: app.name,
  }));
  Menu.setApplicationMenu(menu);
}
