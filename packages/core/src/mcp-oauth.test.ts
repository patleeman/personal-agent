import { describe, expect, it } from 'vitest';
import {
  getMcpServerUrlHash,
} from './mcp-oauth.js';

describe('getMcpServerUrlHash', () => {
  it('produces consistent hashes from the same inputs', () => {
    const hash1 = getMcpServerUrlHash('https://example.com/mcp');
    const hash2 = getMcpServerUrlHash('https://example.com/mcp');
    expect(hash1).toBe(hash2);
  });

  it('includes authorizeResource in the hash', () => {
    const without = getMcpServerUrlHash('https://example.com/mcp');
    const withResource = getMcpServerUrlHash('https://example.com/mcp', 'resource-1');
    expect(withResource).not.toBe(without);
  });

  it('includes headers in the hash deterministically by sorted key', () => {
    const h1 = getMcpServerUrlHash('https://example.com/mcp', undefined, { a: '1', b: '2' });
    const h2 = getMcpServerUrlHash('https://example.com/mcp', undefined, { b: '2', a: '1' });
    expect(h1).toBe(h2);
  });

  it('produces hex strings', () => {
    const hash = getMcpServerUrlHash('https://example.com/mcp');
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
  });
});
