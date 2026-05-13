// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppEventsContext, INITIAL_APP_EVENT_VERSIONS } from '../app/contexts';
import { api } from '../client/api';
import { INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS } from '../conversation/conversationEventVersions';
import { useExtensionRegistry } from './useExtensionRegistry';

vi.mock('../client/api', () => ({
  api: {
    extensionInstallations: vi.fn(),
    extensionRoutes: vi.fn(),
    extensionSurfaces: vi.fn(),
  },
}));

describe('useExtensionRegistry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes component-backed extension chrome from manifests', async () => {
    vi.mocked(api.extensionInstallations).mockResolvedValue([
      {
        id: 'test-extension',
        name: 'Test Extension',
        enabled: true,
        status: 'enabled',
        manifest: {
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
      },
    ] as never);
    vi.mocked(api.extensionRoutes).mockResolvedValue([]);
    vi.mocked(api.extensionSurfaces).mockResolvedValue([]);

    const { result } = renderHook(() => useExtensionRegistry());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.extensions).toEqual([
      expect.objectContaining({
        id: 'test-extension',
        enabled: true,
        manifest: expect.objectContaining({ id: 'test-extension' }),
      }),
    ]);
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

  it('keeps disabled extensions visible but removes their active contributions', async () => {
    vi.mocked(api.extensionInstallations).mockResolvedValue([
      {
        id: 'disabled-extension',
        name: 'Disabled Extension',
        enabled: false,
        status: 'disabled',
        manifest: {
          schemaVersion: 2,
          id: 'disabled-extension',
          name: 'Disabled Extension',
          frontend: { entry: 'dist/frontend.js', styles: [] },
          contributes: {
            composerButtons: [{ id: 'disabled-button', component: 'DisabledButton', placement: 'actions' }],
            statusBarItems: [{ id: 'disabled-status', label: 'Disabled status', component: 'DisabledStatus', alignment: 'right' }],
          },
        },
      },
    ] as never);
    vi.mocked(api.extensionRoutes).mockResolvedValue([]);
    vi.mocked(api.extensionSurfaces).mockResolvedValue([]);

    const { result } = renderHook(() => useExtensionRegistry());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.extensions.map((entry) => entry.id)).toEqual(['disabled-extension']);
    expect(result.current.composerButtons).toEqual([]);
    expect(result.current.statusBarItems).toEqual([]);
  });

  it('reloads when the extensions app topic is invalidated', async () => {
    let extensionsVersion = 0;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AppEventsContext.Provider
        value={{
          versions: { ...INITIAL_APP_EVENT_VERSIONS, extensions: extensionsVersion },
          conversationVersions: INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS,
        }}
      >
        {children}
      </AppEventsContext.Provider>
    );

    vi.mocked(api.extensionInstallations)
      .mockResolvedValueOnce([
        {
          id: 'test-extension',
          name: 'Test Extension',
          enabled: true,
          status: 'enabled',
          manifest: { schemaVersion: 2, id: 'test-extension', name: 'Test Extension' },
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'next-extension',
          name: 'Next Extension',
          enabled: true,
          status: 'enabled',
          manifest: { schemaVersion: 2, id: 'next-extension', name: 'Next Extension' },
        },
      ] as never);
    vi.mocked(api.extensionRoutes).mockResolvedValue([]);
    vi.mocked(api.extensionSurfaces).mockResolvedValue([]);

    const { result, rerender } = renderHook(() => useExtensionRegistry(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.extensions.map((entry) => entry.id)).toEqual(['test-extension']);

    extensionsVersion = 1;
    rerender();

    await waitFor(() => expect(result.current.extensions.map((entry) => entry.id)).toEqual(['next-extension']));
    expect(api.extensionInstallations).toHaveBeenCalledTimes(2);
  });

  it('keeps registry arrays defined when the extension API is unavailable', async () => {
    const originalExtensionInstallations = api.extensionInstallations;
    (api as unknown as { extensionInstallations?: unknown }).extensionInstallations = undefined;

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
      (api as unknown as { extensionInstallations: typeof originalExtensionInstallations }).extensionInstallations =
        originalExtensionInstallations;
    }
  });
});
