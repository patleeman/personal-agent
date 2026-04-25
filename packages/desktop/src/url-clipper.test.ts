import { describe, expect, it, vi } from 'vitest';
import { importClipboardUrlToKnowledge, normalizeClipboardUrl, type DesktopUrlClipperHost } from './url-clipper.js';

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(body)),
  };
}

function createHost(response = jsonResponse(201, { title: 'Example', note: { id: 'Inbox/example.md' } })) {
  const dispatchApiRequest = vi.fn().mockResolvedValue(response);
  const host: DesktopUrlClipperHost = {
    ensureActiveHostRunning: vi.fn().mockResolvedValue(undefined),
    getActiveHostController: () => ({ dispatchApiRequest }),
  };
  return { host, dispatchApiRequest };
}

describe('normalizeClipboardUrl', () => {
  it('accepts http and https URLs from clipboard text', () => {
    expect(normalizeClipboardUrl(' https://example.com/path?q=1\n')).toBe('https://example.com/path?q=1');
  });

  it('rejects empty, invalid, and non-web clipboard values', () => {
    expect(() => normalizeClipboardUrl('')).toThrow('Clipboard is empty');
    expect(() => normalizeClipboardUrl('not a url')).toThrow('valid URL');
    expect(() => normalizeClipboardUrl('file:///tmp/a.txt')).toThrow('Only http and https');
  });
});

describe('importClipboardUrlToKnowledge', () => {
  it('imports the clipboard URL into the Knowledge Inbox', async () => {
    const { host, dispatchApiRequest } = createHost();

    await expect(importClipboardUrlToKnowledge({
      host,
      clipboardText: 'https://example.com/article',
      createdAt: '2026-04-25T12:00:00.000Z',
    })).resolves.toEqual({ title: 'Example', note: { id: 'Inbox/example.md' } });

    expect(host.ensureActiveHostRunning).toHaveBeenCalledOnce();
    expect(dispatchApiRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/vault/share-import',
      body: {
        kind: 'url',
        url: 'https://example.com/article',
        directoryId: 'Inbox',
        sourceApp: 'Personal Agent Desktop',
        createdAt: '2026-04-25T12:00:00.000Z',
      },
    });
  });

  it('surfaces API errors', async () => {
    const { host } = createHost(jsonResponse(500, { error: 'boom' }));

    await expect(importClipboardUrlToKnowledge({
      host,
      clipboardText: 'https://example.com/article',
    })).rejects.toThrow('boom');
  });
});
