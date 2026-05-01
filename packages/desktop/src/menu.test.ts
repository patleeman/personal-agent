import { describe, expect, it, vi } from 'vitest';
import { buildDesktopApplicationMenuTemplate } from './menu.js';

function createActions() {
  return {
    onOpen: vi.fn(),
    onNewWindow: vi.fn(),
    onNewConversation: vi.fn(),
    onCloseConversation: vi.fn(),
    onReopenClosedConversation: vi.fn(),
    onPreviousConversation: vi.fn(),
    onNextConversation: vi.fn(),
    onToggleConversationPin: vi.fn(),
    onToggleConversationArchive: vi.fn(),
    onRenameConversation: vi.fn(),
    onFocusComposer: vi.fn(),
    onEditWorkingDirectory: vi.fn(),
    onFindInPage: vi.fn(),
    onToggleSidebar: vi.fn(),
    onToggleRightRail: vi.fn(),
    onShowConversationMode: vi.fn(),
    onShowWorkbenchMode: vi.fn(),
    onShowZenMode: vi.fn(),
    onHideWindow: vi.fn(),
    onSettings: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onRestartRuntime: vi.fn(),
    onQuit: vi.fn(),
  };
}

describe('buildDesktopApplicationMenuTemplate', () => {
  it('builds a macOS app menu with app-specific actions', () => {
    const template = buildDesktopApplicationMenuTemplate(createActions(), {
      platform: 'darwin',
      appName: 'Personal Agent',
    });

    expect(template.map((item) => item.label)).toEqual([
      'Personal Agent',
      'File',
      'Edit',
      'View',
      'Window',
    ]);

    const appMenu = template[0];
    expect(appMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'about' }),
      expect.objectContaining({ label: 'Check for Updates…' }),
      expect.objectContaining({ label: 'Settings…', accelerator: 'CommandOrControl+,' }),
      expect.objectContaining({ label: 'Quit Personal Agent', accelerator: 'CommandOrControl+Q' }),
    ]));

    const fileMenu = template[1];
    expect(fileMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'New Window' }),
      expect.objectContaining({ label: 'Close Tab', accelerator: 'CommandOrControl+W' }),
      expect.objectContaining({ label: 'Reopen Closed Tab', accelerator: 'Command+Shift+N' }),
      expect.objectContaining({ label: 'Previous Conversation', accelerator: 'CommandOrControl+[' }),
      expect.objectContaining({ label: 'Next Conversation', accelerator: 'CommandOrControl+]' }),
      expect.objectContaining({ label: 'Toggle Pinned', accelerator: 'CommandOrControl+Alt+P' }),
      expect.objectContaining({ label: 'Archive / Restore Conversation', accelerator: 'CommandOrControl+Alt+A' }),
      expect.objectContaining({ label: 'Rename Conversation', accelerator: 'CommandOrControl+Alt+R' }),
      expect.objectContaining({ label: 'Focus Composer', accelerator: 'CommandOrControl+L' }),
      expect.objectContaining({ label: 'Edit Working Directory', accelerator: 'CommandOrControl+Shift+L' }),
    ]));

    const editMenu = template[2];
    expect(editMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Find on Page', accelerator: 'CommandOrControl+F' }),
    ]));

    const viewMenu = template[3];
    expect(viewMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'toggleDevTools' }),
      expect.objectContaining({ label: 'Toggle Sidebar', accelerator: 'CommandOrControl+/' }),
      expect.objectContaining({ label: 'Toggle Right Rail', accelerator: 'CommandOrControl+\\' }),
      expect.objectContaining({ label: 'Conversation Mode', accelerator: 'F1' }),
      expect.objectContaining({ label: 'Workbench Mode', accelerator: 'F2' }),
      expect.objectContaining({ label: 'Zen Mode', accelerator: 'F3' }),
    ]));

    const windowMenu = template[4];
    expect(windowMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Hide Window' }),
    ]));
  });

  it('builds a non-mac file menu with quit actions', () => {
    const template = buildDesktopApplicationMenuTemplate(createActions(), {
      platform: 'linux',
      appName: 'Personal Agent',
    });

    expect(template.map((item) => item.label)).toEqual([
      'File',
      'Edit',
      'View',
      'Window',
    ]);

    const fileMenu = template[0];
    expect(fileMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Show Personal Agent', accelerator: 'CommandOrControl+Shift+A' }),
      expect.objectContaining({ label: 'New Window' }),
      expect.objectContaining({ label: 'New Conversation', accelerator: 'CommandOrControl+N' }),
      expect.objectContaining({ label: 'Close Tab', accelerator: 'CommandOrControl+W' }),
      expect.objectContaining({ label: 'Reopen Closed Tab', accelerator: 'Command+Shift+N' }),
      expect.objectContaining({ label: 'Previous Conversation', accelerator: 'CommandOrControl+[' }),
      expect.objectContaining({ label: 'Next Conversation', accelerator: 'CommandOrControl+]' }),
      expect.objectContaining({ label: 'Toggle Pinned', accelerator: 'CommandOrControl+Alt+P' }),
      expect.objectContaining({ label: 'Archive / Restore Conversation', accelerator: 'CommandOrControl+Alt+A' }),
      expect.objectContaining({ label: 'Rename Conversation', accelerator: 'CommandOrControl+Alt+R' }),
      expect.objectContaining({ label: 'Focus Composer', accelerator: 'CommandOrControl+L' }),
      expect.objectContaining({ label: 'Edit Working Directory', accelerator: 'CommandOrControl+Shift+L' }),
      expect.objectContaining({ label: 'Settings…', accelerator: 'CommandOrControl+,' }),
      expect.objectContaining({ label: 'Check for Updates…' }),
      expect.objectContaining({ label: 'Restart Runtime' }),
      expect.objectContaining({ label: 'Quit Personal Agent', accelerator: 'CommandOrControl+Q' }),
    ]));

    const editMenu = template[1];
    expect(editMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Find on Page', accelerator: 'CommandOrControl+F' }),
    ]));

    const viewMenu = template[2];
    expect(viewMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'toggleDevTools' }),
    ]));
  });
});
