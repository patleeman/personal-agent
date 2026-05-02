import { app, Menu, type MenuItemConstructorOptions } from 'electron';

import { DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS, type DesktopKeyboardShortcuts } from './keyboard-shortcuts.js';

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
  onShowConversationMode: () => void;
  onShowWorkbenchMode: () => void;
  onShowZenMode: () => void;
  onHideWindow: () => void;
  onSettings: () => void;
  onCheckForUpdates: () => void;
  onRestartRuntime: () => void;
  onQuit: () => void;
}

interface DesktopApplicationMenuTemplateOptions {
  platform?: NodeJS.Platform;
  appName?: string;
  keyboardShortcuts?: DesktopKeyboardShortcuts;
}

export function buildDesktopApplicationMenuTemplate(
  actions: DesktopApplicationMenuActions,
  options: DesktopApplicationMenuTemplateOptions = {},
): MenuItemConstructorOptions[] {
  const platform = options.platform ?? process.platform;
  const appName = options.appName ?? 'Personal Agent';
  const isMac = platform === 'darwin';
  const keyboardShortcuts = options.keyboardShortcuts ?? DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS;

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      {
        label: `Show ${appName}`,
        accelerator: keyboardShortcuts.showApp,
        click: actions.onOpen,
      },
      {
        label: 'New Window',
        click: actions.onNewWindow,
      },
      {
        label: 'New Conversation',
        accelerator: keyboardShortcuts.newConversation,
        click: actions.onNewConversation,
      },
      {
        label: 'Close Tab',
        accelerator: keyboardShortcuts.closeTab,
        click: actions.onCloseConversation,
      },
      {
        label: 'Reopen Closed Tab',
        accelerator: keyboardShortcuts.reopenClosedTab,
        click: actions.onReopenClosedConversation,
      },
      {
        label: 'Previous Conversation',
        accelerator: keyboardShortcuts.previousConversation,
        click: actions.onPreviousConversation,
      },
      {
        label: 'Next Conversation',
        accelerator: keyboardShortcuts.nextConversation,
        click: actions.onNextConversation,
      },
      {
        label: 'Toggle Pinned',
        accelerator: keyboardShortcuts.togglePinned,
        click: actions.onToggleConversationPin,
      },
      {
        label: 'Archive / Restore Conversation',
        accelerator: keyboardShortcuts.archiveRestoreConversation,
        click: actions.onToggleConversationArchive,
      },
      {
        label: 'Rename Conversation',
        accelerator: keyboardShortcuts.renameConversation,
        click: actions.onRenameConversation,
      },
      {
        label: 'Focus Composer',
        accelerator: keyboardShortcuts.focusComposer,
        click: actions.onFocusComposer,
      },
      {
        label: 'Edit Working Directory',
        accelerator: keyboardShortcuts.editWorkingDirectory,
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
              accelerator: keyboardShortcuts.settings,
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
              accelerator: keyboardShortcuts.quit,
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
        accelerator: keyboardShortcuts.findOnPage,
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
        accelerator: keyboardShortcuts.toggleSidebar,
        click: actions.onToggleSidebar,
      },
      {
        label: 'Toggle Right Rail',
        accelerator: keyboardShortcuts.toggleRightRail,
        click: actions.onToggleRightRail,
      },
      {
        label: 'Conversation Mode',
        accelerator: keyboardShortcuts.conversationMode,
        click: actions.onShowConversationMode,
      },
      {
        label: 'Workbench Mode',
        accelerator: keyboardShortcuts.workbenchMode,
        click: actions.onShowWorkbenchMode,
      },
      {
        label: 'Zen Mode',
        accelerator: keyboardShortcuts.zenMode,
        click: actions.onShowZenMode,
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
        accelerator: keyboardShortcuts.settings,
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
        accelerator: keyboardShortcuts.quit,
        click: actions.onQuit,
      },
    ],
  };

  return [appMenu, fileMenu, editMenu, viewMenu, windowMenu];
}

export function installDesktopApplicationMenu(actions: DesktopApplicationMenuActions): void {
  const keyboardShortcuts = readDesktopApplicationMenuKeyboardShortcuts?.();
  const menu = Menu.buildFromTemplate(
    buildDesktopApplicationMenuTemplate(actions, {
      platform: process.platform,
      appName: app.name,
      ...(keyboardShortcuts ? { keyboardShortcuts } : {}),
    }),
  );
  Menu.setApplicationMenu(menu);
}

let readDesktopApplicationMenuKeyboardShortcuts: (() => DesktopKeyboardShortcuts) | null = null;

export function setDesktopApplicationMenuKeyboardShortcutsReader(reader: (() => DesktopKeyboardShortcuts) | null): void {
  readDesktopApplicationMenuKeyboardShortcuts = reader;
}
