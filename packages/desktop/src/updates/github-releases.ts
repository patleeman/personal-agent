export interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface GitHubReleaseRecord {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  assets: GitHubReleaseAsset[];
}

export interface DesktopReleaseCandidate {
  version: string;
  releaseUrl: string;
  downloadUrl: string | null;
  downloadName: string | null;
}

function parseVersionSegments(value: string): { main: number[]; prerelease: string[] } | null {
  const normalized = value.trim().replace(/^v/i, '');
  if (!normalized) {
    return null;
  }

  const [mainPart, prereleasePart] = normalized.split('-', 2);
  const main = mainPart.split('.').map((segment) => Number.parseInt(segment, 10));
  if (main.length === 0 || main.some((segment) => Number.isNaN(segment))) {
    return null;
  }

  return {
    main,
    prerelease: prereleasePart
      ? prereleasePart.split('.').map((segment) => segment.trim()).filter((segment) => segment.length > 0)
      : [],
  };
}

function comparePrereleaseSegments(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = left[index];
    const rightSegment = right[index];
    if (leftSegment === undefined) {
      return -1;
    }
    if (rightSegment === undefined) {
      return 1;
    }

    const leftNumber = Number.parseInt(leftSegment, 10);
    const rightNumber = Number.parseInt(rightSegment, 10);
    const leftIsNumber = String(leftNumber) === leftSegment;
    const rightIsNumber = String(rightNumber) === rightSegment;

    if (leftIsNumber && rightIsNumber && leftNumber !== rightNumber) {
      return leftNumber > rightNumber ? 1 : -1;
    }
    if (leftIsNumber !== rightIsNumber) {
      return leftIsNumber ? -1 : 1;
    }
    if (leftSegment !== rightSegment) {
      return leftSegment.localeCompare(rightSegment);
    }
  }

  return 0;
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersionSegments(left);
  const rightParts = parseVersionSegments(right);
  if (!leftParts || !rightParts) {
    return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
  }

  const length = Math.max(leftParts.main.length, rightParts.main.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftParts.main[index] ?? 0;
    const rightSegment = rightParts.main[index] ?? 0;
    if (leftSegment !== rightSegment) {
      return leftSegment > rightSegment ? 1 : -1;
    }
  }

  return comparePrereleaseSegments(leftParts.prerelease, rightParts.prerelease);
}

export function selectReleaseDownloadAsset(
  assets: GitHubReleaseAsset[],
  targetPlatform: NodeJS.Platform = process.platform,
  targetArch: NodeJS.Architecture = process.arch,
): GitHubReleaseAsset | null {
  if (targetPlatform !== 'darwin') {
    return null;
  }

  const archMatchers = targetArch === 'arm64'
    ? [/mac[-.]arm64\.dmg$/i, /mac[-.]arm64\.zip$/i]
    : [/mac[-.]x64\.dmg$/i, /mac[-.]x64\.zip$/i];
  const fallbackMatchers = [/\.dmg$/i, /\.zip$/i];

  for (const matcher of [...archMatchers, ...fallbackMatchers]) {
    const match = assets.find((asset) => matcher.test(asset.name));
    if (match) {
      return match;
    }
  }

  return null;
}

export function selectLatestReleaseCandidate(
  releases: GitHubReleaseRecord[],
  currentVersion: string,
  targetPlatform: NodeJS.Platform = process.platform,
  targetArch: NodeJS.Architecture = process.arch,
): DesktopReleaseCandidate | null {
  const allowPrereleases = currentVersion.includes('-');
  const candidates = releases
    .filter((release) => !release.draft && (allowPrereleases || !release.prerelease))
    .map((release) => {
      const version = release.tag_name.replace(/^v/i, '').trim();
      return {
        release,
        version,
      };
    })
    .filter((candidate) => candidate.version.length > 0)
    .sort((left, right) => compareVersions(right.version, left.version));

  const latest = candidates[0];
  if (!latest || compareVersions(latest.version, currentVersion) <= 0) {
    return null;
  }

  const asset = selectReleaseDownloadAsset(latest.release.assets, targetPlatform, targetArch);
  return {
    version: latest.version,
    releaseUrl: latest.release.html_url,
    downloadUrl: asset?.browser_download_url ?? null,
    downloadName: asset?.name ?? null,
  };
}

export async function fetchLatestReleaseCandidate(options: {
  currentVersion: string;
  targetPlatform?: NodeJS.Platform;
  targetArch?: NodeJS.Architecture;
  fetchImpl?: typeof fetch;
}): Promise<DesktopReleaseCandidate | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl('https://api.github.com/repos/patleeman/personal-agent/releases?per_page=12', {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'personal-agent-desktop-updater',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub release check failed: ${response.status} ${response.statusText}`.trim());
  }

  const releases = await response.json() as GitHubReleaseRecord[];
  return selectLatestReleaseCandidate(
    Array.isArray(releases) ? releases : [],
    options.currentVersion,
    options.targetPlatform,
    options.targetArch,
  );
}
