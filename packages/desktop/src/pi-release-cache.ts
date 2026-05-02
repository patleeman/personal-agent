import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDesktopAboutVersionsForPaths } from './about.js';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import type { RemotePlatformInfo } from './remote-platform.js';

const PI_RELEASE_OWNER = 'badlogic';
const PI_RELEASE_REPO = 'pi-mono';

function readInstalledPiVersion(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const version = resolveDesktopAboutVersionsForPaths(currentDir).piVersion.trim();
  if (!version || version === 'Unknown') {
    throw new Error('Could not resolve the installed Pi version.');
  }

  return version;
}

function renderPiReleaseAssetName(platform: RemotePlatformInfo): string {
  if (platform.os === 'darwin' && platform.arch === 'arm64') {
    return 'pi-darwin-arm64.tar.gz';
  }
  if (platform.os === 'darwin' && platform.arch === 'x64') {
    return 'pi-darwin-x64.tar.gz';
  }
  if (platform.os === 'linux' && platform.arch === 'arm64') {
    return 'pi-linux-arm64.tar.gz';
  }
  if (platform.os === 'linux' && platform.arch === 'x64') {
    return 'pi-linux-x64.tar.gz';
  }

  throw new Error(`Unsupported Pi release platform: ${platform.key}`);
}

function run(command: string, args: string[], cwd?: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const rendered = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(rendered || `${command} ${args.join(' ')} failed`);
  }
}

async function downloadRelease(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'personal-agent-desktop',
      Accept: 'application/octet-stream',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  writeFileSync(outputPath, Buffer.from(await response.arrayBuffer()));
}

function resolveCacheRoot(): string {
  const runtime = resolveDesktopRuntimePaths();
  const cacheRoot = resolve(runtime.desktopStateDir, 'cache', 'pi-release');
  mkdirSync(cacheRoot, { recursive: true, mode: 0o700 });
  return cacheRoot;
}

function resolveArchivePath(version: string, assetName: string): string {
  const cacheRoot = resolveCacheRoot();
  const versionDir = resolve(cacheRoot, version);
  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  return resolve(versionDir, assetName);
}

function resolveExtractedBundleDir(version: string, platform: RemotePlatformInfo): string {
  const cacheRoot = resolveCacheRoot();
  const versionDir = resolve(cacheRoot, version, platform.key);
  mkdirSync(versionDir, { recursive: true, mode: 0o700 });
  return versionDir;
}

function resolveExtractedBinaryPath(version: string, platform: RemotePlatformInfo): string {
  return resolve(resolveExtractedBundleDir(version, platform), 'pi');
}

function findExtractedPiBundleDir(extractDir: string): string | null {
  const queue = [extractDir];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir || seen.has(currentDir)) {
      continue;
    }
    seen.add(currentDir);

    const entries = readdirSync(currentDir, { withFileTypes: true });
    if (entries.some((entry) => entry.isFile() && entry.name === 'pi')) {
      return currentDir;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      queue.push(resolve(currentDir, entry.name));
    }
  }

  return null;
}

export async function ensurePiReleaseBinary(
  platform: RemotePlatformInfo,
  onProgress?: (event: { phase: 'checking-cache' | 'downloading' | 'extracting'; version: string; assetName: string }) => void,
): Promise<{ version: string; path: string; assetName: string }> {
  const version = readInstalledPiVersion();
  const assetName = renderPiReleaseAssetName(platform);
  const bundleDir = resolveExtractedBundleDir(version, platform);
  const binaryPath = resolveExtractedBinaryPath(version, platform);
  const packageJsonPath = resolve(bundleDir, 'package.json');
  onProgress?.({ phase: 'checking-cache', version, assetName });
  if (existsSync(binaryPath) && statSync(binaryPath).isFile() && existsSync(packageJsonPath)) {
    return { version, path: binaryPath, assetName };
  }
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true, mode: 0o700 });

  const archivePath = resolveArchivePath(version, assetName);
  if (!existsSync(archivePath)) {
    const url = `https://github.com/${PI_RELEASE_OWNER}/${PI_RELEASE_REPO}/releases/download/v${version}/${assetName}`;
    onProgress?.({ phase: 'downloading', version, assetName });
    await downloadRelease(url, archivePath);
  }

  onProgress?.({ phase: 'extracting', version, assetName });
  const extractDir = mkdtempSync(join(tmpdir(), `personal-agent-pi-release-${platform.key}-`));
  try {
    run('tar', ['-xzf', archivePath, '-C', extractDir]);
    const extractedBundleDir = findExtractedPiBundleDir(extractDir);
    if (!extractedBundleDir) {
      throw new Error(`Pi release archive ${assetName} did not contain a pi binary.`);
    }
    for (const entry of readdirSync(extractedBundleDir, { withFileTypes: true })) {
      cpSync(resolve(extractedBundleDir, entry.name), resolve(bundleDir, entry.name), { recursive: true });
    }
    chmodSync(binaryPath, 0o755);
    return { version, path: binaryPath, assetName };
  } finally {
    rmSync(extractDir, { recursive: true, force: true });
  }
}
