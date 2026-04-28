import { describe, expect, it } from 'vitest';
import { decodeVaultImageDataUrl } from './vaultEditor.js';

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
});
