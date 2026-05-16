import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { name: 'Personal Agent' },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  session: {
    fromPartition: () => ({
      protocol: { handle: vi.fn() },
      setProxy: vi.fn(),
    }),
  },
  screen: {
    getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
  },
  BrowserWindow: class MockBrowserWindow {},
}));

import {
  buildWindowTitle,
  canNavigateWindowInApp,
  constrainDesktopWindowBounds,
  getDesktopWindowChromeOptions,
  shouldGrantDesktopMediaPermission,
  shouldOpenNavigationExternally,
  shouldOpenWindowExternally,
  toDesktopShellRoute,
  toDesktopShellUrl,
} from './window.js';

// ── window — desktop window helper functions ─────────────────────────────

describe('getDesktopWindowChromeOptions', () => {
  it('returns hiddenInset title bar with top-bar aligned traffic lights on macOS', () => {
    const options = getDesktopWindowChromeOptions('darwin');
    expect(options.titleBarStyle).toBe('hiddenInset');
    expect(options.trafficLightPosition).toEqual({ x: 14, y: 14 });
  });

  it('returns hidden title bar on non-macOS', () => {
    const options = getDesktopWindowChromeOptions('win32');
    expect(options.titleBarStyle).toBe('hidden');
  });
});

describe('toDesktopShellUrl', () => {
  it('adds desktop-shell=1 query param', () => {
    const url = toDesktopShellUrl('https://app.personal-agent.dev/settings');
    expect(url).toContain('desktop-shell=1');
    expect(url).toContain('settings');
  });
});

describe('toDesktopShellRoute', () => {
  it('extracts the route path removing desktop-shell param', () => {
    const route = toDesktopShellRoute('https://app.personal-agent.dev/conversations/new?desktop-shell=1');
    expect(route).toBe('/conversations/new');
  });

  it('preserves other search params', () => {
    const route = toDesktopShellRoute('https://app.personal-agent.dev/conv/123?file=doc.md&desktop-shell=1');
    expect(route).toContain('file=doc');
    expect(route).not.toContain('desktop-shell');
  });
});

describe('canNavigateWindowInApp', () => {
  it('allows same-origin navigation', () => {
    expect(canNavigateWindowInApp('https://app.dev/conv/1', 'https://app.dev/conv/2')).toBe(true);
  });

  it('blocks cross-origin navigation', () => {
    expect(canNavigateWindowInApp('https://app.dev', 'https://evil.com')).toBe(false);
  });

  it('returns false for invalid URLs', () => {
    expect(canNavigateWindowInApp('', 'https://app.dev')).toBe(false);
    expect(canNavigateWindowInApp('not-a-url', 'https://app.dev')).toBe(false);
  });
});

describe('shouldOpenWindowExternally', () => {
  it('opens http/https URLs externally', () => {
    expect(shouldOpenWindowExternally('https://example.com')).toBe(true);
    expect(shouldOpenWindowExternally('http://localhost:3000')).toBe(true);
  });

  it('opens mailto: externally', () => {
    expect(shouldOpenWindowExternally('mailto:test@example.com')).toBe(true);
  });

  it('opens tel: externally', () => {
    expect(shouldOpenWindowExternally('tel:+1234567890')).toBe(true);
  });

  it('keeps app-internal URLs in-app', () => {
    expect(shouldOpenWindowExternally('personal-agent://app/settings')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(shouldOpenWindowExternally('')).toBe(false);
  });
});

describe('shouldOpenNavigationExternally', () => {
  it('opens external URLs even when current URL is valid', () => {
    expect(shouldOpenNavigationExternally('https://app.dev', 'https://evil.com')).toBe(true);
  });

  it('keeps same-origin URLs in-app', () => {
    expect(shouldOpenNavigationExternally('https://app.dev', 'https://app.dev/settings')).toBe(false);
  });
});

describe('shouldGrantDesktopMediaPermission', () => {
  it('allows app-local media and microphone permission requests', () => {
    expect(shouldGrantDesktopMediaPermission('personal-agent://app/conversations/new', 'media')).toBe(true);
    expect(shouldGrantDesktopMediaPermission('personal-agent://app/conversations/new', 'microphone')).toBe(true);
  });

  it('blocks non-app origins and unrelated permissions', () => {
    expect(shouldGrantDesktopMediaPermission('https://example.com', 'media')).toBe(false);
    expect(shouldGrantDesktopMediaPermission('personal-agent://app/conversations/new', 'camera')).toBe(false);
  });
});

describe('buildWindowTitle', () => {
  it('uses app name for local hosts', () => {
    const title = buildWindowTitle({ kind: 'local', id: 'local' } as unknown as Parameters<typeof buildWindowTitle>[0]);
    expect(title).toBe('Personal Agent');
  });
});

describe('constrainDesktopWindowBounds', () => {
  const fallbackDisplay = { x: 0, y: 0, width: 1920, height: 1080 };

  it('clamps width and height to min/max thresholds', () => {
    const result = constrainDesktopWindowBounds({ width: 100, height: 100 }, [fallbackDisplay]);
    expect(result.width).toBeGreaterThanOrEqual(720);
    expect(result.height).toBeGreaterThanOrEqual(520);
  });

  it('clamps width to max threshold', () => {
    const result = constrainDesktopWindowBounds({ width: 10_000, height: 10_000 }, [fallbackDisplay]);
    expect(result.width).toBeLessThanOrEqual(4096);
    expect(result.height).toBeLessThanOrEqual(4096);
  });

  it('centers on the display when no saved position', () => {
    const result = constrainDesktopWindowBounds({ width: 1440, height: 960 }, [fallbackDisplay]);
    expect(result.x).toBeGreaterThanOrEqual(0);
    expect(result.y).toBeGreaterThanOrEqual(0);
  });

  it('applies remote offset to the x coordinate', () => {
    const result = constrainDesktopWindowBounds({ width: 1440, height: 960, x: 100, y: 100 }, [fallbackDisplay], 28);
    expect(result.x).toBe(128);
  });

  it('returns sensible defaults for empty display list', () => {
    const result = constrainDesktopWindowBounds({ width: 1440, height: 960 }, []);
    expect(result.width).toBeGreaterThanOrEqual(720);
    expect(result.height).toBeGreaterThanOrEqual(520);
  });
});
