import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createServerApps, mountStaticServerApps } from './bootstrap.js';

function startServer(app: Express): Promise<{ baseUrl: string; close: () => Promise<void> }> {
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

describe('mountStaticServerApps with built assets', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-web-bootstrap-'));
  const distDir = join(tempRoot, 'dist');
  const distAssetsDir = join(distDir, 'assets');
  const companionDistDir = join(tempRoot, 'companion-dist');

  let appBaseUrl = '';
  let companionBaseUrl = '';
  let closeAppServer: (() => Promise<void>) | null = null;
  let closeCompanionServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    mkdirSync(distAssetsDir, { recursive: true });
    mkdirSync(companionDistDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>desktop shell</body></html>');
    writeFileSync(join(companionDistDir, 'index.html'), '<!doctype html><html><body>companion shell</body></html>');
    writeFileSync(join(distAssetsDir, 'app.js'), 'console.log("ok");\n');

    const { app, companionApp } = createServerApps();
    mountStaticServerApps({
      app,
      companionApp,
      distDir,
      companionDistDir,
      distAssetsDir,
      companionDisabled: false,
      loopbackHost: '127.0.0.1',
      companionPort: 4242,
    });

    const appServer = await startServer(app);
    appBaseUrl = appServer.baseUrl;
    closeAppServer = appServer.close;

    const companionServer = await startServer(companionApp);
    companionBaseUrl = companionServer.baseUrl;
    closeCompanionServer = companionServer.close;
  });

  afterAll(async () => {
    await closeAppServer?.();
    await closeCompanionServer?.();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('returns a JSON 404 for unknown api paths instead of serving the SPA shell', async () => {
    const response = await fetch(`${appBaseUrl}/api/sync`);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('still serves the desktop SPA shell for non-api paths', async () => {
    const response = await fetch(`${appBaseUrl}/system`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('desktop shell');
  });

  it('redirects desktop /app routes to the companion service when it is enabled', async () => {
    const response = await fetch(`${appBaseUrl}/app/tasks?tab=queued`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://127.0.0.1:4242/app/tasks?tab=queued');
  });

  it('serves the companion SPA shell for app routes and redirects the companion root', async () => {
    const rootResponse = await fetch(`${companionBaseUrl}/`, { redirect: 'manual' });
    expect(rootResponse.status).toBe(302);
    expect(rootResponse.headers.get('location')).toBe('/app/inbox');

    const appResponse = await fetch(`${companionBaseUrl}/app/system`);
    expect(appResponse.status).toBe(200);
    expect(appResponse.headers.get('content-type')).toContain('text/html');
    expect(await appResponse.text()).toContain('companion shell');
  });

  it('rewrites /app/api requests away from the companion SPA fallback', async () => {
    const response = await fetch(`${companionBaseUrl}/app/api/status`, { redirect: 'manual' });

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('companion shell');
  });
});

describe('mountStaticServerApps without built assets', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-web-bootstrap-empty-'));
  const distDir = join(tempRoot, 'missing-dist');
  const distAssetsDir = join(distDir, 'assets');
  const companionDistDir = join(tempRoot, 'missing-companion-dist');

  let appBaseUrl = '';
  let companionBaseUrl = '';
  let closeAppServer: (() => Promise<void>) | null = null;
  let closeCompanionServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const { app, companionApp } = createServerApps();
    mountStaticServerApps({
      app,
      companionApp,
      distDir,
      companionDistDir,
      distAssetsDir,
      companionDisabled: true,
      loopbackHost: '127.0.0.1',
      companionPort: 0,
    });

    const appServer = await startServer(app);
    appBaseUrl = appServer.baseUrl;
    closeAppServer = appServer.close;

    const companionServer = await startServer(companionApp);
    companionBaseUrl = companionServer.baseUrl;
    closeCompanionServer = companionServer.close;
  });

  afterAll(async () => {
    await closeAppServer?.();
    await closeCompanionServer?.();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('shows a desktop build placeholder when the main SPA is missing', async () => {
    const response = await fetch(`${appBaseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('personal-agent web UI');
    expect(await fetch(`${appBaseUrl}/`).then((result) => result.text())).toContain('SPA not built yet.');
  });

  it('shows a companion build placeholder when the companion SPA is missing', async () => {
    const response = await fetch(`${companionBaseUrl}/notes`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('personal-agent companion');
    expect(await fetch(`${companionBaseUrl}/notes`).then((result) => result.text())).toContain('SPA not built yet.');
  });
});
