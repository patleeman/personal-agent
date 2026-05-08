import { app, Menu, type MenuItemConstructorOptions } from 'electron';

import {
  CORE_KEYBOARD_SHORTCUT_REGISTRATIONS,
  DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS,
  type DesktopKeyboardShortcuts,
} from './keyboard-shortcuts.js';

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

type DesktopMenuShortcutId = keyof DesktopKeyboardShortcuts;

const DESKTOP_MENU_SHORTCUT_ACTIONS: Record<DesktopMenuShortcutId, keyof DesktopApplicationMenuActions> = {
  showApp: 'onOpen',
  newConversation: 'onNewConversation',
  closeTab: 'onCloseConversation',
  reopenClosedTab: 'onReopenClosedConversation',
  previousConversation: 'onPreviousConversation',
  nextConversation: 'onNextConversation',
  togglePinned: 'onToggleConversationPin',
  archiveRestoreConversation: 'onToggleConversationArchive',
  renameConversation: 'onRenameConversation',
  focusComposer: 'onFocusComposer',
  editWorkingDirectory: 'onEditWorkingDirectory',
  findOnPage: 'onFindInPage',
  settings: 'onSettings',
  quit: 'onQuit',
  conversationMode: 'onShowConversationMode',
  workbenchMode: 'onShowWorkbenchMode',
  zenMode: 'onShowZenMode',
  toggleSidebar: 'onToggleSidebar',
  toggleRightRail: 'onToggleRightRail',
};

function menuShortcut(
  id: DesktopMenuShortcutId,
  label: string,
  actions: DesktopApplicationMenuActions,
  keyboardShortcuts: DesktopKeyboardShortcuts,
): MenuItemConstructorOptions {
  return {
    label,
    accelerator: keyboardShortcuts[id],
    click: actions[DESKTOP_MENU_SHORTCUT_ACTIONS[id]],
  };
}

function assertMenuShortcutsMatchCoreRegistry(): void {
  for (const registration of CORE_KEYBOARD_SHORTCUT_REGISTRATIONS) {
    if (!(registration.id in DESKTOP_MENU_SHORTCUT_ACTIONS)) {
      throw new Error(`Missing desktop menu action for ${registration.id}.`);
    }
  }
}

export function buildDesktopApplicationMenuTemplate(
  actions: DesktopApplicationMenuActions,
  options: DesktopApplicationMenuTemplateOptions = {},
): MenuItemConstructorOptions[] {
  const platform = options.platform ?? process.platform;
  const appName = options.appName ?? 'Personal Agent';
  const isMac = platform === 'darwin';
  const keyboardShortcuts = options.keyboardShortcuts ?? DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS;
  assertMenuShortcutsMatchCoreRegistry();

  const fileMenu: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      menuShortcut('showApp', `Show ${appName}`, actions, keyboardShortcuts),
      {
        label: 'New Window',
        click: actions.onNewWindow,
      },
      menuShortcut('newConversation', 'New Conversation', actions, keyboardShortcuts),
      menuShortcut('closeTab', 'Close Tab', actions, keyboardShortcuts),
      menuShortcut('reopenClosedTab', 'Reopen Closed Tab', actions, keyboardShortcuts),
      menuShortcut('previousConversation', 'Previous Conversation', actions, keyboardShortcuts),
      menuShortcut('nextConversation', 'Next Conversation', actions, keyboardShortcuts),
      menuShortcut('togglePinned', 'Toggle Pinned', actions, keyboardShortcuts),
      menuShortcut('archiveRestoreConversation', 'Archive / Restore Conversation', actions, keyboardShortcuts),
      menuShortcut('renameConversation', 'Rename Conversation', actions, keyboardShortcuts),
      menuShortcut('focusComposer', 'Focus Composer', actions, keyboardShortcuts),
      menuShortcut('editWorkingDirectory', 'Edit Working Directory', actions, keyboardShortcuts),
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
            menuShortcut('settings', 'Settings…', actions, keyboardShortcuts),
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
            menuShortcut('quit', `Quit ${appName}`, actions, keyboardShortcuts),
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
      menuShortcut('findOnPage', 'Find on Page', actions, keyboardShortcuts),
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
      menuShortcut('toggleSidebar', 'Toggle Sidebar', actions, keyboardShortcuts),
      menuShortcut('toggleRightRail', 'Toggle Right Rail', actions, keyboardShortcuts),
      menuShortcut('conversationMode', 'Conversation Mode', actions, keyboardShortcuts),
      menuShortcut('workbenchMode', 'Workbench Mode', actions, keyboardShortcuts),
      menuShortcut('zenMode', 'Zen Mode', actions, keyboardShortcuts),
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
      menuShortcut('settings', 'Settings…', actions, keyboardShortcuts),
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      { type: 'separator' },
      menuShortcut('quit', `Quit ${appName}`, actions, keyboardShortcuts),
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
