import { describe, expect, it } from 'vitest';

import { buildDesktopTrayMenuTemplate } from './tray.js';

// ── tray — menu template builder ──────────────────────────────────────────

describe('buildDesktopTrayMenuTemplate', () => {
  it('shows starting state', () => {
    const items = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'starting' },
      actions: {} as ReturnType<typeof buildDesktopTrayMenuTemplate> extends never
        ? never
        : Parameters<typeof buildDesktopTrayMenuTemplate>[0]['actions'],
    });

    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) =>
          'label' in item && typeof item.label === 'string' && item.label.includes('Launching'),
      ),
    ).toBe(true);
  });

  it('shows ready state with working menu items', () => {
    const items = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'ready' },
      actions: {
        onNewConversation: () => {},
      } as unknown as Parameters<typeof buildDesktopTrayMenuTemplate>[0]['actions'],
    });

    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'New Conversation'),
    ).toBe(true);
  });

  it('shows error state with truncated message', () => {
    const items = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'error', message: 'Something went wrong with the backend.' },
      actions: {} as ReturnType<typeof buildDesktopTrayMenuTemplate> extends never
        ? never
        : Parameters<typeof buildDesktopTrayMenuTemplate>[0]['actions'],
    });

    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Startup failed'),
    ).toBe(true);
    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Retry Personal Agent',
      ),
    ).toBe(true);
    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Open Desktop Logs'),
    ).toBe(true);
  });

  it('includes clip URL from clipboard when ready', () => {
    const items = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'ready' },
      actions: {} as ReturnType<typeof buildDesktopTrayMenuTemplate> extends never
        ? never
        : Parameters<typeof buildDesktopTrayMenuTemplate>[0]['actions'],
    });

    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Clip URL from Clipboard',
      ),
    ).toBe(true);
  });

  it('includes Settings and Quit', () => {
    const items = buildDesktopTrayMenuTemplate({
      startupState: { kind: 'ready' },
      actions: {
        onSettings: () => {},
        onQuit: () => {},
      } as unknown as Parameters<typeof buildDesktopTrayMenuTemplate>[0]['actions'],
    });

    expect(
      items.some((item: Electron.MenuItemConstructorOptions | Electron.MenuItem) => 'label' in item && item.label === 'Settings…'),
    ).toBe(true);
    expect(
      items.some(
        (item: Electron.MenuItemConstructorOptions | Electron.MenuItem) =>
          ('label' in item && (item as { label?: string }).label === 'Quit Personal Agent') || item.label === 'Quit Personal Agent',
      ),
    ).toBe(true);
  });
});
