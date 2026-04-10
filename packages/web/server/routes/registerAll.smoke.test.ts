import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
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
        close: () => new Promise<void>((resolveClose, rejectClose) => {
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
      getCurrentProfile: () => 'assistant',
      setCurrentProfile: async (profile) => profile,
      listAvailableProfiles: () => ['assistant', 'other'],
      getRepoRoot: () => tempRoot,
      getProfilesRoot: () => profilesRoot,
      getCurrentProfileSettingsFile: () => settingsFile,
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
      getSavedWebUiPreferences: () => ({
        openConversationIds: [],
        pinnedConversationIds: [],
        archivedConversationIds: [],
        nodeBrowserViews: [],
      }),
      listActivityForCurrentProfile: () => [],
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
    const [profilesResponse, titlesResponse, defaultCwdResponse] = await Promise.all([
      fetch(`${appBaseUrl}/api/profiles`),
      fetch(`${appBaseUrl}/api/conversation-titles/settings`),
      fetch(`${appBaseUrl}/api/default-cwd`),
    ]);

    expect(profilesResponse.status).toBe(200);
    expect(titlesResponse.status).toBe(200);
    expect(defaultCwdResponse.status).toBe(200);

    expect(await profilesResponse.json()).toMatchObject({
      currentProfile: 'assistant',
      profiles: ['assistant', 'other'],
    });
    expect(await titlesResponse.json()).toEqual(expect.any(Object));
    expect(await defaultCwdResponse.json()).toEqual(expect.objectContaining({
      currentCwd: expect.any(String),
      effectiveCwd: expect.any(String),
    }));
  });

  it('serves command execution through the app surface', async () => {
    const response = await fetch(`${appBaseUrl}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        command: "printf 'smoke-run'",
        cwd: workspaceDir,
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      output: 'smoke-run',
      exitCode: 0,
      cwd: workspaceDir,
    });
  });

  it('serves remote pairing admin routes through the main app surface', async () => {
    const pairingCodeResponse = await fetch(`${appBaseUrl}/api/remote-access/pairing-code`, {
      method: 'POST',
    });

    expect(pairingCodeResponse.status).toBe(201);
    expect(await pairingCodeResponse.json()).toEqual(expect.objectContaining({
      code: expect.any(String),
      expiresAt: expect.any(String),
    }));
  });
});
