import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildVaultImageUploadFileName, decodeVaultImageDataUrl, registerVaultEditorRoutes } from './vaultEditor.js';

const vaultRootMock = vi.hoisted(() => ({ value: '' }));

vi.mock('@personal-agent/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@personal-agent/core')>(),
  getVaultRoot: () => vaultRootMock.value,
}));

describe('vaultEditor image uploads', () => {
  it('rejects malformed image data urls before writing attachments', () => {
    expect(() => decodeVaultImageDataUrl('data:image/png;base64,not-valid-base64!'))
      .toThrow('dataUrl must contain valid base64 image data');
  });

  it('rejects non-base64 image data urls before writing attachments', () => {
    expect(() => decodeVaultImageDataUrl('data:image/png,aGVsbG8='))
      .toThrow('dataUrl must be a base64 data: URL');
  });

  it('rejects non-image data urls before writing attachments', () => {
    expect(() => decodeVaultImageDataUrl('data:text/plain;base64,aGVsbG8='))
      .toThrow('dataUrl must be an image data: URL');
  });

  it('uses the image data url extension when upload filenames have non-image extensions', () => {
    expect(buildVaultImageUploadFileName('note.txt', 'data:image/png;base64,aGVsbG8=', 123))
      .toBe('123-note.png');
  });

  it('accepts image data urls with uppercase scheme and mime casing', () => {
    expect(decodeVaultImageDataUrl('DATA:IMAGE/PNG;BASE64,aGVsbG8=').toString('utf-8'))
      .toBe('hello');
    expect(buildVaultImageUploadFileName('note.txt', 'DATA:IMAGE/PNG;BASE64,aGVsbG8=', 123))
      .toBe('123-note.png');
  });

  it('accepts uppercase data urls through the image upload route', () => {
    vaultRootMock.value = mkdtempSync(join(tmpdir(), 'pa-vault-image-upload-'));
    const postHandlers = new Map<string, (req: unknown, res: unknown) => void>();
    registerVaultEditorRoutes({
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn((path: string, handler: (req: unknown, res: unknown) => void) => {
        postHandlers.set(path, handler);
      }),
    });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    postHandlers.get('/api/vault/image')?.({
      body: { filename: 'note.txt', dataUrl: 'DATA:IMAGE/PNG;BASE64,aGVsbG8=' },
    }, { json, status });

    expect(status).not.toHaveBeenCalled();
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^_attachments\/\d+-note\.png$/),
    }));
  });

  it('returns a client error for malformed image upload data urls', () => {
    vaultRootMock.value = mkdtempSync(join(tmpdir(), 'pa-vault-image-upload-bad-'));
    const postHandlers = new Map<string, (req: unknown, res: unknown) => void>();
    registerVaultEditorRoutes({
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      post: vi.fn((path: string, handler: (req: unknown, res: unknown) => void) => {
        postHandlers.set(path, handler);
      }),
    });
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));

    postHandlers.get('/api/vault/image')?.({
      body: { filename: 'note.png', dataUrl: 'data:image/png;base64,not-valid-base64!' },
    }, { json, status });

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ error: 'dataUrl must contain valid base64 image data' });
  });
});
