import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { importVaultSharedItem } from './vaultShareImport.js';

describe('vaultShareImport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates markdown notes for shared text', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-text-'));
    const targetDirAbs = join(root, 'Inbox');
    const imported = await importVaultSharedItem({
      kind: 'text',
      root,
      targetDirAbs,
      title: 'Quick note',
      text: 'remember this snippet',
      sourceApp: 'Notes',
      createdAt: '2026-04-22T12:00:00.000Z',
    });

    expect(imported.sourceKind).toBe('text');
    const note = readFileSync(imported.notePath, 'utf-8');
    expect(note).toContain('title: Quick note');
    expect(note).toContain('source_type: shared-text');
    expect(note).toContain('remember this snippet');
  });

  it('creates markdown notes plus backing assets for shared images', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-image-'));
    const targetDirAbs = join(root, 'Inbox');
    const imported = await importVaultSharedItem({
      kind: 'image',
      root,
      targetDirAbs,
      title: 'Screenshot',
      mimeType: 'image/png',
      fileName: 'screenshot.png',
      dataBase64: Buffer.from('image-bytes', 'utf-8').toString('base64'),
      createdAt: '2026-04-22T12:00:00.000Z',
    });

    expect(imported.asset?.id.startsWith('_attachments/')).toBe(true);
    const note = readFileSync(imported.notePath, 'utf-8');
    expect(note).toContain('source_type: shared-image');
    expect(note).toContain(imported.asset?.url ?? '');
  });

  it('rejects malformed shared image base64', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-bad-image-'));
    const targetDirAbs = join(root, 'Inbox');

    await expect(importVaultSharedItem({
      kind: 'image',
      root,
      targetDirAbs,
      title: 'Bad Screenshot',
      mimeType: 'image/png',
      fileName: 'screenshot.png',
      dataBase64: 'not-valid-base64!',
      createdAt: '2026-04-22T12:00:00.000Z',
    })).rejects.toThrow('Shared image data must be valid base64.');
  });

  it('extracts readable markdown for shared URLs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-url-'));
    const targetDirAbs = join(root, 'Inbox');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<!doctype html><html><head><title>Example Article</title><meta name="description" content="Article summary"></head><body><article><h1>Example Article</h1><p>Important captured content.</p></article></body></html>`, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })));

    const imported = await importVaultSharedItem({
      kind: 'url',
      root,
      targetDirAbs,
      url: 'https://example.com/post',
      createdAt: '2026-04-22T12:00:00.000Z',
    });

    const note = readFileSync(imported.notePath, 'utf-8');
    expect(note).toContain('source_type: shared-url');
    expect(note).toContain('source_url: https://example.com/post');
    expect(note).toContain('Important captured content.');
  });
});
