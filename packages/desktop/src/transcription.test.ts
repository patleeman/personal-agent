import { describe, expect, it } from 'vitest';
import { testExports } from './transcription.js';

describe('desktop transcription', () => {
  it('rejects malformed transcription file base64 before building multipart payloads', () => {
    expect(() => testExports.buildMultipartBody({ dataBase64: 'not-valid-base64!' }))
      .toThrow('dataBase64 must contain valid base64 data.');
  });
});
