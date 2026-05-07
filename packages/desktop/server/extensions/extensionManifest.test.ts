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
  it('defines the v0 placement, surface, scope, and icon registries', () => {
    expect(EXTENSION_MANIFEST_VERSION).toBe(1);
    expect(EXTENSION_PACKAGE_TYPES).toEqual(['user', 'system']);
    expect(EXTENSION_PLACEMENTS).toEqual(['left', 'main', 'right', 'conversation', 'command', 'slash']);
    expect(EXTENSION_SURFACE_KINDS).toContain('toolPanel');
    expect(EXTENSION_RIGHT_SURFACE_SCOPES).toEqual(['global', 'conversation', 'workspace', 'selection']);
    expect(EXTENSION_ICON_NAMES).toContain('kanban');
  });

  it('supports strongly typed extension manifests', () => {
    const manifest: ExtensionManifest = {
      schemaVersion: 1,
      id: 'agent-board',
      name: 'Agent Board',
      packageType: 'user',
      surfaces: [
        {
          id: 'nav',
          placement: 'left',
          kind: 'navItem',
          label: 'Agent Board',
          route: '/ext/agent-board',
          icon: 'kanban',
        },
        {
          id: 'rail',
          placement: 'right',
          kind: 'toolPanel',
          label: 'Board',
          entry: 'frontend/rail.html',
          scope: 'conversation',
        },
      ],
      backend: {
        entry: 'backend/index.ts',
        actions: [{ id: 'syncRunStatuses', handler: 'syncRunStatuses' }],
      },
      permissions: ['runs:start', 'storage:readwrite'],
    };

    expect(manifest.surfaces?.map((surface) => surface.id)).toEqual(['nav', 'rail']);
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
