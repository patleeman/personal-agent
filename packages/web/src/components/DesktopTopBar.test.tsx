import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopTopBar } from './DesktopTopBar.js';

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
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DesktopTopBar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the connections icon visible in Electron shells even when the preload bridge is missing', () => {
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

    expect(html).toContain('aria-label="Manage connections');
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
      canManageConnections: true,
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
      canManageConnections: true,
    }, { showRailToggle: true, railOpen: true });

    expect(html.indexOf('Hide sidebar')).toBeLessThan(html.indexOf('Go back'));
    expect(html.indexOf('Go back')).toBeLessThan(html.indexOf('Go forward'));
    expect(html.indexOf('aria-label="Manage connections')).toBeLessThan(html.indexOf('Hide right sidebar'));
  });

  it('does not render desktop chrome outside the desktop shell', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Safari/605.1.15',
    });

    const html = renderTopBar();

    expect(html).not.toContain('aria-label="Manage connections');
    expect(html).not.toContain('Go back');
  });
});
