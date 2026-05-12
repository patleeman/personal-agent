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

  it('normalizes component-backed extension chrome from manifests', async () => {
    vi.mocked(api.extensions).mockResolvedValue([
      {
        schemaVersion: 2,
        id: 'test-extension',
        name: 'Test Extension',
        frontend: { entry: 'dist/frontend.js', styles: [] },
        contributes: {
          conversationHeaderElements: [
            {
              id: 'header-indicator',
              component: 'HeaderIndicator',
              label: 'Header indicator',
            },
          ],
          statusBarItems: [
            {
              id: 'git-status',
              label: 'Git status',
              component: 'GitStatusIndicator',
              alignment: 'right',
              priority: 100,
            },
          ],
          composerButtons: [
            {
              id: 'goal-mode',
              component: 'GoalModeComposerButton',
              title: 'Goal mode',
              placement: 'afterModelPicker',
              priority: 100,
            },
          ],
          composerInputTools: [
            {
              id: 'draw',
              component: 'DrawButton',
              title: 'Draw',
              when: '!streamIsStreaming',
              priority: 25,
            },
          ],
          activityTreeItemElements: [
            {
              id: 'thread-color-dot',
              component: 'ThreadColorDot',
              slot: 'leading',
              priority: 10,
            },
          ],
          activityTreeItemStyles: [
            {
              id: 'thread-color-style',
              provider: 'getThreadColorStyle',
              priority: 20,
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
        extensionId: 'test-extension',
        id: 'header-indicator',
        component: 'HeaderIndicator',
        label: 'Header indicator',
        frontendEntry: 'dist/frontend.js',
      },
    ]);
    expect(result.current.statusBarItems).toEqual([
      {
        extensionId: 'test-extension',
        id: 'git-status',
        label: 'Git status',
        component: 'GitStatusIndicator',
        alignment: 'right',
        priority: 100,
        frontendEntry: 'dist/frontend.js',
      },
    ]);
    expect(result.current.composerButtons).toEqual([
      {
        extensionId: 'test-extension',
        id: 'goal-mode',
        component: 'GoalModeComposerButton',
        title: 'Goal mode',
        placement: 'afterModelPicker',
        priority: 100,
        frontendEntry: 'dist/frontend.js',
      },
    ]);
    expect(result.current.composerInputTools).toEqual([
      {
        extensionId: 'test-extension',
        id: 'draw',
        component: 'DrawButton',
        title: 'Draw',
        when: '!streamIsStreaming',
        priority: 25,
        frontendEntry: 'dist/frontend.js',
      },
    ]);
    expect(result.current.activityTreeItemElements).toEqual([
      {
        extensionId: 'test-extension',
        id: 'thread-color-dot',
        component: 'ThreadColorDot',
        slot: 'leading',
        priority: 10,
        frontendEntry: 'dist/frontend.js',
      },
    ]);
    expect(result.current.activityTreeItemStyles).toEqual([
      {
        extensionId: 'test-extension',
        id: 'thread-color-style',
        provider: 'getThreadColorStyle',
        priority: 20,
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
      expect(result.current.activityTreeItemElements).toEqual([]);
      expect(result.current.activityTreeItemStyles).toEqual([]);
      expect(result.current.statusBarItems).toEqual([]);
      expect(result.current.composerButtons).toEqual([]);
      expect(result.current.composerInputTools).toEqual([]);
    } finally {
      (api as unknown as { extensions: typeof originalExtensions }).extensions = originalExtensions;
    }
  });
});
