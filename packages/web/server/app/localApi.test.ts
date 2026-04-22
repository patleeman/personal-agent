import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('./bootstrap.js', async () => {
  const actual = await vi.importActual<typeof import('./bootstrap.js')>('./bootstrap.js');
  return {
    ...actual,
    startDeferredResumeLoop: vi.fn(),
  };
});

vi.mock('@personal-agent/core', async () => {
  const actual = await vi.importActual<typeof import('@personal-agent/core')>('@personal-agent/core');
  return {
    ...actual,
    startKnowledgeBaseSyncLoop: vi.fn(),
  };
});

import { dispatchDesktopLocalApiRequest } from './localApi.js';

function readJsonBody(response: Awaited<ReturnType<typeof dispatchDesktopLocalApiRequest>>) {
  return JSON.parse(Buffer.from(response.body).toString('utf-8')) as Record<string, unknown>;
}

describe('desktop local API vault routes', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'pa-local-api-vault-'));
  const previousVaultRoot = process.env.PERSONAL_AGENT_VAULT_ROOT;

  afterAll(() => {
    if (previousVaultRoot === undefined) {
      delete process.env.PERSONAL_AGENT_VAULT_ROOT;
    } else {
      process.env.PERSONAL_AGENT_VAULT_ROOT = previousVaultRoot;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('registers vault routes and handles GET + PUT requests for the knowledge workspace', async () => {
    process.env.PERSONAL_AGENT_VAULT_ROOT = tempRoot;
    mkdirSync(join(tempRoot, 'notes'), { recursive: true });
    mkdirSync(join(tempRoot, '_attachments'), { recursive: true });
    writeFileSync(join(tempRoot, 'notes', 'existing.md'), '# Existing\n', 'utf-8');
    writeFileSync(join(tempRoot, '_attachments', 'demo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf-8');

    const treeResponse = await dispatchDesktopLocalApiRequest({
      method: 'GET',
      path: '/api/vault/tree',
    });

    expect(treeResponse.statusCode).toBe(200);
    expect(readJsonBody(treeResponse)).toEqual(expect.objectContaining({
      root: tempRoot,
      entries: expect.arrayContaining([
        expect.objectContaining({ id: 'notes/', kind: 'folder', name: 'notes' }),
      ]),
    }));

    const writeResponse = await dispatchDesktopLocalApiRequest({
      method: 'PUT',
      path: '/api/vault/file',
      body: {
        id: 'notes/new-note.md',
        content: '# New note\n',
      },
    });

    expect(writeResponse.statusCode).toBe(200);
    expect(readJsonBody(writeResponse)).toEqual(expect.objectContaining({
      id: 'notes/new-note.md',
      kind: 'file',
      name: 'new-note.md',
    }));
    expect(readFileSync(join(tempRoot, 'notes', 'new-note.md'), 'utf-8')).toBe('# New note\n');

    const assetResponse = await dispatchDesktopLocalApiRequest({
      method: 'GET',
      path: '/api/vault/asset?id=_attachments%2Fdemo.svg',
    });

    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers['content-type']).toContain('image/svg+xml');
    expect(Buffer.from(assetResponse.body).toString('utf-8')).toContain('<svg');
  });
});
