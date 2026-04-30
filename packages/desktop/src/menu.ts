import { Menu, app, type MenuItemConstructorOptions } from 'electron';

export interface DesktopApplicationMenuActions {
  onOpen: () => void;
  onNewWindow: () => void;
  onNewConversation: () => void;
  onCloseConversation: () => void;
  onReopenClosedConversation: () => void;
  onPreviousConversation: () => void;
  onNextConversation: () => void;
  onToggleConversationPin: () => void;
  onToggleConversationArchive: () => void;
  onRenameConversation: () => void;
  onFocusComposer: () => void;
  onEditWorkingDirectory: () => void;
  onFindInPage: () => void;
  onToggleSidebar: () => void;
  onToggleRightRail: () => void;
  onToggleLayoutMode: () => void;
  onCycleViewMode: () => void;
  onHideWindow: () => void;
  onSettings: () => void;
  onCheckForUpdates: () => void;
  onRestartRuntime: () => void;
  onQuit: () => void;
}

interface DesktopApplicationMenuTemplateOptions {
  platform?: NodeJS.Platform;
  appName?: string;
}

function getReopenClosedTabAccelerator(platform: NodeJS.Platform): string {
  return platform === 'darwin' ? 'Command+Shift+N' : 'CommandOrControl+Shift+W';
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
        label: `Show ${appName}`,
        accelerator: 'CommandOrControl+Shift+A',
        click: actions.onOpen,
      },
      {
        label: 'New Window',
        click: actions.onNewWindow,
      },
      {
        label: 'New Conversation',
        accelerator: 'CommandOrControl+N',
        click: actions.onNewConversation,
      },
      {
        label: 'Close Tab',
        accelerator: 'CommandOrControl+W',
        click: actions.onCloseConversation,
      },
      {
        label: 'Reopen Closed Tab',
        accelerator: getReopenClosedTabAccelerator(platform),
        click: actions.onReopenClosedConversation,
      },
      {
        label: 'Previous Conversation',
        accelerator: 'CommandOrControl+[',
        click: actions.onPreviousConversation,
      },
      {
        label: 'Next Conversation',
        accelerator: 'CommandOrControl+]',
        click: actions.onNextConversation,
      },
      {
        label: 'Toggle Pinned',
        accelerator: 'CommandOrControl+Alt+P',
        click: actions.onToggleConversationPin,
      },
      {
        label: 'Archive / Restore Conversation',
        accelerator: 'CommandOrControl+Alt+A',
        click: actions.onToggleConversationArchive,
      },
      {
        label: 'Rename Conversation',
        accelerator: 'CommandOrControl+Alt+R',
        click: actions.onRenameConversation,
      },
      {
        label: 'Focus Composer',
        accelerator: 'CommandOrControl+L',
        click: actions.onFocusComposer,
      },
      {
        label: 'Edit Working Directory',
        accelerator: 'CommandOrControl+Shift+L',
        click: actions.onEditWorkingDirectory,
      },
      ...(isMac
        ? [
            {
              type: 'separator' as const,
            },
          ]
        : [
            {
              type: 'separator' as const,
            },
            {
              label: 'Settings…',
              accelerator: 'CommandOrControl+,',
              click: actions.onSettings,
            },
            {
              label: 'Check for Updates…',
              click: actions.onCheckForUpdates,
            },
            {
              type: 'separator' as const,
            },
          ]),
      {
        label: 'Restart Runtime',
        click: actions.onRestartRuntime,
      },
      ...(!isMac
        ? [
            {
              type: 'separator' as const,
            },
            {
              label: `Quit ${appName}`,
              accelerator: 'Alt+F4',
              click: actions.onQuit,
            },
          ]
        : []),
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
      { type: 'separator' },
      {
        label: 'Find on Page',
        accelerator: 'CommandOrControl+F',
        click: actions.onFindInPage,
      },
      { role: 'selectAll' },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      {
        label: 'Toggle Sidebar',
        accelerator: 'CommandOrControl+\\',
        click: actions.onToggleSidebar,
      },
      {
        label: 'Toggle Right Rail',
        accelerator: 'CommandOrControl+Shift+\\',
        click: actions.onToggleRightRail,
      },
      {
        label: 'Toggle Layout Mode',
        accelerator: 'CommandOrControl+Alt+\\',
        click: actions.onToggleLayoutMode,
      },
      {
        label: 'Cycle View Mode',
        accelerator: 'CommandOrControl+Shift+V',
        click: actions.onCycleViewMode,
      },
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
          {
            label: 'Hide Window',
            click: actions.onHideWindow,
          },
          { type: 'separator' },
          { role: 'front' },
        ]
      : [
          { role: 'minimize' },
          {
            label: 'Hide Window',
            click: actions.onHideWindow,
          },
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
        label: 'Settings…',
        accelerator: 'CommandOrControl+,',
        click: actions.onSettings,
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
