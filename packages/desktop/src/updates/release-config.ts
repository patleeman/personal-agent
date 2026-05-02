const DEFAULT_DESKTOP_RELEASE_REPO_SLUG = 'patleeman/personal-agent';

function resolveDesktopReleaseRepoSlug(): string {
  const value = process.env.PERSONAL_AGENT_RELEASE_REPO?.trim() || DEFAULT_DESKTOP_RELEASE_REPO_SLUG;
  const parts = value
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length !== 2) {
    return DEFAULT_DESKTOP_RELEASE_REPO_SLUG;
  }

  return `${parts[0]}/${parts[1]}`;
}

export const DESKTOP_RELEASE_REPO_SLUG = resolveDesktopReleaseRepoSlug();
const [DESKTOP_RELEASE_REPO_OWNER_VALUE, DESKTOP_RELEASE_REPO_NAME_VALUE] = DESKTOP_RELEASE_REPO_SLUG.split('/', 2);
export const DESKTOP_RELEASE_REPO_OWNER = DESKTOP_RELEASE_REPO_OWNER_VALUE;
export const DESKTOP_RELEASE_REPO_NAME = DESKTOP_RELEASE_REPO_NAME_VALUE;
export const DESKTOP_RELEASE_ARTIFACT_PREFIX = 'Personal-Agent';

function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '');
}

export function buildDesktopReleaseTag(version: string): string {
  return `v${normalizeVersion(version)}`;
}

export function buildDesktopReleasePageUrl(version: string): string {
  return `https://github.com/${DESKTOP_RELEASE_REPO_SLUG}/releases/tag/${buildDesktopReleaseTag(version)}`;
}

export function buildDesktopReleaseAssetName(options: {
  version: string;
  arch?: 'arm64' | 'x64';
  ext: 'zip' | 'dmg' | 'zip.blockmap' | 'dmg.blockmap';
}): string {
  const version = normalizeVersion(options.version);
  const arch = options.arch ?? 'arm64';
  return `${DESKTOP_RELEASE_ARTIFACT_PREFIX}-${version}-mac-${arch}.${options.ext}`;
}
