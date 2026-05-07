import { describe, expect, it } from 'vitest';

import { readExtensionRegistrySnapshot, readExtensionSchema } from './extensionRegistry.js';

describe('extension registry', () => {
  it('exposes the automations system extension route and surface', () => {
    const snapshot = readExtensionRegistrySnapshot();

    expect(snapshot.extensions).toEqual([
      expect.objectContaining({ id: 'system-automations', packageType: 'system', name: 'Automations' }),
    ]);
    expect(snapshot.routes).toContainEqual({
      route: '/automations',
      extensionId: 'system-automations',
      surfaceId: 'page',
      packageType: 'system',
    });
    expect(snapshot.surfaces).toEqual([
      expect.objectContaining({ extensionId: 'system-automations', placement: 'main', kind: 'page', component: 'automations' }),
    ]);
  });

  it('exposes schema values for agents and the extension manager', () => {
    expect(readExtensionSchema()).toEqual(
      expect.objectContaining({
        placements: expect.arrayContaining(['main', 'right', 'slash']),
        surfaceKinds: expect.arrayContaining(['page', 'toolPanel', 'slashCommand']),
        iconNames: expect.arrayContaining(['automation', 'kanban']),
      }),
    );
  });
});
