import { describe, expect, it } from 'vitest';

import { parseApiDispatchResult, readApiDispatchError } from './hosts/api-dispatch.js';

// ── api-dispatch — HTTP response parsing for API dispatches ───────────────

function makeResult(statusCode: number, body: string, contentType = 'application/json'): Parameters<typeof readApiDispatchError>[0] {
  return {
    statusCode,
    headers: { 'content-type': contentType },
    body: new Uint8Array(Buffer.from(body, 'utf-8')),
  };
}

describe('readApiDispatchError', () => {
  it('extracts error from JSON body', () => {
    const err = readApiDispatchError(makeResult(400, JSON.stringify({ error: 'Bad request' })));
    expect(err).toBe('Bad request');
  });

  it('falls back to status code for non-JSON body', () => {
    const err = readApiDispatchError(makeResult(500, 'Internal error', 'text/plain'));
    expect(err).toBe('Internal error');
  });

  it('returns JSON body when JSON error field is missing', () => {
    const err = readApiDispatchError(makeResult(404, JSON.stringify({ message: 'Not found' })));
    expect(err).toContain('Not found');
  });

  it('handles empty body', () => {
    const err = readApiDispatchError(makeResult(503, '', 'text/plain'));
    expect(err).toBe('HTTP 503');
  });

  it('is case-insensitive for content-type header', () => {
    const err = readApiDispatchError({
      statusCode: 400,
      headers: { 'Content-Type': 'APPLICATION/JSON' },
      body: new Uint8Array(Buffer.from(JSON.stringify({ error: 'Auth failed' }), 'utf-8')),
    });
    expect(err).toBe('Auth failed');
  });
});

describe('parseApiDispatchResult', () => {
  it('parses JSON body', () => {
    const result = parseApiDispatchResult<{ ok: boolean }>(makeResult(200, JSON.stringify({ ok: true })));
    expect(result).toEqual({ ok: true });
  });

  it('returns text body for non-JSON content type', () => {
    const result = parseApiDispatchResult(makeResult(200, 'plain text', 'text/plain'));
    expect(result).toBe('plain text');
  });
});
