import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerServerRoutes, type ServerRouteContext } from './index.js';

function startServer(app: express.Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not determine server address'));
        return;
      }

      resolve({
        baseUrl: `http://127.0.0.1:${(address as AddressInfo).port}`,
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((error) => {
              if (error) {
                rejectClose(error);
                return;
              }
              resolveClose();
            });
          }),
      });
    });
  });
}

describe('registerServerRoutes smoke test', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-web-server-smoke-'));
  const workspaceDir = join(tempRoot, 'workspace');
  const settingsFile = join(tempRoot, 'settings.json');
  const authFile = join(tempRoot, 'auth.json');
  const profilesRoot = join(tempRoot, 'profiles');

  let appBaseUrl = '';
  let closeAppServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(profilesRoot, { recursive: true });
    writeFileSync(join(workspaceDir, 'README.md'), '# smoke\n');
    writeFileSync(settingsFile, JSON.stringify({}, null, 2));
    writeFileSync(authFile, JSON.stringify({}, null, 2));

    const context: ServerRouteContext = {
      getCurrentProfile: () => 'shared',
      getRepoRoot: () => tempRoot,
      getProfilesRoot: () => profilesRoot,
      materializeWebProfile: () => {},
      getSettingsFile: () => settingsFile,
      getAuthFile: () => authFile,
      getStateRoot: () => tempRoot,
      getServerPort: () => 3741,
      getDefaultWebCwd: () => workspaceDir,
      resolveRequestedCwd: (cwd, defaultCwd) => {
        const candidate = typeof cwd === 'string' && cwd.trim().length > 0 ? cwd.trim() : defaultCwd?.trim();
        return candidate && candidate.length > 0 ? candidate : workspaceDir;
      },
      buildLiveSessionResourceOptions: () => ({
        additionalExtensionPaths: [],
        additionalSkillPaths: [],
        additionalPromptTemplatePaths: [],
        additionalThemePaths: [],
      }),
      buildLiveSessionExtensionFactories: () => [],
      flushLiveDeferredResumes: async () => {},
      getSavedUiPreferences: () => ({
        openConversationIds: [],
        pinnedConversationIds: [],
        archivedConversationIds: [],
        nodeBrowserViews: [],
      }),
      listTasksForCurrentProfile: () => [],
      listMemoryDocs: () => [],
      listSkillsForCurrentProfile: () => [],
      listProfileAgentItems: () => [],
      withTemporaryProfileAgentDir: async (_profile, run) => run(tempRoot),
      getDurableRunSnapshot: async () => null,
    };

    const app = express();
    app.use(express.json({ limit: '5mb' }));
    registerServerRoutes({ app, context });

    const appServer = await startServer(app);
    appBaseUrl = appServer.baseUrl;
    closeAppServer = appServer.close;
  });

  afterAll(async () => {
    await closeAppServer?.();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('serves core app routes through the shared route registry', async () => {
    const defaultCwdResponse = await fetch(`${appBaseUrl}/api/default-cwd`);

    expect(defaultCwdResponse.status).toBe(200);
    expect(await defaultCwdResponse.json()).toEqual(
      expect.objectContaining({
        currentCwd: expect.any(String),
        effectiveCwd: expect.any(String),
      }),
    );
  });

  /* ---- Extension API endpoints ---- */

  it('serves the extension schema endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/schema`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifestVersion).toBe(2);
    expect(body.placements).toContain('main');
    expect(body.surfaceKinds).toContain('page');
    expect(body.iconNames).toContain('kanban');
  });

  it('serves the extension manifest list', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const systemExts = body.filter((e: { packageType: string }) => e.packageType === 'system');
    expect(systemExts.length).toBeGreaterThanOrEqual(20);
    expect(systemExts.some((e: { id: string }) => e.id === 'system-extension-manager')).toBe(true);
    expect(systemExts.some((e: { id: string }) => e.id === 'system-automations')).toBe(true);
  });

  it('serves the installed extension summaries', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/installed`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const systemExts = body.filter((e: { packageType: string }) => e.packageType === 'system');
    expect(systemExts.length).toBeGreaterThanOrEqual(20);
    for (const ext of systemExts) {
      expect(typeof ext.id).toBe('string');
      expect(typeof ext.name).toBe('string');
      expect(typeof ext.enabled).toBe('boolean');
    }
  });

  it('serves the extension routes endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/routes`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThanOrEqual(7);
    // Every route entry should have required fields
    for (const route of body) {
      expect(typeof route.route).toBe('string');
      expect(typeof route.extensionId).toBe('string');
      expect(typeof route.surfaceId).toBe('string');
    }
  });

  it('serves the extension surfaces endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/surfaces`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Each surface should have extension identification
    for (const surface of body) {
      expect(typeof surface.extensionId).toBe('string');
      expect(typeof surface.component).toBe('string');
      expect(surface.location).toMatch(/^(main|rightRail|workbench)$/);
    }
  });

  it('serves the extension commands endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/commands`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const cmd of body) {
      expect(typeof cmd.extensionId).toBe('string');
      expect(typeof cmd.title).toBe('string');
      expect(typeof cmd.action).toBe('string');
    }
  });

  it('serves the extension slash-commands endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/slash-commands`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const cmd of body) {
      expect(typeof cmd.extensionId).toBe('string');
      expect(typeof cmd.name).toBe('string');
      expect(typeof cmd.action).toBe('string');
    }
  });

  it('serves the per-extension manifest endpoint for a known extension', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/system-extension-manager/manifest`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('system-extension-manager');
    expect(body.name).toBe('Extension Manager');
    expect(body.packageType).toBe('system');
    expect(body.contributes?.views).toBeDefined();
    expect(body.contributes?.nav).toBeDefined();
  });

  it('returns 404 for unknown extension manifest', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/nonexistent-extension/manifest`);

    expect(res.status).toBe(404);
  });

  it('serves the per-extension surfaces endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/system-automations/surfaces`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // The automations extension should have at least one view
    expect(body.some((s: { location: string }) => s.location === 'main')).toBe(true);
  });

  it('serves extension mentions endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/mentions`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('serves extension quick-open endpoint', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/quick-open`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('serves extension keybinding registrations', async () => {
    const res = await fetch(`${appBaseUrl}/api/extensions/keybindings`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    for (const kb of body) {
      expect(typeof kb.extensionId).toBe('string');
      expect(typeof kb.title).toBe('string');
      expect(Array.isArray(kb.keys)).toBe(true);
    }
  });
});
