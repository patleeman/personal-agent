import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseGitHubRemoteUrl,
  resolveBundledDifftasticCommand,
  resolveDifftasticPlatformKey,
} from './checkpointReview.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRepoRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-checkpoint-review-'));
  tempDirs.push(dir);
  return dir;
}

describe('checkpointReview', () => {
  it('parses common GitHub remote URL formats', () => {
    expect(parseGitHubRemoteUrl('git@github.com:patleeman/personal-agent.git')).toEqual({
      owner: 'patleeman',
      repo: 'personal-agent',
      repoUrl: 'https://github.com/patleeman/personal-agent',
    });

    expect(parseGitHubRemoteUrl('https://github.com/patleeman/personal-agent')).toEqual({
      owner: 'patleeman',
      repo: 'personal-agent',
      repoUrl: 'https://github.com/patleeman/personal-agent',
    });
  });

  it('maps runtime platforms to bundled difftastic keys', () => {
    expect(resolveDifftasticPlatformKey('darwin', 'arm64')).toBe('darwin-arm64');
    expect(resolveDifftasticPlatformKey('linux', 'x64')).toBe('linux-x64');
    expect(resolveDifftasticPlatformKey('plan9', 'x64')).toBeNull();
  });

  it('prefers a vendored difft binary when present', () => {
    const repoRoot = createTempRepoRoot();
    const bundledDir = join(repoRoot, 'packages', 'desktop', 'vendor', 'difftastic', 'darwin-arm64');
    mkdirSync(bundledDir, { recursive: true });
    const binaryPath = join(bundledDir, 'difft');
    writeFileSync(binaryPath, '#!/bin/sh\necho difft 0.68.0\n');
    chmodSync(binaryPath, 0o755);

    expect(resolveBundledDifftasticCommand({
      repoRoot,
      platform: 'darwin',
      arch: 'arm64',
    })).toBe(binaryPath);
  });
});
