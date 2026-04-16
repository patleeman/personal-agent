import { describe, expect, it } from 'vitest';
import { looksLikeLocalFilesystemPath } from './localPaths.js';

describe('looksLikeLocalFilesystemPath', () => {
  it('recognizes absolute Unix, home-relative, and Windows paths', () => {
    expect(looksLikeLocalFilesystemPath('/tmp')).toBe(true);
    expect(looksLikeLocalFilesystemPath('/tmp/output/report.md')).toBe(true);
    expect(looksLikeLocalFilesystemPath('~/notes/summary.md')).toBe(true);
    expect(looksLikeLocalFilesystemPath('C:\\Users\\patrick\\notes.md')).toBe(true);
  });

  it('ignores regular inline code tokens that are not filesystem paths', () => {
    expect(looksLikeLocalFilesystemPath('venomoth.us1.staging.dog')).toBe(false);
    expect(looksLikeLocalFilesystemPath('run-nlq-gpu-benchmark')).toBe(false);
    expect(looksLikeLocalFilesystemPath('lassie-phi4-spans-v1-gptq')).toBe(false);
  });

  it('does not mistake bare slash commands for local filesystem paths', () => {
    expect(looksLikeLocalFilesystemPath('/model')).toBe(false);
    expect(looksLikeLocalFilesystemPath('/resume')).toBe(false);
    expect(looksLikeLocalFilesystemPath('/skill:react')).toBe(false);
    expect(looksLikeLocalFilesystemPath('/api')).toBe(false);
  });
});
