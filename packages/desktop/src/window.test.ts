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
  buildWindowTitle,
  canNavigateWindowInApp,
  constrainDesktopWindowBounds,
  DesktopWindowController,
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
    expect(toDesktopShellUrl('http://127.0.0.1:3741/conversations/new')).toBe('http://127.0.0.1:3741/conversations/new?desktop-shell=1');
    expect(toDesktopShellRoute('http://127.0.0.1:3741/conversations/new?desktop-shell=1&view=wide#tail')).toBe(
      '/conversations/new?view=wide#tail',
    );
  });

  it('treats same-origin navigations as in-app route changes', () => {
    expect(
      canNavigateWindowInApp(
        'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
        'http://127.0.0.1:3741/conversations/new?desktop-shell=1',
      ),
    ).toBe(true);

    expect(
      canNavigateWindowInApp(
        'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
        'https://desktop.example.ts.net/conversations/new?desktop-shell=1',
      ),
    ).toBe(false);
  });

  it('opens target-blank web links in the system browser instead of a new desktop window', () => {
    expect(shouldOpenWindowExternally('https://example.com/docs')).toBe(true);
    expect(shouldOpenWindowExternally('mailto:user@example.com')).toBe(true);
    expect(shouldOpenWindowExternally('personal-agent://app/conversations/new')).toBe(false);
  });

  it('redirects cross-origin navigations to the system browser while keeping in-app routes local', () => {
    expect(shouldOpenNavigationExternally('http://127.0.0.1:3741/conversations/abc?desktop-shell=1', 'https://example.com/docs')).toBe(
      true,
    );

    expect(
      shouldOpenNavigationExternally(
        'http://127.0.0.1:3741/conversations/abc?desktop-shell=1',
        'http://127.0.0.1:3741/settings?desktop-shell=1',
      ),
    ).toBe(false);
  });

  it('includes the current app name in window titles so testing launches stand out', () => {
    electronApp.name = 'Personal Agent Testing';

    expect(buildWindowTitle({ id: 'local', label: 'Local', kind: 'local' })).toBe('Personal Agent Testing');
    expect(buildWindowTitle({ id: 'ssh-1', label: 'Bender', kind: 'ssh', sshTarget: 'user@bender' })).toBe(
      'Personal Agent Testing — Bender (SSH remote)',
    );

    electronApp.name = 'Personal Agent';
  });

  it('re-centers saved off-screen bounds onto the available display', () => {
    expect(
      constrainDesktopWindowBounds(
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
      ),
    ).toEqual({
      x: 0,
      y: 0,
      width: 1512,
      height: 982,
    });
  });

  it('falls back from unsafe saved window bounds', () => {
    expect(
      constrainDesktopWindowBounds(
        {
          x: Number.MAX_SAFE_INTEGER + 1,
          y: 40,
          width: Number.MAX_SAFE_INTEGER + 1,
          height: 700,
        },
        [
          {
            x: 0,
            y: 0,
            width: 1512,
            height: 982,
          },
        ],
      ),
    ).toEqual({
      x: 36,
      y: 141,
      width: 1440,
      height: 700,
    });
  });

  it('falls back from absurd saved window bounds', () => {
    expect(
      constrainDesktopWindowBounds(
        {
          x: Number.MAX_SAFE_INTEGER,
          y: 40,
          width: Number.MAX_SAFE_INTEGER,
          height: 700,
        },
        [
          {
            x: 0,
            y: 0,
            width: 1512,
            height: 982,
          },
        ],
      ),
    ).toEqual({
      x: 36,
      y: 141,
      width: 1440,
      height: 700,
    });
  });

  it('falls back from fractional saved window bounds', () => {
    expect(
      constrainDesktopWindowBounds(
        {
          x: 12.5,
          y: 40.5,
          width: 1000.5,
          height: 700.5,
        },
        [
          {
            x: 0,
            y: 0,
            width: 1512,
            height: 982,
          },
        ],
      ),
    ).toEqual({
      x: 36,
      y: 11,
      width: 1440,
      height: 960,
    });
  });

  it('preserves visible bounds and offsets remote windows without leaving the display', () => {
    expect(
      constrainDesktopWindowBounds(
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
      ),
    ).toEqual({
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

  it('reuses the existing main window route without re-resolving the host base URL', async () => {
    const controller = new DesktopWindowController({
      getActiveHostId: vi.fn(() => {
        throw new Error('should not re-resolve the active host');
      }),
      getHostBaseUrl: vi.fn(() => {
        throw new Error('should not re-resolve the host base URL');
      }),
    } as never);
    const window = createWindowDouble('http://127.0.0.1:3741/conversations/abc?desktop-shell=1');

    (controller as unknown as { mainWindow: typeof window }).mainWindow = window;

    await controller.openMainWindow('/settings');

    expect(window.webContents.send).toHaveBeenCalledWith('personal-agent-desktop:navigate', {
      route: '/settings',
      replace: false,
    });
    expect(window.loadURL).not.toHaveBeenCalled();
  });

  it('does not navigate or focus the main window for background Workbench Browser commands', async () => {
    const controller = new DesktopWindowController({} as never);
    const window = createWindowDouble('http://127.0.0.1:3741/conversations/current?desktop-shell=1');
    const cdp = vi.fn().mockResolvedValue({ ok: true, results: [], state: {} });

    (controller as unknown as { mainWindow: typeof window; workbenchBrowser: { cdp: typeof cdp } }).mainWindow = window;
    (controller as unknown as { workbenchBrowser: { cdp: typeof cdp } }).workbenchBrowser = { cdp };

    await controller.cdpWorkbenchBrowserForConversation({
      conversationId: 'background-conversation',
      command: { method: 'Runtime.evaluate' },
    });

    expect(window.webContents.send).not.toHaveBeenCalled();
    expect(window.loadURL).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    expect(cdp).toHaveBeenCalledWith(window.webContents, {
      conversationId: 'background-conversation',
      command: { method: 'Runtime.evaluate' },
      sessionKey: 'background-conversation',
    });
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

  it('opens conversation popouts as focused zen windows without reusing the secondary host window', async () => {
    const controller = new DesktopWindowController({
      getActiveHostId: () => 'local-host',
    } as never);
    const openWindowForHost = vi.fn().mockResolvedValue(undefined);

    (controller as unknown as { openWindowForHost: typeof openWindowForHost }).openWindowForHost = openWindowForHost;

    await controller.openConversationPopoutWindow({ conversationId: 'conv 123' });

    expect(openWindowForHost).toHaveBeenCalledWith('local-host', '/conversations/conv%20123?view=zen', 'popout');
  });
});
