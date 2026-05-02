// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DesktopRemoteDirectoryListing } from '../shared/types';
import { RemoteDirectoryBrowserModal } from './RemoteDirectoryBrowserModal';

const apiMocks = vi.hoisted(() => ({
  remoteDirectory: vi.fn(),
}));

vi.mock('../client/api', () => ({
  api: apiMocks,
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];
const ROOT_PATH = '/Users/patrick/workingdir/personal-agent';
const PARENT_PATH = '/Users/patrick/workingdir';
const DOCS_PATH = `${ROOT_PATH}/docs`;
const PACKAGES_PATH = `${ROOT_PATH}/packages`;

const LISTINGS: Record<string, DesktopRemoteDirectoryListing> = {
  [PARENT_PATH]: {
    path: PARENT_PATH,
    parent: '/Users/patrick',
    entries: [{ name: 'personal-agent', path: ROOT_PATH, isDir: true, isHidden: false }],
  },
  [ROOT_PATH]: {
    path: ROOT_PATH,
    parent: PARENT_PATH,
    entries: [
      { name: 'docs', path: DOCS_PATH, isDir: true, isHidden: false },
      { name: 'packages', path: PACKAGES_PATH, isDir: true, isHidden: false },
    ],
  },
  [DOCS_PATH]: {
    path: DOCS_PATH,
    parent: ROOT_PATH,
    entries: [{ name: 'architecture', path: `${DOCS_PATH}/architecture`, isDir: true, isHidden: false }],
  },
  [PACKAGES_PATH]: {
    path: PACKAGES_PATH,
    parent: ROOT_PATH,
    entries: [
      { name: 'desktop', path: `${PACKAGES_PATH}/desktop`, isDir: true, isHidden: false },
      { name: 'web', path: `${PACKAGES_PATH}/web`, isDir: true, isHidden: false },
    ],
  },
};

function renderModal(overrides: Partial<React.ComponentProps<typeof RemoteDirectoryBrowserModal>> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onClose = vi.fn();
  const onSelect = vi.fn();

  act(() => {
    root.render(
      <RemoteDirectoryBrowserModal
        hostId="bender"
        hostLabel="Bender"
        initialPath={ROOT_PATH}
        onSelect={onSelect}
        onClose={onClose}
        {...overrides}
      />,
    );
  });

  mountedRoots.push(root);
  return { container, onClose, onSelect };
}

function getDialog(container: HTMLElement): HTMLDivElement {
  const dialog = container.querySelector('[role="dialog"]');
  if (!(dialog instanceof HTMLDivElement)) {
    throw new Error('Expected dialog element');
  }
  return dialog;
}

function readSelectedFolder(container: HTMLElement): string {
  const label = Array.from(container.querySelectorAll('p')).find((node) => node.textContent === 'Selected folder');
  const value = label?.parentElement?.querySelectorAll('p')[1]?.textContent?.trim();
  if (!value) {
    throw new Error('Selected folder value not found');
  }
  return value;
}

function pressKey(target: HTMLElement, key: string) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('RemoteDirectoryBrowserModal keyboard shortcuts', () => {
  beforeEach(() => {
    apiMocks.remoteDirectory.mockReset();
    apiMocks.remoteDirectory.mockImplementation(async (_hostId: string, path?: string | null) => {
      const resolvedPath = path ?? ROOT_PATH;
      const listing = LISTINGS[resolvedPath];
      if (!listing) {
        throw new Error(`Unexpected path ${resolvedPath}`);
      }
      return listing;
    });
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('moves selection with arrow keys', async () => {
    const { container } = renderModal();
    await flushAsyncWork();

    const dialog = getDialog(container);
    expect(readSelectedFolder(container)).toBe(ROOT_PATH);

    pressKey(dialog, 'ArrowDown');
    expect(readSelectedFolder(container)).toBe(PARENT_PATH);

    pressKey(dialog, 'ArrowDown');
    expect(readSelectedFolder(container)).toBe(DOCS_PATH);

    pressKey(dialog, 'ArrowUp');
    expect(readSelectedFolder(container)).toBe(PARENT_PATH);
  });

  it('opens the selected row on Enter and navigates up on Backspace', async () => {
    const { container } = renderModal();
    await flushAsyncWork();

    const dialog = getDialog(container);
    pressKey(dialog, 'ArrowDown');
    pressKey(dialog, 'ArrowDown');
    pressKey(dialog, 'ArrowDown');
    expect(readSelectedFolder(container)).toBe(PACKAGES_PATH);

    pressKey(dialog, 'Enter');
    await flushAsyncWork();
    expect(apiMocks.remoteDirectory).toHaveBeenLastCalledWith('bender', PACKAGES_PATH);
    expect(readSelectedFolder(container)).toBe(PACKAGES_PATH);

    pressKey(dialog, 'Backspace');
    await flushAsyncWork();
    expect(apiMocks.remoteDirectory).toHaveBeenLastCalledWith('bender', ROOT_PATH);
    expect(readSelectedFolder(container)).toBe(ROOT_PATH);
  });

  it('closes on Escape', async () => {
    const { container, onClose } = renderModal();
    await flushAsyncWork();

    pressKey(getDialog(container), 'Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
