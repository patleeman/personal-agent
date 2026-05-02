import { describe, expect, it } from 'vitest';

import { buildContentDispositionHeader, sanitizeContentDispositionFilename } from './httpHeaders.js';

describe('content disposition headers', () => {
  it('keeps simple filenames intact', () => {
    expect(sanitizeContentDispositionFilename('hello.png')).toBe('hello.png');
    expect(buildContentDispositionHeader('inline', 'hello.png')).toBe('inline; filename="hello.png"');
  });

  it('removes header-breaking characters and non-ascii glyphs', () => {
    expect(sanitizeContentDispositionFilename('bad\r\nname "😀".png')).toBe('bad name _.png');
    expect(buildContentDispositionHeader('attachment', 'bad\r\nname "😀".png')).toBe('attachment; filename="bad name _.png"');
  });

  it('falls back when nothing safe remains', () => {
    expect(sanitizeContentDispositionFilename('"😀\\\r\n"')).toBe('download');
  });
});
