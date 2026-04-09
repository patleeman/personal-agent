import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  compareVersions,
  downloadReleaseAssetWithGitHubCli,
  fetchLatestReleaseCandidate,
  selectLatestReleaseCandidate,
  selectReleaseDownloadAsset,
  type GitHubReleaseRecord,
} from './github-releases.js';

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

    expect(selectLatestReleaseCandidate(releases, '0.1.9', 'darwin', 'arm64', 'github-cli')).toEqual({
      tagName: 'v0.2.0',
      version: '0.2.0',
      releaseUrl: 'https://github.com/patleeman/personal-agent/releases/tag/v0.2.0',
      downloadUrl: 'https://example.test/0.2.0.dmg',
      downloadName: 'Personal.Agent-0.2.0-mac-arm64.dmg',
      source: 'github-cli',
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

describe('fetchLatestReleaseCandidate', () => {
  it('prefers authenticated GitHub CLI release data when available', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const candidate = await fetchLatestReleaseCandidate({
      currentVersion: '0.1.9',
      fetchImpl,
      fetchGitHubCliReleasesImpl: async () => ({
        command: '/opt/homebrew/bin/gh',
        releases: [
          {
            tag_name: 'v0.2.0',
            html_url: 'https://github.com/patleeman/personal-agent/releases/tag/v0.2.0',
            draft: false,
            prerelease: false,
            assets: [
              { name: 'Personal.Agent-0.2.0-mac-arm64.dmg', browser_download_url: 'https://example.test/0.2.0.dmg' },
            ],
          },
        ],
      }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(candidate?.source).toBe('github-cli');
    expect(candidate?.version).toBe('0.2.0');
  });

  it('falls back to the public GitHub releases API when GitHub CLI is unavailable', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ([
        {
          tag_name: 'v0.2.1',
          html_url: 'https://github.com/patleeman/personal-agent/releases/tag/v0.2.1',
          draft: false,
          prerelease: false,
          assets: [
            { name: 'Personal.Agent-0.2.1-mac-arm64.dmg', browser_download_url: 'https://example.test/0.2.1.dmg' },
          ],
        },
      ]),
    }) as Response);

    const candidate = await fetchLatestReleaseCandidate({
      currentVersion: '0.2.0',
      fetchImpl,
      fetchGitHubCliReleasesImpl: async () => {
        throw new Error('Could not run `gh`. Install GitHub CLI and authenticate with `gh auth login` to check for updates for this private repo.');
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(candidate?.source).toBe('github-api');
    expect(candidate?.version).toBe('0.2.1');
  });

  it('reports private repo guidance when GitHub CLI fails and the public API returns 404', async () => {
    await expect(fetchLatestReleaseCandidate({
      currentVersion: '0.1.9',
      fetchImpl: vi.fn<typeof fetch>(async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      }) as Response),
      fetchGitHubCliReleasesImpl: async () => {
        throw new Error('Could not run `gh`. Install GitHub CLI and authenticate with `gh auth login` to check for updates for this private repo.');
      },
    })).rejects.toThrow(/private GitHub repo requires GitHub CLI auth/i);
  });
});

describe('downloadReleaseAssetWithGitHubCli', () => {
  it('downloads a release asset with GitHub CLI into the requested directory', async () => {
    const runGitHubCliCommandImpl = vi.fn(async () => ({
      command: '/opt/homebrew/bin/gh',
      stdout: '',
      stderr: '',
    }));

    const outputDir = resolve('/tmp/personal-agent-updates');
    const result = await downloadReleaseAssetWithGitHubCli({
      tagName: 'v0.2.0',
      assetName: 'Personal Agent-0.2.0-mac-arm64.dmg',
      outputDir,
      runGitHubCliCommandImpl,
    });

    expect(runGitHubCliCommandImpl).toHaveBeenCalledWith([
      'release',
      'download',
      'v0.2.0',
      '--repo',
      'patleeman/personal-agent',
      '--pattern',
      'Personal Agent-0.2.0-mac-arm64.dmg',
      '--dir',
      outputDir,
      '--clobber',
    ]);
    expect(result).toEqual({
      command: '/opt/homebrew/bin/gh',
      filePath: join(outputDir, 'Personal Agent-0.2.0-mac-arm64.dmg'),
    });
  });
});
