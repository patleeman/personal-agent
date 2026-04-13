import { describe, expect, it } from 'vitest';
import {
  buildDesktopReleaseAssetName,
  buildDesktopReleasePageUrl,
  buildDesktopReleaseTag,
  DESKTOP_RELEASE_REPO_SLUG,
} from './release-config.js';

describe('desktop release config', () => {
  it('uses the public release-only repository', () => {
    expect(DESKTOP_RELEASE_REPO_SLUG).toBe('patleeman/personal-agent-releases');
    expect(buildDesktopReleasePageUrl('0.1.14')).toBe('https://github.com/patleeman/personal-agent-releases/releases/tag/v0.1.14');
  });

  it('normalizes version tags and asset names for updater artifacts', () => {
    expect(buildDesktopReleaseTag('v0.1.14')).toBe('v0.1.14');
    expect(buildDesktopReleaseAssetName({ version: 'v0.1.14', ext: 'zip' })).toBe('Personal-Agent-0.1.14-mac-arm64.zip');
    expect(buildDesktopReleaseAssetName({ version: '0.1.14', ext: 'zip.blockmap' })).toBe('Personal-Agent-0.1.14-mac-arm64.zip.blockmap');
  });
});
