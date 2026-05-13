// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  buildExtension: vi.fn(),
  exportExtension: vi.fn(),
  extensionInstallations: vi.fn(),
  notifyExtensionRegistryChanged: vi.fn(),
  openPath: vi.fn(),
  reloadExtension: vi.fn(),
  validateExtension: vi.fn(),
}));

vi.mock('@personal-agent/extensions/data', () => ({
  api: {
    buildExtension: mocks.buildExtension,
    exportExtension: mocks.exportExtension,
    extensionInstallations: mocks.extensionInstallations,
    reloadExtension: mocks.reloadExtension,
    validateExtension: mocks.validateExtension,
  },
  EXTENSION_REGISTRY_CHANGED_EVENT: 'pa-extension-registry-changed',
  notifyExtensionRegistryChanged: mocks.notifyExtensionRegistryChanged,
}));

vi.mock('@personal-agent/extensions/workbench', () => ({
  getDesktopBridge: () => ({
    openPath: mocks.openPath,
  }),
}));

import { ExtensionManagerPage } from './frontend';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createExtension() {
  return {
    id: 'menu-test',
    name: 'Menu Test',
    description: 'Extension menu feedback test.',
    enabled: true,
    status: 'enabled',
    packageType: 'user',
    packageRoot: '/tmp/menu-test',
    routes: [],
    manifest: { contributes: { views: [] } },
    diagnostics: [],
    errors: [],
    skills: [],
    tools: [],
    backendActions: [],
    permissions: [],
  } as never;
}

function renderPage(options?: { toast?: ReturnType<typeof vi.fn>; notify?: ReturnType<typeof vi.fn> }) {
  const toast = options?.toast ?? vi.fn();
  const notify = options?.notify ?? vi.fn();

  render(
    <MemoryRouter>
      <ExtensionManagerPage pa={{ ui: { toast, notify } } as never} context={{} as never} surface={{} as never} params={{}} />
    </MemoryRouter>,
  );

  return { toast, notify };
}

describe('ExtensionManagerPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.extensionInstallations.mockResolvedValue([createExtension()]);
    mocks.reloadExtension.mockResolvedValue({ ok: true, id: 'menu-test', reloaded: true, message: 'Extension backend reloaded.' });
    mocks.validateExtension.mockResolvedValue({
      ok: true,
      extensionId: 'menu-test',
      packageRoot: '/tmp/menu-test',
      findings: [],
      summary: { errors: 0, warnings: 0, info: 0 },
    });
  });

  it('shows row-level progress and a sticky success notice for build actions', async () => {
    const build = deferred<{ ok: true; extensionId: string; outputs: string[] }>();
    mocks.buildExtension.mockReturnValue(build.promise);
    renderPage();

    await screen.findByText('Menu Test');
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Build'));

    expect(screen.getByText('Working…')).toBeTruthy();

    build.resolve({ ok: true, extensionId: 'menu-test', outputs: ['dist/frontend.js'] });

    await waitFor(() => {
      expect(screen.getByText('Built 1 bundle output.')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText('Working…')).toBeNull();
    });
    expect(mocks.reloadExtension).toHaveBeenCalledWith('menu-test');
  });

  it('shows extension doctor validation findings from the actions menu', async () => {
    mocks.validateExtension.mockResolvedValue({
      ok: false,
      extensionId: 'menu-test',
      packageRoot: '/tmp/menu-test',
      findings: [
        {
          severity: 'error',
          code: 'missing-frontend-dist',
          message: 'Frontend entry is missing: dist/frontend.js',
          fix: 'Build the extension.',
        },
      ],
      summary: { errors: 1, warnings: 0, info: 0 },
    });
    renderPage();

    await screen.findByText('Menu Test');
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Validate'));

    await waitFor(() => {
      expect(screen.getByText('Menu Test validation found 1 error and 0 warnings.')).toBeTruthy();
    });
    expect(screen.getByText(/ERROR missing-frontend-dist/)).toBeTruthy();
  });

  it('reports export failures without replacing the page', async () => {
    mocks.exportExtension.mockRejectedValue(new Error('export broke'));
    const { notify } = renderPage();

    await screen.findByText('Menu Test');
    fireEvent.click(screen.getByLabelText('More actions'));
    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Export failed for Menu Test: export broke',
          source: 'system-extension-manager',
          type: 'error',
        }),
      );
    });
    expect(screen.getByText('Menu Test')).toBeTruthy();
  });
});
