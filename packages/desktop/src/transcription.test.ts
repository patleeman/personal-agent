import { describe, expect, it } from 'vitest';
import { testExports } from './transcription.js';

describe('desktop transcription', () => {
  it('rejects malformed transcription file base64 before building multipart payloads', () => {
    expect(() => testExports.buildMultipartBody({ dataBase64: 'not-valid-base64!' }))
      .toThrow('dataBase64 must contain valid base64 data.');
  });

  it('strips control characters from multipart transcription filenames', () => {
    const { body } = testExports.buildMultipartBody({
      dataBase64: Buffer.from('audio').toString('base64'),
      fileName: 'dictation.webm"\r\nX-Injected: yes',
    });

    const multipart = body.toString('utf-8');
    expect(multipart).toContain('filename="dictation.webmX-Injected: yes"');
    expect(multipart).not.toContain('\r\nX-Injected: yes');
  });
});
