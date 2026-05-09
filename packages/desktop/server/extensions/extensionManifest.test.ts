import { describe, expect, it } from 'vitest';

import {
  EXTENSION_ICON_NAMES,
  EXTENSION_MANIFEST_VERSION,
  EXTENSION_PACKAGE_TYPES,
  EXTENSION_PLACEMENTS,
  EXTENSION_RIGHT_SURFACE_SCOPES,
  EXTENSION_SURFACE_KINDS,
  type ExtensionManifest,
  isExtensionIconName,
  isExtensionPlacement,
  isExtensionSurfaceKind,
} from './extensionManifest.js';

describe('extension manifest schema constants', () => {
  it('defines the native extension registry constants', () => {
    expect(EXTENSION_MANIFEST_VERSION).toBe(2);
    expect(EXTENSION_PACKAGE_TYPES).toEqual(['user', 'system']);
    expect(EXTENSION_PLACEMENTS).toEqual(['left', 'main', 'right', 'conversation', 'command', 'slash']);
    expect(EXTENSION_SURFACE_KINDS).toContain('toolPanel');
    expect(EXTENSION_RIGHT_SURFACE_SCOPES).toEqual(['global', 'conversation', 'workspace', 'selection']);
    expect(EXTENSION_ICON_NAMES).toContain('kanban');
  });

  it('supports strongly typed extension manifests', () => {
    const manifest: ExtensionManifest = {
      schemaVersion: 2,
      id: 'agent-board',
      name: 'Agent Board',
      packageType: 'user',
      frontend: { entry: 'dist/frontend.js', styles: ['dist/frontend.css'] },
      contributes: {
        views: [
          { id: 'page', title: 'Agent Board', location: 'main', route: '/ext/agent-board', component: 'AgentBoardPage' },
          { id: 'rail', title: 'Board', location: 'rightRail', scope: 'conversation', component: 'AgentBoardRail' },
        ],
        nav: [{ id: 'nav', label: 'Agent Board', route: '/ext/agent-board', icon: 'kanban' }],
        composerInputTools: [{ id: 'draw', component: 'DrawButton', title: 'Draw', when: '!streamIsStreaming' }],
      },
      backend: {
        entry: 'dist/backend.mjs',
        actions: [{ id: 'syncRunStatuses', handler: 'syncRunStatuses' }],
      },
      permissions: ['runs:start', 'storage:readwrite'],
    };

    expect(manifest.contributes?.views?.map((surface) => surface.id)).toEqual(['page', 'rail']);
    expect(manifest.contributes?.composerInputTools?.[0]?.component).toBe('DrawButton');
  });

  it('exposes type guards for manifest generation and validation', () => {
    expect(isExtensionPlacement('main')).toBe(true);
    expect(isExtensionPlacement('footer')).toBe(false);
    expect(isExtensionSurfaceKind('slashCommand')).toBe(true);
    expect(isExtensionSurfaceKind('widget')).toBe(false);
    expect(isExtensionIconName('kanban')).toBe(true);
    expect(isExtensionIconName('made-up')).toBe(false);
  });
});
