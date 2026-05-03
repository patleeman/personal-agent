import { describe, expect, it } from 'vitest';
import { readRequiredBase64 } from './transcription.js';

describe('readRequiredBase64', () => {
  it('decodes valid base64', () => {
    const buf = readRequiredBase64('aGVsbG8=', 'Audio data');
    expect(buf.toString()).toBe('hello');
  });

  it('throws for non-string value', () => {
    expect(() => readRequiredBase64(123, 'Audio')).toThrow('Audio is required');
  });

  it('throws for empty string', () => {
    expect(() => readRequiredBase64('', 'Input')).toThrow('Input is required');
  });

  it('throws for whitespace-only', () => {
    expect(() => readRequiredBase64('   ', 'Input')).toThrow('Input is required');
  });

  it('throws for invalid base64 characters', () => {
    expect(() => readRequiredBase64('!!!', 'Audio')).toThrow('Audio must contain valid base64 data');
  });

  it('rejects base64 with single character (length % 4 == 1)', () => {
    expect(() => readRequiredBase64('Y', 'Audio')).toThrow('Audio must contain valid base64 data');
  });
});
