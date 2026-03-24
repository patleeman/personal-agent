import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildWorkspacePath, buildWorkspaceSearch, filterWorkspaceTree, readWorkspaceModeFromPathname, syncWorkspaceExpandedPaths, WorkspaceWordDiffView } from './workspaceBrowser';
import type { WorkspaceTreeNode } from './types';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

const TREE: WorkspaceTreeNode[] = [
  {
    name: 'src',
    path: '/tmp/project/src',
    relativePath: 'src',
    kind: 'directory',
    exists: true,
    change: null,
    children: [
      {
        name: 'index.ts',
        path: '/tmp/project/src/index.ts',
        relativePath: 'src/index.ts',
        kind: 'file',
        exists: true,
        change: 'modified',
      },
      {
        name: 'clean.ts',
        path: '/tmp/project/src/clean.ts',
        relativePath: 'src/clean.ts',
        kind: 'file',
        exists: true,
        change: null,
      },
      {
        name: 'prompts',
        path: '/tmp/project/src/prompts',
        relativePath: 'src/prompts',
        kind: 'directory',
        exists: true,
        change: null,
        children: [
          {
            name: 'prompt.md',
            path: '/tmp/project/src/prompts/prompt.md',
            relativePath: 'src/prompts/prompt.md',
            kind: 'file',
            exists: true,
            change: null,
          },
        ],
      },
    ],
  },
];

describe('buildWorkspaceSearch', () => {
  it('updates cwd and file params while preserving unrelated search params', () => {
    expect(buildWorkspaceSearch('?foo=bar&cwd=/tmp/old&file=src/old.ts', {
      cwd: '/tmp/new',
      file: 'src/new.ts',
      changeScope: 'staged',
    })).toBe('?foo=bar&cwd=%2Ftmp%2Fnew&file=src%2Fnew.ts&changeScope=staged');
  });
});

describe('workspace routes', () => {
  it('builds nested workspace paths for files and changes', () => {
    expect(buildWorkspacePath('files')).toBe('/workspace/files');
    expect(buildWorkspacePath('changes', '?cwd=/tmp/repo')).toBe('/workspace/changes?cwd=/tmp/repo');
  });

  it('reads the active workspace mode from the pathname', () => {
    expect(readWorkspaceModeFromPathname('/workspace/files')).toBe('files');
    expect(readWorkspaceModeFromPathname('/workspace/changes')).toBe('changes');
    expect(readWorkspaceModeFromPathname('/workspace')).toBe('files');
  });
});

describe('filterWorkspaceTree', () => {
  it('keeps only changed files when changedOnly is enabled', () => {
    expect(filterWorkspaceTree(TREE, { query: '', changedOnly: true })).toEqual([
      expect.objectContaining({
        relativePath: 'src',
        children: [expect.objectContaining({ relativePath: 'src/index.ts' })],
      }),
    ]);
  });
});

describe('syncWorkspaceExpandedPaths', () => {
  it('preserves manually expanded directories when selecting another file', () => {
    const next = syncWorkspaceExpandedPaths({
      previousPaths: new Set(['src', 'src/prompts']),
      snapshot: {
        tree: TREE,
        focusPath: null,
        changes: [],
      },
      selectedFilePath: 'src/clean.ts',
      reset: false,
    });

    expect([...next]).toEqual(['src', 'src/prompts']);
  });

  it('expands the selected file path when the selection is inside a nested folder', () => {
    const next = syncWorkspaceExpandedPaths({
      previousPaths: new Set(['src']),
      snapshot: {
        tree: TREE,
        focusPath: null,
        changes: [],
      },
      selectedFilePath: 'src/prompts/prompt.md',
      reset: false,
    });

    expect([...next]).toEqual(['src', 'src/prompts']);
  });
});

describe('WorkspaceWordDiffView', () => {
  it('renders a side-by-side word diff with old and new columns', () => {
    const html = renderToString(
      <WorkspaceWordDiffView originalContent={'export const value = 1;\n'} currentContent={'export const result = 2;\n'} />,
    );

    expect(html).toContain('Original');
    expect(html).toContain('Current');
    expect(html).toContain('value');
    expect(html).toContain('result');
    expect(html).toContain('bg-danger/12');
    expect(html).toContain('bg-teal/12');
  });
});
