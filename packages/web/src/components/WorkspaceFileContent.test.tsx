import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../theme';
import type { WorkspaceFileDetail } from '../types';
import { WorkspaceFileContent } from './WorkspaceFileContent';

vi.mock('@uiw/react-codemirror', () => ({
  default: () => null,
}));

vi.mock('@codemirror/merge', () => ({
  unifiedMergeView: () => ({}),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createDetail(overrides: Partial<WorkspaceFileDetail> = {}): WorkspaceFileDetail {
  return {
    cwd: '/repo',
    root: '/repo',
    repoRoot: '/repo',
    path: '/repo/src/index.ts',
    relativePath: 'src/index.ts',
    exists: true,
    sizeBytes: 24,
    binary: false,
    tooLarge: false,
    content: 'export const value = 1;\n',
    originalContent: 'export const value = 1;\n',
    change: 'modified',
    diff: '@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n',
    ...overrides,
  };
}

function renderWorkspaceFileContent({
  detail = createDetail(),
  value = 'export const value = 2;\n',
  draftDirty = true,
  showDiff,
}: {
  detail?: WorkspaceFileDetail;
  value?: string;
  draftDirty?: boolean;
  showDiff?: boolean;
} = {}) {
  return renderToString(
    <ThemeProvider>
      <WorkspaceFileContent detail={detail} value={value} draftDirty={draftDirty} showDiff={showDiff} />
    </ThemeProvider>,
  );
}

describe('WorkspaceFileContent', () => {
  it('shows inline diff guidance by default in the file viewer', () => {
    const html = renderWorkspaceFileContent();

    expect(html).toContain('Inline diff markers compare your draft with the committed baseline.');
  });

  it('hides inline diff guidance when diff rendering is disabled', () => {
    const html = renderWorkspaceFileContent({ showDiff: false });

    expect(html).not.toContain('Inline diff markers');
  });

  it('sends deleted files to the Changes tab when diff rendering is disabled', () => {
    const html = renderWorkspaceFileContent({
      detail: createDetail({
        exists: false,
        content: null,
        originalContent: null,
      }),
      value: '',
      draftDirty: false,
      showDiff: false,
    });

    expect(html).toContain('Open the Changes tab to inspect the removal.');
    expect(html).not.toContain('Patch');
    expect(html).not.toContain('Review the diff below');
  });
});
