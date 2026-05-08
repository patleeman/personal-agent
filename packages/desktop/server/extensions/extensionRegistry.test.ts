import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isExtensionEnabled,
  listExtensionInstallSummaries,
  listExtensionSkillRegistrations,
  listExtensionToolRegistrations,
  parseExtensionManifest,
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
        expect.objectContaining({ id: 'system-files', packageType: 'system', name: 'File Explorer' }),
        expect.objectContaining({ id: 'system-diffs', packageType: 'system', name: 'Diffs' }),
        expect.objectContaining({ id: 'system-runs', packageType: 'system', name: 'Runs' }),
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
        expect.objectContaining({
          extensionId: 'system-files',
          location: 'rightRail',
          component: 'WorkspaceFilesPanel',
          detailView: 'workspace-file-detail',
        }),
        expect.objectContaining({ extensionId: 'system-files', location: 'workbench', component: 'WorkspaceFileDetailPanel' }),
        expect.objectContaining({
          extensionId: 'system-diffs',
          location: 'rightRail',
          component: 'ConversationDiffsPanel',
          detailView: 'conversation-diff-detail',
        }),
        expect.objectContaining({ extensionId: 'system-diffs', location: 'workbench', component: 'ConversationDiffDetailPanel' }),
        expect.objectContaining({
          extensionId: 'system-runs',
          location: 'rightRail',
          component: 'ConversationRunsPanel',
          detailView: 'conversation-run-detail',
        }),
        expect.objectContaining({ extensionId: 'system-runs', location: 'workbench', component: 'ConversationRunDetailPanel' }),
      ]),
    );
  });

  it('validates manifest contributions before accepting runtime extensions', () => {
    expect(() =>
      parseExtensionManifest({
        schemaVersion: 2,
        id: 'bad-ext',
        name: 'Bad Ext',
        contributes: {
          views: [{ id: 'page', title: 'Bad', location: 'somewhere', component: 'BadPage' }],
        },
      }),
    ).toThrow(/contributes\.views\[0\]\.location/);

    expect(() =>
      parseExtensionManifest({
        schemaVersion: 2,
        id: 'bad-ext',
        name: 'Bad Ext',
        contributes: {
          keybindings: [{ id: 'open', title: 'Open', keys: 'mod+o', command: 'navigate:/bad' }],
        },
      }),
    ).toThrow(/contributes\.keybindings\[0\]\.keys/);
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

  it('exposes invalid runtime extension manifests in installation summaries', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-registry-'));
    const extensionRoot = join(stateRoot, 'extensions', 'bad-board');
    mkdirSync(extensionRoot, { recursive: true });
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'bad-board',
        name: 'Bad Board',
        contributes: {
          views: [{ id: 'page', title: 'Bad Board', location: 'somewhere', component: 'BadBoardPage' }],
        },
      }),
    );

    expect(readRuntimeExtensionEntries(stateRoot)).toEqual([]);
    expect(listExtensionInstallSummaries(stateRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'bad-board',
          name: 'Bad Board',
          enabled: false,
          status: 'invalid',
          errors: [expect.stringContaining('contributes.views[0].location')],
        }),
      ]),
    );
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

  it('indexes enabled extension skills and tools', () => {
    const stateRoot = mkdtempSync(join(tmpdir(), 'pa-ext-registry-'));
    const extensionRoot = join(stateRoot, 'extensions', 'agent-board');
    mkdirSync(join(extensionRoot, 'skills', 'agent-board'), { recursive: true });
    writeFileSync(
      join(extensionRoot, 'skills', 'agent-board', 'SKILL.md'),
      '---\nname: agent-board\ndescription: Use when managing agent board tasks.\n---\n\n# Agent Board\n',
    );
    writeFileSync(
      join(extensionRoot, 'extension.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'agent-board',
        name: 'Agent Board',
        backend: { entry: 'src/backend.ts' },
        contributes: {
          skills: [{ id: 'agent-board', description: 'Use when managing agent board tasks.', path: 'skills/agent-board/SKILL.md' }],
          tools: [
            {
              id: 'create-task',
              description: 'Create an agent board task.',
              action: 'createTask',
              inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
            },
          ],
        },
      }),
    );

    expect(listExtensionSkillRegistrations(stateRoot)).toEqual([
      expect.objectContaining({
        extensionId: 'agent-board',
        name: 'agent-board/agent-board',
        path: join(extensionRoot, 'skills', 'agent-board', 'SKILL.md'),
      }),
    ]);
    expect(listExtensionToolRegistrations(stateRoot)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          extensionId: 'agent-board',
          id: 'create-task',
          name: 'extension_agent_board_create_task',
          action: 'createTask',
        }),
      ]),
    );

    setExtensionEnabled('agent-board', false, stateRoot);
    expect(listExtensionSkillRegistrations(stateRoot)).toEqual([]);
    expect(listExtensionToolRegistrations(stateRoot).some((tool) => tool.extensionId === 'agent-board')).toBe(false);
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
