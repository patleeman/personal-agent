import { describe, expect, it } from 'vitest';
import { looksLikeLocalFilesystemPath } from './localPaths.js';

describe('looksLikeLocalFilesystemPath', () => {
  it('recognizes absolute Unix, home-relative, and Windows paths', () => {
    expect(looksLikeLocalFilesystemPath('/tmp/output/report.md')).toBe(true);
    expect(looksLikeLocalFilesystemPath('~/notes/summary.md')).toBe(true);
    expect(looksLikeLocalFilesystemPath('C:\\Users\\patrick\\notes.md')).toBe(true);
  });

  it('ignores regular inline code tokens that are not filesystem paths', () => {
    expect(looksLikeLocalFilesystemPath('venomoth.us1.staging.dog')).toBe(false);
    expect(looksLikeLocalFilesystemPath('run-nlq-gpu-benchmark')).toBe(false);
    expect(looksLikeLocalFilesystemPath('lassie-phi4-spans-v1-gptq')).toBe(false);
  });
});
