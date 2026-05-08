// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '../client/api';
import { useApi } from '../hooks/useApi';

const editorState = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  fileIds: [] as string[],
}));

vi.mock('../hooks/useApi', () => ({
  useApi: vi.fn(),
}));

vi.mock('@personal-agent/extensions/knowledge', async () => {
  const React = await import('react');

  return {
    VaultEditor: ({ fileId }: { fileId: string | null }) => {
      React.useEffect(() => {
        editorState.mounts += 1;
        return () => {
          editorState.unmounts += 1;
        };
      }, []);

      editorState.fileIds.push(fileId ?? '');
      return React.createElement('div', { 'data-testid': 'vault-editor' }, fileId ?? '');
    },
  };
});

import { KnowledgePage } from './KnowledgePage';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

function buildUseApiResult<T>(data: T) {
  return {
    data,
    loading: false,
    refreshing: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(data),
    replaceData: vi.fn(),
  };
}

describe('KnowledgePage behavior', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    editorState.mounts = 0;
    editorState.unmounts = 0;
    editorState.fileIds = [];

    vi.mocked(useApi).mockImplementation((fetcher) => {
      if (fetcher === api.knowledgeBase) {
        return buildUseApiResult({
          repoUrl: 'https://github.com/user/knowledge-base.git',
          branch: 'main',
          configured: true,
          effectiveRoot: '/vault',
          managedRoot: '/runtime/knowledge-base/repo',
          usesManagedRoot: true,
          syncStatus: 'idle',
          lastSyncAt: '2026-04-23T02:00:00.000Z',
          gitStatus: {
            localChangeCount: 0,
            aheadCount: 0,
            behindCount: 0,
          },
          recoveredEntryCount: 0,
          recoveryDir: '/runtime/knowledge-base/recovered',
        });
      }

      throw new Error('Unexpected useApi call');
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    container?.remove();
    root = null;
    container = null;
  });

  it('keeps the editor mounted when switching knowledge files', async () => {
    const router = createMemoryRouter([{ path: '/knowledge', element: <KnowledgePage /> }], {
      initialEntries: ['/knowledge?file=notes/alpha.md'],
    });

    await act(async () => {
      root?.render(<RouterProvider router={router} />);
      await Promise.resolve();
    });

    expect(editorState.mounts).toBe(1);
    expect(editorState.unmounts).toBe(0);
    expect(editorState.fileIds).toContain('notes/alpha.md');

    await act(async () => {
      await router.navigate('/knowledge?file=notes/beta.md');
      await Promise.resolve();
    });

    expect(editorState.mounts).toBe(1);
    expect(editorState.unmounts).toBe(0);
    expect(editorState.fileIds).toContain('notes/beta.md');
    expect(container?.textContent).toContain('notes/beta.md');
  });
});
