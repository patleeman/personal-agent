import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { readExtensionRegistrySnapshot, readExtensionSchema, readRuntimeExtensionEntries } from './extensionRegistry.js';

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

  it('loads runtime extension manifests from the state root', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-registry-'));
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'agent-board',
        name: 'Agent Board',
        surfaces: [{ id: 'page', placement: 'main', kind: 'page', route: '/ext/agent-board', entry: 'frontend/page.html' }],
      }),
    );

    expect(readRuntimeExtensionEntries(stateRoot)).toEqual([
      expect.objectContaining({
        packageRoot: extensionRoot,
        source: 'runtime',
        manifest: expect.objectContaining({ id: 'agent-board', packageType: 'user' }),
      }),
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
