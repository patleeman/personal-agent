import { describe, expect, it } from 'vitest';

import { testExports } from './localWhisperProvider.js';

describe('local whisper provider', () => {
  it('includes the desktop package when resolving whisper-cpp-node from the bundled extension', () => {
    const candidates = testExports.buildWhisperRequireCandidatePaths(
      'file:///repo/extensions/system-local-dictation/dist/backend.mjs',
      '/tmp/not-the-repo-root',
    );

    expect(candidates).toContain('/repo/packages/desktop/package.json');
  });

  it('formats tuple segments returned by whisper-cpp-node', () => {
    expect(
      testExports.formatWhisperSegments([
        ['00:00:00.000', '00:00:01.000', ' hello '],
        ['00:00:01.000', '00:00:02.000', 'world'],
      ]),
    ).toBe('hello world');
  });

  it('formats object segments defensively', () => {
    expect(
      testExports.formatWhisperSegments([
        { start: '00:00:00.000', end: '00:00:01.000', text: ' hello ' },
        { start: '00:00:01.000', end: '00:00:02.000', text: 'world' },
      ]),
    ).toBe('hello world');
  });
});
