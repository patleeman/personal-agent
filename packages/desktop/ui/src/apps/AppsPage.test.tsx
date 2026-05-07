// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppsPage } from './AppsPage';
import * as appListModule from './useAppList';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push(root);

  act(() => {
    root.render(
      <MemoryRouter>
        <AppsPage />
      </MemoryRouter>,
    );
  });

  return container;
}

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots.length = 0;
  vi.restoreAllMocks();
});

const sampleApps = [
  {
    id: 'app-1',
    name: 'Test App',
    description: 'A test application',
    prompt: 'Create a test app',
    nav: [{ label: 'Home', entry: 'index.html' }],
    entry: 'index.html',
    servePath: '/apps/app-1',
  },
  {
    id: 'app-2',
    name: 'Multi Page App',
    description: 'An app with multiple pages',
    prompt: 'Create a multi-page app',
    nav: [
      { label: 'Page 1', entry: 'page1.html' },
      { label: 'Page 2', entry: 'page2.html' },
    ],
    entry: 'index.html',
    servePath: '/apps/app-2',
  },
];

function createMockUseAppList(overrides: Record<string, unknown> = {}) {
  const defaults = { apps: [], loading: false, error: null };
  return vi
    .spyOn(appListModule, 'useAppList')
    .mockReturnValue({ ...defaults, ...overrides } as ReturnType<typeof appListModule.useAppList>);
}

// ── Apps page ────────────────────────────────────────────────────────────────

describe('AppsPage', () => {
  it('shows loading state initially', () => {
    createMockUseAppList({ loading: true });
    const c = renderPage();
    expect(c.textContent).toContain('Loading apps…');
  });

  it('shows error state when useAppList errors', () => {
    createMockUseAppList({ error: 'Failed to fetch apps.' });
    const c = renderPage();
    expect(c.textContent).toContain('Failed to fetch apps.');
  });

  it('shows empty state when no apps configured', () => {
    createMockUseAppList({ apps: [] });
    const c = renderPage();
    expect(c.textContent).toContain('No apps yet');
  });

  it('renders app cards in a list', () => {
    createMockUseAppList({ apps: sampleApps });
    const c = renderPage();
    expect(c.textContent).toContain('Test App');
    expect(c.textContent).toContain('A test application');
    expect(c.textContent).toContain('Multi Page App');
    expect(c.textContent).toContain('2 pages');
  });

  it('shows prompt preview on app cards', () => {
    createMockUseAppList({ apps: sampleApps });
    const c = renderPage();
    expect(c.textContent).toContain('Create a test app');
  });

  it('renders single-page label', () => {
    createMockUseAppList({ apps: [sampleApps[0]] });
    const c = renderPage();
    expect(c.textContent).toContain('Single page');
  });
});
