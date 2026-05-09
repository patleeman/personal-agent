// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { api } from '../client/api';
import { useExtensionRegistry } from './useExtensionRegistry';

vi.mock('../client/api', () => ({
  api: {
    extensions: vi.fn(),
    extensionRoutes: vi.fn(),
    extensionSurfaces: vi.fn(),
  },
}));

describe('useExtensionRegistry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes conversation header elements from extension manifests', async () => {
    vi.mocked(api.extensions).mockResolvedValue([
      {
        schemaVersion: 2,
        id: 'system-caffinate',
        name: 'Caffinate',
        frontend: { entry: 'dist/frontend.js', styles: [] },
        contributes: {
          conversationHeaderElements: [
            {
              id: 'keep-awake-indicator',
              component: 'CaffeineHeaderIndicator',
              label: 'Keep awake',
            },
          ],
        },
      },
    ] as never);
    vi.mocked(api.extensionRoutes).mockResolvedValue([]);
    vi.mocked(api.extensionSurfaces).mockResolvedValue([]);

    const { result } = renderHook(() => useExtensionRegistry());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.conversationHeaderElements).toEqual([
      {
        extensionId: 'system-caffinate',
        id: 'keep-awake-indicator',
        component: 'CaffeineHeaderIndicator',
        label: 'Keep awake',
        frontendEntry: 'dist/frontend.js',
      },
    ]);
  });

  it('keeps registry arrays defined when the extension API is unavailable', async () => {
    const originalExtensions = api.extensions;
    (api as unknown as { extensions?: unknown }).extensions = undefined;

    try {
      const { result } = renderHook(() => useExtensionRegistry());

      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.conversationHeaderElements).toEqual([]);
      expect(result.current.conversationDecorators).toEqual([]);
    } finally {
      (api as unknown as { extensions: typeof originalExtensions }).extensions = originalExtensions;
    }
  });
});
