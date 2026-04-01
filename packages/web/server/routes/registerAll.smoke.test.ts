import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  let companionBaseUrl = '';
  let closeAppServer: (() => Promise<void>) | null = null;
  let closeCompanionServer: (() => Promise<void>) | null = null;

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
      listProjectsForCurrentProfile: () => [],
      listTasksForCurrentProfile: () => [],
      listMemoryDocs: () => [],
      listSkillsForCurrentProfile: () => [],
      listProfileAgentItems: () => [],
      withTemporaryProfileAgentDir: async (_profile, run) => run(tempRoot),
      readExecutionTargetsState: async () => ({ targets: [{ id: 'demo-target' }], runs: [] }),
      browseRemoteTargetDirectory: async () => ({ cwd: workspaceDir, entries: [] }),
      getDurableRunSnapshot: async () => null,
      draftWorkspaceCommitMessage: async () => ({ subject: 'smoke commit' }),
    };

    const app = express();
    const companionApp = express();
    app.use(express.json({ limit: '5mb' }));
    companionApp.use(express.json({ limit: '5mb' }));
    registerServerRoutes({ app, companionApp, context });

    const appServer = await startServer(app);
    const companionServer = await startServer(companionApp);
    appBaseUrl = appServer.baseUrl;
    companionBaseUrl = companionServer.baseUrl;
    closeAppServer = appServer.close;
    closeCompanionServer = companionServer.close;
  });

  afterAll(async () => {
    await closeAppServer?.();
    await closeCompanionServer?.();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('serves core app routes through the shared route registry', async () => {
    const [profilesResponse, titlesResponse, executionTargetsResponse, workspaceResponse] = await Promise.all([
      fetch(`${appBaseUrl}/api/profiles`),
      fetch(`${appBaseUrl}/api/conversation-titles/settings`),
      fetch(`${appBaseUrl}/api/execution-targets`),
      fetch(`${appBaseUrl}/api/workspace?cwd=${encodeURIComponent(workspaceDir)}`),
    ]);

    expect(profilesResponse.status).toBe(200);
    expect(titlesResponse.status).toBe(200);
    expect(executionTargetsResponse.status).toBe(200);
    expect(workspaceResponse.status).toBe(200);

    expect(await profilesResponse.json()).toMatchObject({
      currentProfile: 'assistant',
      profiles: ['assistant', 'other'],
    });
    expect(await titlesResponse.json()).toEqual(expect.any(Object));
    expect(await executionTargetsResponse.json()).toMatchObject({
      targets: [{ id: 'demo-target' }],
    });
    expect(await workspaceResponse.json()).toMatchObject({
      root: realpathSync(workspaceDir),
    });
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

  it('serves companion pairing admin routes through the desktop app surface and keeps the companion surface gated', async () => {
    const [pairingCodeResponse, gatedPairingCodeResponse] = await Promise.all([
      fetch(`${appBaseUrl}/api/companion-auth/pairing-code`, {
        method: 'POST',
      }),
      fetch(`${companionBaseUrl}/api/companion-auth/pairing-code`, {
        method: 'POST',
      }),
    ]);

    expect(pairingCodeResponse.status).toBe(201);
    expect(gatedPairingCodeResponse.status).toBe(401);
    const pairingCodeBody = await pairingCodeResponse.json() as { code: string };

    const exchangeResponse = await fetch(`${companionBaseUrl}/api/companion-auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: pairingCodeBody.code }),
    });
    expect(exchangeResponse.status).toBe(201);
    const companionCookie = exchangeResponse.headers.get('set-cookie');
    expect(companionCookie).toContain('pa_companion=');

    const [liveSessionsResponse, conversationsResponse] = await Promise.all([
      fetch(`${companionBaseUrl}/api/live-sessions`, {
        headers: { cookie: companionCookie ?? '' },
      }),
      fetch(`${companionBaseUrl}/api/companion/conversations`, {
        headers: { cookie: companionCookie ?? '' },
      }),
    ]);

    expect(liveSessionsResponse.status).toBe(200);
    expect(conversationsResponse.status).toBe(200);
    expect(await liveSessionsResponse.json()).toEqual(expect.any(Array));
    expect(await conversationsResponse.json()).toEqual(expect.objectContaining({
      live: expect.any(Array),
      needsReview: expect.any(Array),
      active: expect.any(Array),
      archived: expect.any(Array),
    }));
  });
});
