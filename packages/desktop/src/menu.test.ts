import { describe, expect, it, vi } from 'vitest';
import { buildDesktopApplicationMenuTemplate } from './menu.js';

function createActions() {
  return {
    onOpen: vi.fn(),
    onNewConversation: vi.fn(),
    onCloseConversation: vi.fn(),
    onPreviousConversation: vi.fn(),
    onNextConversation: vi.fn(),
    onConnections: vi.fn(),
    onCheckForUpdates: vi.fn(),
    onRestartBackend: vi.fn(),
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
      expect.objectContaining({ label: 'Connections…', accelerator: 'CommandOrControl+,' }),
      expect.objectContaining({ label: 'Quit Personal Agent', accelerator: 'CommandOrControl+Q' }),
    ]));

    const fileMenu = template[1];
    expect(fileMenu?.submenu).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Close Conversation', accelerator: 'CommandOrControl+W' }),
      expect.objectContaining({ label: 'Previous Conversation', accelerator: 'CommandOrControl+[' }),
      expect.objectContaining({ label: 'Next Conversation', accelerator: 'CommandOrControl+]' }),
    ]));
    expect(fileMenu?.submenu).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Connections…' }),
      expect.objectContaining({ role: 'close' }),
    ]));
  });

  it('builds a non-mac file menu with connections and quit actions', () => {
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
      expect.objectContaining({ label: 'Open Personal Agent', accelerator: 'CommandOrControl+Shift+A' }),
      expect.objectContaining({ label: 'New Conversation', accelerator: 'CommandOrControl+N' }),
      expect.objectContaining({ label: 'Close Conversation', accelerator: 'CommandOrControl+W' }),
      expect.objectContaining({ label: 'Previous Conversation', accelerator: 'CommandOrControl+[' }),
      expect.objectContaining({ label: 'Next Conversation', accelerator: 'CommandOrControl+]' }),
      expect.objectContaining({ label: 'Connections…', accelerator: 'CommandOrControl+,' }),
      expect.objectContaining({ label: 'Check for Updates…' }),
      expect.objectContaining({ label: 'Restart Backend' }),
      expect.objectContaining({ label: 'Quit Personal Agent', accelerator: 'Alt+F4' }),
    ]));
  });
});
