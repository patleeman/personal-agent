import { describe, expect, it } from 'vitest';
// @ts-expect-error electron-builder config is plain ESM, not typed TS.
import electronBuilderConfig, { desktopReleasePublishConfig } from '../../../../electron-builder.config.mjs';
import {
  buildDesktopReleaseAssetName,
  buildDesktopReleasePageUrl,
  buildDesktopReleaseTag,
  DESKTOP_RELEASE_REPO_NAME,
  DESKTOP_RELEASE_REPO_OWNER,
  DESKTOP_RELEASE_REPO_SLUG,
} from './release-config.js';

describe('desktop release config', () => {
  it('uses the public release-only repository', () => {
    expect(DESKTOP_RELEASE_REPO_SLUG).toBe('patleeman/personal-agent');
    expect(buildDesktopReleasePageUrl('0.1.14')).toBe('https://github.com/patleeman/personal-agent/releases/tag/v0.1.14');
  });

  it('keeps the packaged updater feed pointed at the same release repo', () => {
    expect(desktopReleasePublishConfig).toMatchObject({
      provider: 'github',
      owner: DESKTOP_RELEASE_REPO_OWNER,
      repo: DESKTOP_RELEASE_REPO_NAME,
      releaseType: 'release',
    });
  });

  it('unpacks native sqlite loader dependencies together', () => {
    expect(electronBuilderConfig.asarUnpack).toEqual(expect.arrayContaining([
      'node_modules/better-sqlite3/**/*',
      'node_modules/bindings/**/*',
      'node_modules/file-uri-to-path/**/*',
    ]));
  });

  it('does not treat the local sharp stub as a native module', () => {
    expect(electronBuilderConfig.asarUnpack).not.toContain('node_modules/sharp/**/*');
  });

  it('normalizes version tags and asset names for updater artifacts', () => {
    expect(buildDesktopReleaseTag('v0.1.14')).toBe('v0.1.14');
    expect(buildDesktopReleaseAssetName({ version: 'v0.1.14', ext: 'zip' })).toBe('Personal-Agent-0.1.14-mac-arm64.zip');
    expect(buildDesktopReleaseAssetName({ version: '0.1.14', ext: 'zip.blockmap' })).toBe('Personal-Agent-0.1.14-mac-arm64.zip.blockmap');
  });
});
