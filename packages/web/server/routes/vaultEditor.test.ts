import { describe, expect, it } from 'vitest';
import { decodeVaultImageDataUrl } from './vaultEditor.js';

describe('vaultEditor image uploads', () => {
  it('rejects malformed image data urls before writing attachments', () => {
    expect(() => decodeVaultImageDataUrl('data:image/png;base64,not-valid-base64!'))
      .toThrow('dataUrl must contain valid base64 image data');
  });
});
