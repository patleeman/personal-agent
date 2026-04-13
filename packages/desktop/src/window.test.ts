import { describe, expect, it, vi } from 'vitest';

const { electronApp, getFocusedWindow } = vi.hoisted(() => ({
  electronApp: {
    name: 'Personal Agent',
    isPackaged: false,
    getAppPath: vi.fn(() => '/tmp/app'),
    setActivationPolicy: vi.fn(() => true),
    dock: {
      show: vi.fn(),
      hide: vi.fn(),
    },
  },
  getFocusedWindow: vi.fn(() => null),
}));

vi.mock('electron', () => ({
  BrowserWindow: class BrowserWindow {
    static getFocusedWindow = getFocusedWindow;
  },
  app: electronApp,
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
  },
  screen: {
    getAllDisplays: vi.fn(() => []),
  },
  shell: {
    openExternal: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => ({
      protocol: {
        handle: vi.fn(),
        unhandle: vi.fn(),
      },
    })),
  },
}));

import {
  DesktopWindowController,
  buildWindowTitle,
  canNavigateWindowInApp,
  constrainDesktopWindowBounds,
  getDesktopWindowChromeOptions,
  shouldOpenNavigationExternally,
  shouldOpenWindowExternally,
  toDesktopShellRoute,
  toDesktopShellUrl,
} from './window.js';

function createWindowDouble(currentUrl = '') {
  let visible = true;

  return {
    webContents: {
      getURL: vi.fn(() => currentUrl),
      isLoadingMainFrame: vi.fn(() => false),
      send: vi.fn(),
    },
    loadURL: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn(() => visible),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(() => {
      visible = true;
    }),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
  };
}

describe('window desktop navigation helpers', () => {
  it('uses the inset macOS title bar style so traffic lights stay visible', () => {
    expect(getDesktopWindowChromeOptions('darwin')).toEqual({
      titleBarStyle: 'hiddenInset',
    });
  });

  it('keeps the existing hidden custom chrome outside macOS', () => {
    expect(getDesktopWindowChromeOptions('linux')).toEqual({
      titleBarStyle: 'hidden',
    });
  });

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

  it('opens target-blank web links in the system browser instead of a new desktop window', () => {
    expect(shouldOpenWindowExternally('https://example.com/docs')).toBe(true);
    expect(shouldOpenWindowExternally('mailto:patrick@example.com')).toBe(true);
    expect(shouldOpenWindowExternally('personal-agent://app/conversations/new')).toBe(false);
  });

  it('redirects cross-origin navigations to the system browser while keeping in-app routes local', () => {
    expect(shouldOpenNavigationExternally(
      'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
      'https://example.com/docs',
    )).toBe(true);

    expect(shouldOpenNavigationExternally(
      'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
      'http://127.0.0.1:3741/settings?desktop-shell=1',
    )).toBe(false);
  });

  it('includes the current app name in window titles so testing launches stand out', () => {
    electronApp.name = 'Personal Agent Testing';

    expect(buildWindowTitle({ id: 'local', label: 'Local', kind: 'local' })).toBe('Personal Agent Testing');
    expect(buildWindowTitle({ id: 'web-1', label: 'Tailnet', kind: 'web', baseUrl: 'https://tailnet.example.ts.net' })).toBe(
      'Personal Agent Testing — Tailnet (Web remote)',
    );

    electronApp.name = 'Personal Agent';
  });

  it('re-centers saved off-screen bounds onto the available display', () => {
    expect(constrainDesktopWindowBounds(
      {
        x: 2052,
        y: 749,
        width: 1788,
        height: 1411,
      },
      [
        {
          x: 0,
          y: 0,
          width: 1512,
          height: 982,
        },
      ],
    )).toEqual({
      x: 0,
      y: 0,
      width: 1512,
      height: 982,
    });
  });

  it('preserves visible bounds and offsets remote windows without leaving the display', () => {
    expect(constrainDesktopWindowBounds(
      {
        x: 120,
        y: 80,
        width: 1100,
        height: 780,
      },
      [
        {
          x: 0,
          y: 0,
          width: 1512,
          height: 982,
        },
      ],
      28,
    )).toEqual({
      x: 148,
      y: 108,
      width: 1100,
      height: 780,
    });
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

  it('opens an additional window for the current route', async () => {
    getFocusedWindow.mockReturnValue(null);

    const controller = new DesktopWindowController({
      getActiveHostId: () => 'local-host',
    } as never);
    const openWindowForHost = vi.fn().mockResolvedValue(undefined);
    const mainWindow = createWindowDouble('http://127.0.0.1:3741/conversations/abc?desktop-shell=1&view=wide#tail');

    (controller as unknown as { openWindowForHost: typeof openWindowForHost }).openWindowForHost = openWindowForHost;
    (controller as unknown as { mainWindow: typeof mainWindow }).mainWindow = mainWindow;

    await controller.openNewWindow();

    expect(openWindowForHost).toHaveBeenCalledWith('local-host', '/conversations/abc?view=wide#tail', 'remote');
  });
});
