import { describe, expect, it } from 'vitest';

import { normalizeClipboardUrl } from './url-clipper.js';

// ── url-clipper — clipboard URL normalization ─────────────────────────────

describe('normalizeClipboardUrl', () => {
  it('normalizes a valid http URL', () => {
    expect(normalizeClipboardUrl('http://example.com')).toBe('http://example.com/');
  });

  it('normalizes a valid https URL', () => {
    expect(normalizeClipboardUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('trims whitespace', () => {
    expect(normalizeClipboardUrl('  https://example.com  ')).toBe('https://example.com/');
  });

  it('takes the first non-empty line from multiline input', () => {
    expect(normalizeClipboardUrl('\n\nhttps://example.com\nignore this\n')).toBe('https://example.com/');
  });

  it('throws on empty input', () => {
    expect(() => normalizeClipboardUrl('')).toThrow('Clipboard is empty');
  });

  it('throws on whitespace-only input', () => {
    expect(() => normalizeClipboardUrl('   ')).toThrow('Clipboard is empty');
  });

  it('throws on invalid URL', () => {
    expect(() => normalizeClipboardUrl('not a url')).toThrow('valid URL');
  });

  it('throws on non-http protocol', () => {
    expect(() => normalizeClipboardUrl('ftp://example.com')).toThrow('Only http and https');
  });

  it('throws on javascript protocol', () => {
    expect(() => normalizeClipboardUrl('javascript:alert(1)')).toThrow('Only http and https');
  });
});
