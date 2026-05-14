// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NativeExtensionSurfaceHost } from './NativeExtensionSurfaceHost';
import type { NativeExtensionViewSummary } from './types';

const apiMocks = vi.hoisted(() => ({
  automations: {
    list: vi.fn(async () => []),
    readSchedulerHealth: vi.fn(async () => ({ status: 'healthy', staleAfterSeconds: 60, checkedAt: '2026-05-08T00:00:00.000Z' })),
  },
  invokeExtensionAction: vi.fn(),
  extensionManifest: vi.fn(),
  extensionSurfacesForExtension: vi.fn(),
  startExtensionRun: vi.fn(),
  durableRun: vi.fn(),
  runs: vi.fn(),
  durableRunLog: vi.fn(),
  cancelDurableRun: vi.fn(),
  extensionState: vi.fn(),
  putExtensionState: vi.fn(),
  deleteExtensionState: vi.fn(),
  extensionStateList: vi.fn(),
}));

vi.mock('../client/api', () => ({ api: apiMocks }));
vi.mock('./systemExtensionModules', () => ({
  systemExtensionModules: new Map([
    [
      'system-automations',
      async () => ({
        AutomationsPage: (await import('../../../../../extensions/system-automations/src/frontend')).AutomationsPage,
      }),
    ],
  ]),
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => root.unmount());
  }
  mountedRoots.length = 0;
  vi.clearAllMocks();
});

describe('NativeExtensionSurfaceHost', () => {
  it('lazy-loads a native system extension component with PA props', async () => {
    const surface: NativeExtensionViewSummary = {
      extensionId: 'system-automations',
      id: 'page',
      title: 'Automations',
      location: 'main',
      route: '/automations',
      component: 'AutomationsPage',
      frontend: { entry: 'dist/frontend.js' },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(async () => {
      root.render(<NativeExtensionSurfaceHost surface={surface} pathname="/automations" search="" hash="" />);
    });

    await vi.waitFor(() => expect(container.textContent).toContain('Automations'));
    expect(container.textContent).toContain('scheduled or conversation-bound agent work');
    expect(apiMocks.automations.list).toHaveBeenCalled();
  });
});
