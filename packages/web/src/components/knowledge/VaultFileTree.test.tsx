// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { VaultFileTree } from './VaultFileTree';
import { KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY } from '../../local/knowledgeTreeState';
import type { VaultEntry, VaultTreeResult } from '../../shared/types';

const apiMocks = vi.hoisted(() => ({
  tree: vi.fn(),
  search: vi.fn(),
  rename: vi.fn(),
  move: vi.fn(),
  writeFile: vi.fn(),
  deleteFile: vi.fn(),
  createFolder: vi.fn(),
}));

vi.mock('../../client/api', () => ({
  vaultApi: apiMocks,
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

const TREE: Record<string, VaultTreeResult> = {
  __root__: {
    root: '/vault',
    entries: [
      createEntry('notes/', 'folder'),
      createEntry('projects/', 'folder'),
      createEntry('README.md', 'file'),
    ],
  },
  'notes/': {
    root: '/vault/notes',
    entries: [
      createEntry('notes/work/', 'folder'),
      createEntry('notes/today.md', 'file'),
    ],
  },
  'notes/work/': {
    root: '/vault/notes/work',
    entries: [
      createEntry('notes/work/todo.md', 'file'),
    ],
  },
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

function getButton(container: HTMLElement, label: string): HTMLButtonElement {
  const button = container.querySelector(`button[aria-label="${label}"]`);
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
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('VaultFileTree', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    apiMocks.tree.mockReset();
    apiMocks.tree.mockImplementation(async (dir?: string) => {
      const key = dir ?? '__root__';
      const result = TREE[key];
      if (!result) {
        throw new Error(`Unexpected tree lookup for ${key}`);
      }
      return result;
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
    apiMocks.tree.mockClear();

    const secondRender = renderTree();
    await flushAsyncWork();

    expect(apiMocks.tree.mock.calls).toEqual([
      [],
      ['notes/'],
      ['notes/work/'],
    ]);
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

    expect(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY)).toBeNull();

    click(getButton(container, 'notes'));

    expect(JSON.parse(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY) ?? '[]')).toEqual(['notes/']);
    expect(container.querySelector('button[aria-label="todo.md"]')).toBeNull();
  });
});
