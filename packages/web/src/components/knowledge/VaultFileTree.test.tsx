// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { VaultFileTree } from './VaultFileTree';
import { KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY } from '../../local/knowledgeOpenFiles';
import { KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY } from '../../local/knowledgeTreeState';
import type { VaultEntry, VaultFileListResult } from '../../shared/types';

const apiMocks = vi.hoisted(() => ({
  createFolder: vi.fn(),
  deleteFile: vi.fn(),
  move: vi.fn(),
  rename: vi.fn(),
  search: vi.fn(),
  tree: vi.fn(),
  vaultFiles: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../../client/api', () => ({
  api: {
    vaultFiles: apiMocks.vaultFiles,
  },
  vaultApi: {
    createFolder: apiMocks.createFolder,
    deleteFile: apiMocks.deleteFile,
    move: apiMocks.move,
    rename: apiMocks.rename,
    search: apiMocks.search,
    tree: apiMocks.tree,
    writeFile: apiMocks.writeFile,
  },
}));

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, value);
    },
  } as Storage;
}

const mountedRoots: Root[] = [];
const UPDATED_AT = '2026-04-22T12:00:00.000Z';

function createEntry(id: string, kind: VaultEntry['kind']): VaultEntry {
  const trimmed = id.endsWith('/') ? id.slice(0, -1) : id;
  const name = trimmed.split('/').filter(Boolean).pop() ?? trimmed;
  return {
    id,
    kind,
    name,
    path: trimmed,
    sizeBytes: 0,
    updatedAt: UPDATED_AT,
  };
}

const TREE: VaultFileListResult = {
  root: '/vault',
  files: [
    createEntry('notes/', 'folder'),
    createEntry('notes/work/', 'folder'),
    createEntry('notes/work/todo.md', 'file'),
    createEntry('notes/today.md', 'file'),
    createEntry('projects/', 'folder'),
    createEntry('README.md', 'file'),
  ],
};

function renderTree() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onFileSelect = vi.fn();

  act(() => {
    root.render(<VaultFileTree activeFileId={null} onFileSelect={onFileSelect} />);
  });

  mountedRoots.push(root);
  return { container, onFileSelect };
}

function ManagedTree({ initialActiveFileId = null }: { initialActiveFileId?: string | null }) {
  const [activeFileId, setActiveFileId] = React.useState<string | null>(initialActiveFileId);
  return <VaultFileTree activeFileId={activeFileId} onFileSelect={setActiveFileId} />;
}

function renderManagedTree(initialActiveFileId?: string | null) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ManagedTree initialActiveFileId={initialActiveFileId} />);
  });

  mountedRoots.push(root);
  return { container };
}

function queryInShadowRoots(root: ParentNode, selector: string): Element | null {
  const directMatch = root.querySelector(selector);
  if (directMatch) {
    return directMatch;
  }

  const elements = root.querySelectorAll('*');
  for (const element of elements) {
    if (element instanceof HTMLElement && element.shadowRoot) {
      const nestedMatch = queryInShadowRoots(element.shadowRoot, selector);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
}

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = queryInShadowRoots(container, `button[aria-label="${label}"]`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected button ${label}`);
  }
  return button;
}

function click(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('VaultFileTree', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    apiMocks.vaultFiles.mockReset();
    apiMocks.vaultFiles.mockResolvedValue(TREE);
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('persists expanded folders and restores them after remount', async () => {
    const firstRender = renderTree();
    await flushAsyncWork();

    click(getButton(firstRender.container, 'notes'));
    await flushAsyncWork();
    click(getButton(firstRender.container, 'work'));
    await flushAsyncWork();

    expect(JSON.parse(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY) ?? '[]')).toEqual(['notes/', 'notes/work/']);

    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    firstRender.container.remove();

    const secondRender = renderTree();
    await flushAsyncWork();

    expect(apiMocks.vaultFiles).toHaveBeenCalledTimes(2);
    expect(getButton(secondRender.container, 'todo.md')).toBeTruthy();
  });

  it('drops descendant expansion state when a parent folder is collapsed', async () => {
    const { container } = renderTree();
    await flushAsyncWork();

    click(getButton(container, 'notes'));
    await flushAsyncWork();
    click(getButton(container, 'work'));
    await flushAsyncWork();
    click(getButton(container, 'notes'));
    await flushAsyncWork();

    expect(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY)).toBeNull();

    click(getButton(container, 'notes'));
    await flushAsyncWork();

    expect(JSON.parse(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY) ?? '[]')).toEqual(['notes/']);
    expect(queryInShadowRoots(container, 'button[aria-label="todo.md"]')).toBeNull();
  });

  it('tracks open files, restores them after remount, and lets the active file close back to the previous one', async () => {
    const { container } = renderManagedTree();
    await flushAsyncWork();

    click(getButton(container, 'README.md'));
    await flushAsyncWork();
    click(getButton(container, 'notes'));
    await flushAsyncWork();
    click(getButton(container, 'today.md'));
    await flushAsyncWork();

    expect(JSON.parse(localStorage.getItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY) ?? '[]')).toEqual(['notes/today.md', 'README.md']);
    expect(getButton(container, 'Open file notes/today.md')).toBeTruthy();
    expect(getButton(container, 'Open file README.md')).toBeTruthy();

    click(getButton(container, 'Close file notes/today.md'));
    await flushAsyncWork();

    expect(JSON.parse(localStorage.getItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY) ?? '[]')).toEqual(['README.md']);
    expect(getButton(container, 'Open file README.md')).toBeTruthy();

    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();

    const remounted = renderManagedTree();
    await flushAsyncWork();

    expect(getButton(remounted.container, 'Open file README.md')).toBeTruthy();
  });
});
