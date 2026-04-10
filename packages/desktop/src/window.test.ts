import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {},
}));

import { DesktopWindowController, canNavigateWindowInApp, toDesktopShellRoute, toDesktopShellUrl } from './window.js';

function createWindowDouble(currentUrl = '') {
  return {
    webContents: {
      getURL: vi.fn(() => currentUrl),
      isLoadingMainFrame: vi.fn(() => false),
      send: vi.fn(),
    },
    loadURL: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn(() => true),
    show: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

describe('window desktop navigation helpers', () => {
  it('keeps the desktop shell marker in full URLs but strips it from in-app routes', () => {
    expect(toDesktopShellUrl('http://127.0.0.1:3741/conversations/new')).toBe(
      'http://127.0.0.1:3741/conversations/new?desktop-shell=1',
    );
    expect(toDesktopShellRoute('http://127.0.0.1:3741/conversations/new?desktop-shell=1&view=wide#tail')).toBe(
      '/conversations/new?view=wide#tail',
    );
  });

  it('treats same-origin navigations as in-app route changes', () => {
    expect(canNavigateWindowInApp(
      'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
      'http://127.0.0.1:3741/conversations/new?desktop-shell=1',
    )).toBe(true);

    expect(canNavigateWindowInApp(
      'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
      'https://desktop.example.ts.net/conversations/new?desktop-shell=1',
    )).toBe(false);
  });
});

describe('DesktopWindowController', () => {
  it('navigates within the existing renderer for same-host routes', async () => {
    const controller = new DesktopWindowController({} as never);
    const window = createWindowDouble('http://127.0.0.1:3741/conversations/abc?desktop-shell=1');

    await (controller as unknown as { loadWindowUrl(window: unknown, url: string): Promise<void> }).loadWindowUrl(
      window,
      'http://127.0.0.1:3741/conversations/new',
    );

    expect(window.webContents.send).toHaveBeenCalledWith('personal-agent-desktop:navigate', {
      route: '/conversations/new',
      replace: false,
    });
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('falls back to a full load when the host changes', async () => {
    const controller = new DesktopWindowController({} as never);
    const window = createWindowDouble('http://127.0.0.1:3741/conversations/abc?desktop-shell=1');

    await (controller as unknown as { loadWindowUrl(window: unknown, url: string): Promise<void> }).loadWindowUrl(
      window,
      'https://desktop.example.ts.net/conversations/new',
    );

    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(window.loadURL).toHaveBeenCalledWith('https://desktop.example.ts.net/conversations/new?desktop-shell=1');
  });
});
