import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopTopBar, readBrowserNavigationState } from './DesktopTopBar.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function renderTopBar(
  environment: React.ComponentProps<typeof DesktopTopBar>['environment'] = null,
  overrides: Partial<React.ComponentProps<typeof DesktopTopBar>> = {},
): string {
  return renderToString(
    <MemoryRouter>
      <DesktopTopBar
        environment={environment}
        sidebarOpen
        onToggleSidebar={() => {}}
        showRailToggle={false}
        railOpen={false}
        onToggleRail={() => {}}
        layoutMode="compact"
        onLayoutModeChange={() => {}}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DesktopTopBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ignores unsafe persisted browser navigation indexes', () => {
    const storage = new Map<string, string>([
      ['__pa_nav_max_idx__', String(Number.MAX_SAFE_INTEGER + 1)],
    ]);
    vi.stubGlobal('window', {
      history: { state: { idx: 0 } },
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    expect(readBrowserNavigationState()).toEqual({ canGoBack: false, canGoForward: false });
  });

  it('keeps desktop navigation chrome visible in Electron shells even when the preload bridge is missing', () => {
    vi.stubGlobal('window', {
      personalAgentDesktop: undefined,
      location: { search: '' },
      sessionStorage: {
        getItem: () => null,
      },
    });
    vi.stubGlobal('document', {
      documentElement: { dataset: {} },
    });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Electron/31.0.2',
    });

    const html = renderTopBar();

    expect(html).toContain('Go back');
  });

  it('renders a testing badge for command-line desktop launches', () => {
    const html = renderTopBar({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local runtime is healthy.',
      launchMode: 'testing',
      launchLabel: 'Testing',
    });

    expect(html).toContain('>Testing<');
    expect(html).toContain('Launched from the command line');
  });

  it('keeps the panel toggles on the outside edges of the top bar controls', () => {
    const html = renderTopBar({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local runtime is healthy.',
      launchMode: 'normal',
      launchLabel: null,
    }, { showRailToggle: true, railOpen: true });

    expect(html.indexOf('Hide sidebar')).toBeLessThan(html.indexOf('Go back'));
    expect(html.indexOf('Go back')).toBeLessThan(html.indexOf('Go forward'));
    expect(html.indexOf('Go forward')).toBeLessThan(html.indexOf('View mode'));
    expect(html.indexOf('View mode')).toBeLessThan(html.indexOf('Hide right sidebar'));
  });

  it('shows the view mode switcher in the top-right controls', () => {
    const html = renderTopBar({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local runtime is healthy.',
      launchMode: 'normal',
      launchLabel: null,
    }, { layoutMode: 'workbench' });

    expect(html).toContain('Workbench');
    expect(html).toContain('Compact');
    expect(html).toContain('Zen');
    expect(html).toContain('aria-checked="true"');
  });

  it('keeps zen windows focused by hiding sidebar controls and marking zen active', () => {
    const html = renderTopBar({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local runtime is healthy.',
      launchMode: 'normal',
      launchLabel: null,
    }, { zenMode: true });

    expect(html).toContain('>Zen<');
    expect(html).not.toContain('Hide sidebar');
    expect(html).toContain('title="Zen view"');
    expect(html).toContain('aria-checked="true"');
  });

  it('does not render desktop chrome outside the desktop shell', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Safari/605.1.15',
    });

    const html = renderTopBar();

    expect(html).not.toContain('Go back');
  });
});
