#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const repoRoot = resolve(packageDir, '..', '..');
const vendorRoot = resolve(packageDir, 'vendor', 'difftastic');
const VERSION = '0.68.0';

const PLATFORM_ASSETS = {
  'darwin-arm64': {
    archiveName: 'difft-aarch64-apple-darwin.tar.gz',
    sha256: '35df7904af1c1aec9570f08e1a7825301ee317f3131b6b4edbf3f6d8d209cd8c',
    executableName: 'difft',
  },
  'darwin-x64': {
    archiveName: 'difft-x86_64-apple-darwin.tar.gz',
    sha256: '9c727343fd0fc0504cb004b6619358e5446324e09562fb8e39d66bc82e680070',
    executableName: 'difft',
  },
  'linux-arm64': {
    archiveName: 'difft-aarch64-unknown-linux-gnu.tar.gz',
    sha256: 'faadfb3a88c194033449092fad3a86f1179738a0b3bfc44580c83473bdb17451',
    executableName: 'difft',
  },
  'linux-x64': {
    archiveName: 'difft-x86_64-unknown-linux-gnu.tar.gz',
    sha256: 'f50c2d77f44a551fe24a7abfa955fbb893e6d0ab2a3767f39ca3823f0995dabd',
    executableName: 'difft',
  },
  'win32-arm64': {
    archiveName: 'difft-aarch64-pc-windows-msvc.zip',
    sha256: 'ca0e6070f7997c92bdab03c882104f84a4c6df27e8464afba37e5096872b2762',
    executableName: 'difft.exe',
  },
  'win32-x64': {
    archiveName: 'difft-x86_64-pc-windows-msvc.zip',
    sha256: 'a87429ebc75343c9731debfd083b954bbd1e87011f962078b9ade92e33440348',
    executableName: 'difft.exe',
  },
};

function resolvePlatformKey() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return 'darwin-arm64';
  }
  if (process.platform === 'darwin' && process.arch === 'x64') {
    return 'darwin-x64';
  }
  if (process.platform === 'linux' && process.arch === 'arm64') {
    return 'linux-arm64';
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return 'linux-x64';
  }
  if (process.platform === 'win32' && process.arch === 'arm64') {
    return 'win32-arm64';
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return 'win32-x64';
  }

  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
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

function sha256File(path) {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'personal-agent-build',
      Accept: 'application/octet-stream',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, bytes);
}

async function main() {
  const platformKey = resolvePlatformKey();
  if (!platformKey) {
    console.log(`Skipping difftastic bundle: unsupported platform ${process.platform}/${process.arch}`);
    return;
  }

  const asset = PLATFORM_ASSETS[platformKey];
  if (!asset) {
    console.log(`Skipping difftastic bundle: no asset configured for ${platformKey}`);
    return;
  }

  const platformDir = join(vendorRoot, platformKey);
  const versionFile = join(platformDir, 'VERSION');
  const executablePath = join(platformDir, asset.executableName);
  if (existsSync(executablePath) && existsSync(versionFile) && readFileSync(versionFile, 'utf-8').trim() === VERSION) {
    console.log(`Using bundled difftastic ${VERSION} for ${platformKey}`);
    return;
  }

  mkdirSync(vendorRoot, { recursive: true });
  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });

  const archivePath = join(tmpdir(), `personal-agent-difftastic-${platformKey}-${Date.now()}-${asset.archiveName}`);
  const downloadUrl = `https://github.com/Wilfred/difftastic/releases/download/${VERSION}/${asset.archiveName}`;
  console.log(`Downloading difftastic ${VERSION} for ${platformKey}…`);
  await downloadFile(downloadUrl, archivePath);

  const digest = sha256File(archivePath);
  if (digest !== asset.sha256) {
    throw new Error(`Checksum mismatch for ${asset.archiveName}. Expected ${asset.sha256}, got ${digest}.`);
  }

  if (asset.archiveName.endsWith('.tar.gz')) {
    run('tar', ['-xzf', archivePath, '-C', platformDir]);
  } else if (asset.archiveName.endsWith('.zip')) {
    run('unzip', ['-o', archivePath, '-d', platformDir]);
  } else {
    throw new Error(`Unsupported difftastic archive format: ${asset.archiveName}`);
  }

  if (!existsSync(executablePath)) {
    throw new Error(`Expected difftastic binary at ${executablePath} after extraction.`);
  }

  if (process.platform !== 'win32') {
    chmodSync(executablePath, 0o755);
  }
  writeFileSync(versionFile, `${VERSION}\n`);
  console.log(`Bundled difftastic ${VERSION} at ${executablePath}`);
}

await main();
