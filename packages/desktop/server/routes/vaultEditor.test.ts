import { describe, expect, it } from 'vitest';

import { buildVaultImageUploadFileName, decodeVaultImageDataUrl } from './vaultEditor.js';

describe('decodeVaultImageDataUrl', () => {
  it('decodes a valid data URL', () => {
    const buf = decodeVaultImageDataUrl('data:image/png;base64,aGVsbG8=');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.toString()).toBe('hello');
  });

  it('throws for non-data URL', () => {
    expect(() => decodeVaultImageDataUrl('http://example.com')).toThrow('dataUrl must be a data: URL');
  });

  it('throws for missing comma', () => {
    expect(() => decodeVaultImageDataUrl('data:text/plain')).toThrow('dataUrl must contain valid base64 image data');
  });

  it('throws for invalid base64', () => {
    expect(() => decodeVaultImageDataUrl('data:image/png;base64,!!!')).toThrow();
  });
});

describe('buildVaultImageUploadFileName', () => {
  it('builds filename with png extension from data URL', () => {
    const name = buildVaultImageUploadFileName('photo.png', 'data:image/png;base64,abc', 1234567890);
    expect(name).toBe('1234567890-photo.png');
  });

  it('builds filename with jpeg extension from data URL', () => {
    const name = buildVaultImageUploadFileName('photo.jpg', 'data:image/jpeg;base64,abc', 1234567890);
    expect(name).toBe('1234567890-photo.jpg');
  });

  it('handles filenames with special characters', () => {
    const name = buildVaultImageUploadFileName('my file (2).png', 'data:image/png;base64,abc', 1);
    expect(name).toBe('1-my-file--2-.png');
  });

  it('keeps base name for filenames without extension', () => {
    const name = buildVaultImageUploadFileName('photo', 'data:image/png;base64,abc', 1);
    expect(name).toBe('1-photo.png');
  });
});
