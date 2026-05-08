import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isExtensionEnabled,
  listExtensionInstallSummaries,
  readExtensionRegistrySnapshot,
  readExtensionSchema,
  readRuntimeExtensionEntries,
  setExtensionEnabled,
} from './extensionRegistry.js';

describe('extension registry', () => {
  it('exposes the automations system extension route and surface', () => {
    const snapshot = readExtensionRegistrySnapshot();

    expect(snapshot.extensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'system-automations', packageType: 'system', name: 'Automations' }),
        expect.objectContaining({ id: 'system-gateways', packageType: 'system', name: 'Gateways' }),
        expect.objectContaining({ id: 'system-telemetry', packageType: 'system', name: 'Telemetry' }),
      ]),
    );
    expect(snapshot.routes).toContainEqual({
      route: '/automations',
      extensionId: 'system-automations',
      surfaceId: 'page',
      packageType: 'system',
    });
    expect(snapshot.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extensionId: 'system-automations',
          location: 'main',
          component: 'AutomationsPage',
          route: '/automations',
        }),
        expect.objectContaining({ extensionId: 'system-gateways', location: 'main', component: 'GatewaysPage', route: '/gateways' }),
        expect.objectContaining({ extensionId: 'system-telemetry', location: 'main', component: 'TelemetryPage', route: '/telemetry' }),
      ]),
    );
  });

  it('loads runtime extension manifests from the state root', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-registry-'));
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        frontend: { entry: 'dist/frontend.js' },
        contributes: {
          views: [{ id: 'page', title: 'Agent Board', location: 'main', route: '/ext/agent-board', component: 'AgentBoardPage' }],
        },
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

  it('tracks disabled runtime extensions and hides them from active surfaces', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-registry-'));
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        frontend: { entry: 'dist/frontend.js' },
        contributes: {
          views: [{ id: 'page', title: 'Agent Board', location: 'main', route: '/ext/agent-board', component: 'AgentBoardPage' }],
        },
      }),
    );

    expect(isExtensionEnabled('agent-board', stateRoot)).toBe(true);
    setExtensionEnabled('agent-board', false, stateRoot);
    expect(isExtensionEnabled('agent-board', stateRoot)).toBe(false);
    expect(listExtensionInstallSummaries(stateRoot).find((extension) => extension.id === 'agent-board')?.enabled).toBe(false);
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
