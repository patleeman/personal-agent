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
    expect(html.indexOf('Go forward')).toBeLessThan(html.indexOf('Choose layout'));
    expect(html.indexOf('Choose layout')).toBeLessThan(html.indexOf('Hide right sidebar'));
  });

  it('shows the active layout in the top-right layout control', () => {
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
    expect(html).toContain('Choose layout');
  });

  it('keeps zen windows focused by hiding layout and sidebar controls', () => {
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
    expect(html).not.toContain('Choose layout');
  });

  it('does not render desktop chrome outside the desktop shell', () => {
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Safari/605.1.15',
    });

    const html = renderTopBar();

    expect(html).not.toContain('Go back');
  });
});
