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

  let appBaseUrl = '';
  let closeAppServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    mkdirSync(distAssetsDir, { recursive: true });
    writeFileSync(join(distDir, 'index.html'), '<!doctype html><html><body>desktop shell</body></html>');
    writeFileSync(join(distAssetsDir, 'app.js'), 'console.log("ok");\n');

    const { app } = createServerApps();
    mountStaticServerApps({
      app,
      distDir,
    });

    const appServer = await startServer(app);
    appBaseUrl = appServer.baseUrl;
    closeAppServer = appServer.close;
  });

  afterAll(async () => {
    await closeAppServer?.();
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

  it('serves the main SPA shell for legacy /app routes', async () => {
    const response = await fetch(`${appBaseUrl}/app/tasks?tab=queued`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('desktop shell');
  });
});

describe('mountStaticServerApps without built assets', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-web-bootstrap-empty-'));
  const distDir = join(tempRoot, 'missing-dist');

  let appBaseUrl = '';
  let closeAppServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const { app } = createServerApps();
    mountStaticServerApps({
      app,
      distDir,
    });

    const appServer = await startServer(app);
    appBaseUrl = appServer.baseUrl;
    closeAppServer = appServer.close;
  });

  afterAll(async () => {
    await closeAppServer?.();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('shows a desktop build placeholder when the main SPA is missing', async () => {
    const response = await fetch(`${appBaseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('personal-agent web UI');
    expect(await fetch(`${appBaseUrl}/`).then((result) => result.text())).toContain('SPA not built yet.');
  });

});
