// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

const setContentSpy = vi.hoisted(() => vi.fn());
const focusSpy = vi.hoisted(() => vi.fn());
const readFileMock = vi.hoisted(() => vi.fn());
const backlinksMock = vi.hoisted(() => vi.fn());
const vaultFilesMock = vi.hoisted(() => vi.fn());
const writeFileMock = vi.hoisted(() => vi.fn());
const renameMock = vi.hoisted(() => vi.fn());
const uploadImageMock = vi.hoisted(() => vi.fn());

const chainStub = {
  focus: () => chainStub,
  toggleBold: () => chainStub,
  toggleItalic: () => chainStub,
  toggleStrike: () => chainStub,
  toggleCode: () => chainStub,
  toggleHeading: () => chainStub,
  toggleBlockquote: () => chainStub,
  run: () => true,
};

const editorStub = {
  commands: {
    setContent: setContentSpy,
    focus: focusSpy,
    setImage: vi.fn(),
  },
  isActive: () => false,
  chain: () => chainStub,
};

vi.mock('@tiptap/react', () => ({
  useEditor: () => editorStub,
  EditorContent: () => <div data-testid="editor-content" />,
  BubbleMenu: ({ children }: { children?: React.ReactNode }) => <div data-testid="bubble-menu">{children}</div>,
}));

vi.mock('@tiptap/react/menus', () => ({
  BubbleMenu: ({ children }: { children?: React.ReactNode }) => <div data-testid="bubble-menu">{children}</div>,
}));

vi.mock('@tiptap/starter-kit', () => ({
  StarterKit: { configure: () => ({}) },
}));

vi.mock('@tiptap/markdown', () => ({
  Markdown: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-link', () => ({
  Link: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-task-list', () => ({
  TaskList: {},
}));

vi.mock('@tiptap/extension-task-item', () => ({
  TaskItem: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-placeholder', () => ({
  Placeholder: { configure: () => ({}) },
}));

vi.mock('@tiptap/extension-image', () => ({
  Image: { configure: () => ({}) },
}));

vi.mock('./WikiLinkExtension', () => ({
  buildWikiLinkExtension: () => ({}),
}));

vi.mock('./WikiLinkSuggestion', () => ({
  buildWikiLinkRenderer: () => ({}),
}));

vi.mock('./FrontmatterDisclosure', () => ({
  FrontmatterDisclosure: () => <div data-testid="frontmatter-disclosure" />,
}));

vi.mock('./markdownEditorContent', () => ({
  readMarkdownFromEditor: () => 'saved body',
}));

vi.mock('../../client/api', () => ({
  api: {
    vaultFiles: (...args: unknown[]) => vaultFilesMock(...args),
  },
  vaultApi: {
    readFile: (...args: unknown[]) => readFileMock(...args),
    backlinks: (...args: unknown[]) => backlinksMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
    rename: (...args: unknown[]) => renameMock(...args),
    uploadImage: (...args: unknown[]) => uploadImageMock(...args),
  },
}));

import { VaultEditor } from './VaultEditor';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const mountedRoots: Root[] = [];

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderVaultEditor(props?: Partial<React.ComponentProps<typeof VaultEditor>>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const renderProps: React.ComponentProps<typeof VaultEditor> = {
    fileId: 'alpha.md',
    fileName: 'alpha.md',
    onFileNavigate: () => {},
    onFileRenamed: () => {},
    ...props,
  };

  act(() => {
    root.render(<VaultEditor {...renderProps} />);
  });

  mountedRoots.push(root);
  return {
    container,
    rerender(nextProps?: Partial<React.ComponentProps<typeof VaultEditor>>) {
      act(() => {
        root.render(<VaultEditor {...renderProps} {...nextProps} />);
      });
    },
  };
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe('VaultEditor', () => {
  beforeEach(() => {
    setContentSpy.mockReset();
    focusSpy.mockReset();
    readFileMock.mockReset();
    backlinksMock.mockReset();
    vaultFilesMock.mockReset();
    writeFileMock.mockReset();
    renameMock.mockReset();
    uploadImageMock.mockReset();
    vaultFilesMock.mockResolvedValue({ files: [] });
    backlinksMock.mockResolvedValue({ backlinks: [] });
  });

  afterEach(() => {
    for (const root of mountedRoots.splice(0)) {
      act(() => {
        root.unmount();
      });
    }
    document.body.innerHTML = '';
  });

  it('ignores stale file responses when switching files quickly', async () => {
    const firstRead = createDeferred<{ content: string }>();
    readFileMock.mockImplementation((fileId: string) => {
      if (fileId === 'first.md') {
        return firstRead.promise;
      }
      if (fileId === 'second.md') {
        return Promise.resolve({ content: 'Second body' });
      }
      return Promise.resolve({ content: 'Fallback body' });
    });

    const view = renderVaultEditor({ fileId: 'first.md', fileName: 'first.md' });
    view.rerender({ fileId: 'second.md', fileName: 'second.md' });

    await flushAsyncWork();
    expect(setContentSpy).toHaveBeenCalledTimes(1);
    expect(setContentSpy).toHaveBeenLastCalledWith('Second body', { contentType: 'markdown' });

    firstRead.resolve({ content: 'First body' });
    await flushAsyncWork();

    expect(setContentSpy).toHaveBeenCalledTimes(1);
    expect(setContentSpy).toHaveBeenLastCalledWith('Second body', { contentType: 'markdown' });
  });

  it('reuses cached file content when revisiting a recently opened file', async () => {
    readFileMock.mockImplementation((fileId: string) => Promise.resolve({ content: `${fileId} body` }));

    const view = renderVaultEditor({ fileId: 'alpha.md', fileName: 'alpha.md' });
    await flushAsyncWork();

    view.rerender({ fileId: 'beta.md', fileName: 'beta.md' });
    await flushAsyncWork();

    view.rerender({ fileId: 'alpha.md', fileName: 'alpha.md' });
    await flushAsyncWork();

    expect(readFileMock.mock.calls.filter(([fileId]) => fileId === 'alpha.md')).toHaveLength(1);
    expect(readFileMock.mock.calls.filter(([fileId]) => fileId === 'beta.md')).toHaveLength(1);
    expect(setContentSpy).toHaveBeenLastCalledWith('alpha.md body', { contentType: 'markdown' });
  });

  it('loads backlinks lazily when the panel is opened', async () => {
    readFileMock.mockResolvedValue({ content: 'Alpha body' });
    backlinksMock.mockResolvedValue({
      backlinks: [{ id: 'notes/source.md', name: 'source.md', excerpt: 'Linked from source.' }],
    });

    const { container } = renderVaultEditor({ fileId: 'alpha.md', fileName: 'alpha.md' });
    await flushAsyncWork();

    expect(backlinksMock).not.toHaveBeenCalled();

    const toggleButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Backlinks'));
    expect(toggleButton).toBeTruthy();

    act(() => {
      toggleButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushAsyncWork();

    expect(backlinksMock).toHaveBeenCalledWith('alpha.md');
    expect(container.textContent).toContain('source');
    expect(container.textContent).toContain('Linked from source.');
  });
});
