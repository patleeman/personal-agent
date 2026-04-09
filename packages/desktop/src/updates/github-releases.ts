import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const GITHUB_REPO_SLUG = 'patleeman/personal-agent';
const GITHUB_RELEASES_API_PATH = `repos/${GITHUB_REPO_SLUG}/releases?per_page=12`;
const GITHUB_RELEASES_API_URL = `https://api.github.com/${GITHUB_RELEASES_API_PATH}`;
const GITHUB_CLI_TIMEOUT_MS = 15_000;
const GITHUB_CLI_MAX_BUFFER_BYTES = 4 * 1024 * 1024;

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

export type DesktopReleaseSource = 'github-api' | 'github-cli';

export interface DesktopReleaseCandidate {
  tagName: string;
  version: string;
  releaseUrl: string;
  downloadUrl: string | null;
  downloadName: string | null;
  source: DesktopReleaseSource;
}

export interface GitHubCliReleasesResult {
  command: string;
  releases: GitHubReleaseRecord[];
}

export interface GitHubCliCommandResult {
  command: string;
  stdout: string;
  stderr: string;
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
  source: DesktopReleaseSource = 'github-api',
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
    tagName: latest.release.tag_name,
    version: latest.version,
    releaseUrl: latest.release.html_url,
    downloadUrl: asset?.browser_download_url ?? null,
    downloadName: asset?.name ?? null,
    source,
  };
}

function resolveGitHubCliCommandCandidates(): string[] {
  const explicit = process.env.PERSONAL_AGENT_GH_BIN;
  const candidates = [
    explicit,
    'gh',
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    '/opt/local/bin/gh',
  ]
    .filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0)
    .map((candidate) => candidate.trim());

  return [...new Set(candidates)];
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ').trim();
}

function extractExecErrorMessage(error: unknown): string {
  const execError = error as NodeJS.ErrnoException & {
    stdout?: string | Buffer;
    stderr?: string | Buffer;
    code?: string | number;
  };

  const stderr = typeof execError.stderr === 'string'
    ? execError.stderr.trim()
    : Buffer.isBuffer(execError.stderr)
      ? execError.stderr.toString('utf-8').trim()
      : '';
  if (stderr) {
    return stderr;
  }

  const stdout = typeof execError.stdout === 'string'
    ? execError.stdout.trim()
    : Buffer.isBuffer(execError.stdout)
      ? execError.stdout.toString('utf-8').trim()
      : '';
  if (stdout) {
    return stdout;
  }

  return execError.message || 'Command failed';
}

function execFileText(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveExec, rejectExec) => {
    execFile(command, args, {
      encoding: 'utf-8',
      timeout: GITHUB_CLI_TIMEOUT_MS,
      maxBuffer: GITHUB_CLI_MAX_BUFFER_BYTES,
    }, (error, stdout, stderr) => {
      if (error) {
        const execError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
        execError.stdout = stdout;
        execError.stderr = stderr;
        rejectExec(execError);
        return;
      }

      resolveExec({
        stdout: typeof stdout === 'string' ? stdout : '',
        stderr: typeof stderr === 'string' ? stderr : '',
      });
    });
  });
}

async function runGitHubCliCommand(args: string[]): Promise<GitHubCliCommandResult> {
  const commands = resolveGitHubCliCommandCandidates();

  for (const command of commands) {
    try {
      const result = await execFileText(command, args);
      return {
        command,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } catch (error) {
      const execError = error as NodeJS.ErrnoException & { code?: string | number };
      if (execError.code === 'ENOENT') {
        continue;
      }

      throw new Error(`Failed to run \`${formatCommand(command, args)}\`: ${extractExecErrorMessage(error)}`);
    }
  }

  throw new Error('Could not run `gh`. Install GitHub CLI and authenticate with `gh auth login` to check for updates for this private repo.');
}

async function fetchGitHubCliReleases(): Promise<GitHubCliReleasesResult> {
  const result = await runGitHubCliCommand([
    'api',
    GITHUB_RELEASES_API_PATH,
    '-H',
    'Accept: application/vnd.github+json',
  ]);

  let releases: unknown;
  try {
    releases = JSON.parse(result.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`GitHub CLI returned invalid release JSON: ${message}`);
  }

  return {
    command: result.command,
    releases: Array.isArray(releases) ? releases as GitHubReleaseRecord[] : [],
  };
}

function formatReleaseFetchError(ghError: string | null, publicError: string | null): string {
  if (publicError?.includes('404') && ghError) {
    return [
      'This private GitHub repo requires GitHub CLI auth for in-app update checks.',
      'Install GitHub CLI and run `gh auth login` on this machine, then try again.',
      '',
      `GitHub CLI: ${ghError}`,
      `Public GitHub API: ${publicError}`,
    ].join('\n');
  }

  if (ghError && publicError) {
    return [
      ghError,
      publicError,
    ].join('\n\n');
  }

  return ghError ?? publicError ?? 'GitHub release check failed';
}

export async function fetchLatestReleaseCandidate(options: {
  currentVersion: string;
  targetPlatform?: NodeJS.Platform;
  targetArch?: NodeJS.Architecture;
  fetchImpl?: typeof fetch;
  fetchGitHubCliReleasesImpl?: () => Promise<GitHubCliReleasesResult>;
  preferGitHubCli?: boolean;
}): Promise<DesktopReleaseCandidate | null> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const fetchGitHubCliReleasesImpl = options.fetchGitHubCliReleasesImpl ?? fetchGitHubCliReleases;
  const preferGitHubCli = options.preferGitHubCli ?? true;
  let ghError: string | null = null;

  if (preferGitHubCli) {
    try {
      const ghResult = await fetchGitHubCliReleasesImpl();
      return selectLatestReleaseCandidate(
        ghResult.releases,
        options.currentVersion,
        options.targetPlatform,
        options.targetArch,
        'github-cli',
      );
    } catch (error) {
      ghError = error instanceof Error ? error.message : String(error);
    }
  }

  let publicError: string | null = null;
  try {
    const response = await fetchImpl(GITHUB_RELEASES_API_URL, {
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
      'github-api',
    );
  } catch (error) {
    publicError = error instanceof Error ? error.message : String(error);
  }

  throw new Error(formatReleaseFetchError(ghError, publicError));
}

export async function downloadReleaseAssetWithGitHubCli(options: {
  tagName: string;
  assetName: string;
  outputDir: string;
  runGitHubCliCommandImpl?: (args: string[]) => Promise<GitHubCliCommandResult>;
}): Promise<{ command: string; filePath: string }> {
  const runGitHubCliCommandImpl = options.runGitHubCliCommandImpl ?? runGitHubCliCommand;
  const outputDir = resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const result = await runGitHubCliCommandImpl([
    'release',
    'download',
    options.tagName.trim(),
    '--repo',
    GITHUB_REPO_SLUG,
    '--pattern',
    options.assetName.trim(),
    '--dir',
    outputDir,
    '--clobber',
  ]);

  return {
    command: result.command,
    filePath: join(outputDir, options.assetName.trim()),
  };
}
