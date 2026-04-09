import { describe, expect, it } from 'vitest';
import { compareVersions, selectLatestReleaseCandidate, selectReleaseDownloadAsset, type GitHubReleaseRecord } from './github-releases.js';

describe('compareVersions', () => {
  it('orders stable and prerelease semver values correctly', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0);
    expect(compareVersions('0.2.0-beta.1', '0.2.0-beta.2')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.2.0-beta.2')).toBeGreaterThan(0);
  });
});

describe('selectReleaseDownloadAsset', () => {
  it('prefers the matching mac dmg for the current architecture', () => {
    const asset = selectReleaseDownloadAsset([
      { name: 'Personal.Agent-0.2.0-mac-arm64.zip', browser_download_url: 'https://example.test/zip' },
      { name: 'Personal.Agent-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.test/dmg' },
    ], 'darwin', 'arm64');

    expect(asset?.name).toBe('Personal.Agent-0.2.0-mac-arm64.dmg');
  });
});

describe('selectLatestReleaseCandidate', () => {
  it('ignores prereleases for stable installs and returns the newest downloadable mac build', () => {
    const releases: GitHubReleaseRecord[] = [
      {
        tag_name: 'v0.3.0-beta.1',
        html_url: 'https://github.com/patleeman/personal-agent/releases/tag/v0.3.0-beta.1',
        draft: false,
        prerelease: true,
        assets: [
          { name: 'Personal.Agent-0.3.0-beta.1-mac-arm64.dmg', browser_download_url: 'https://example.test/beta.dmg' },
        ],
      },
      {
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/patleeman/personal-agent/releases/tag/v0.2.0',
        draft: false,
        prerelease: false,
        assets: [
          { name: 'Personal.Agent-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.test/0.2.0.dmg' },
        ],
      },
    ];

    expect(selectLatestReleaseCandidate(releases, '0.1.9', 'darwin', 'arm64')).toEqual({
      version: '0.2.0',
      releaseUrl: 'https://github.com/patleeman/personal-agent/releases/tag/v0.2.0',
      downloadUrl: 'https://example.test/0.2.0.dmg',
      downloadName: 'Personal.Agent-0.2.0-mac-arm64.dmg',
    });
  });

  it('returns null when the current version is already current', () => {
    const releases: GitHubReleaseRecord[] = [
      {
        tag_name: 'v0.2.0',
        html_url: 'https://github.com/patleeman/personal-agent/releases/tag/v0.2.0',
        draft: false,
        prerelease: false,
        assets: [
          { name: 'Personal.Agent-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.test/0.2.0.dmg' },
        ],
      },
    ];

    expect(selectLatestReleaseCandidate(releases, '0.2.0', 'darwin', 'arm64')).toBeNull();
  });
});
