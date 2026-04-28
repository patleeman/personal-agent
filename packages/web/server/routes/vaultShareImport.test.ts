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

  it('uses the image mime extension when shared image filenames have non-image extensions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-image-extension-'));
    const targetDirAbs = join(root, 'Inbox');
    const imported = await importVaultSharedItem({
      kind: 'image',
      root,
      targetDirAbs,
      title: 'Screenshot',
      mimeType: 'image/png',
      fileName: 'screenshot.txt',
      dataBase64: Buffer.from('image-bytes', 'utf-8').toString('base64'),
      createdAt: '2026-04-22T12:00:00.000Z',
    });

    expect(imported.asset?.id).toMatch(/\.png$/);
  });

  it('uses the shared image data url mime type over stale mime metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-image-data-url-mime-'));
    const targetDirAbs = join(root, 'Inbox');
    const imported = await importVaultSharedItem({
      kind: 'image',
      root,
      targetDirAbs,
      title: 'Screenshot',
      mimeType: 'text/plain',
      fileName: 'screenshot.txt',
      dataBase64: `data:image/png;base64,${Buffer.from('image-bytes', 'utf-8').toString('base64')}`,
      createdAt: '2026-04-22T12:00:00.000Z',
    });

    expect(imported.asset?.id).toMatch(/\.png$/);
    expect(readFileSync(imported.notePath, 'utf-8')).toContain('mime_type: image/png');
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

  it('rejects non-base64 shared image data urls', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-non-base64-image-'));
    const targetDirAbs = join(root, 'Inbox');

    await expect(importVaultSharedItem({
      kind: 'image',
      root,
      targetDirAbs,
      title: 'Bad Screenshot',
      mimeType: 'image/png',
      fileName: 'screenshot.png',
      dataBase64: 'data:image/png,aGVsbG8=',
      createdAt: '2026-04-22T12:00:00.000Z',
    })).rejects.toThrow('Shared image data URL must be base64-encoded.');
  });

  it('rejects shared image imports with non-image mime types', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-vault-share-non-image-'));
    const targetDirAbs = join(root, 'Inbox');

    await expect(importVaultSharedItem({
      kind: 'image',
      root,
      targetDirAbs,
      title: 'Not an image',
      mimeType: 'text/plain',
      fileName: 'note.txt',
      dataBase64: Buffer.from('not-image-bytes', 'utf-8').toString('base64'),
      createdAt: '2026-04-22T12:00:00.000Z',
    })).rejects.toThrow('mimeType must be an image type for image imports.');
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
