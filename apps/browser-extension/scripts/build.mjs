#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDir, '..');
const repoRoot = resolve(appRoot, '..', '..');
const sourceDir = join(appRoot, 'src');
const distDir = join(appRoot, 'dist');
const releaseDir = join(distDir, 'release');
const iconSourcePath = join(repoRoot, 'packages', 'desktop', 'assets', 'icon.png');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const rawVersion = String(packageJson.version ?? '').trim();
const manifestVersion = rawVersion.split('-')[0] || '0.0.0';
const shouldCreateReleaseArchives = process.argv.includes('--release');
const iconSizes = [16, 32, 48, 128];

if (!rawVersion) {
  throw new Error('Root package.json is missing a version string.');
}

if (!existsSync(iconSourcePath)) {
  throw new Error(`Desktop app icon not found: ${iconSourcePath}`);
}

const variants = [
  {
    id: 'chrome',
    installReadme: `# Personal Agent browser extension (Chrome / Chromium)

This bundle is meant for manual unpacked installation.

## Install

1. Unzip this bundle somewhere stable on disk.
2. Open \`chrome://extensions\`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the unzipped folder that contains \`manifest.json\`.

## First-time setup

1. In Personal Agent, open **Settings → Companion Access**.
2. Generate a setup URL or pairing code.
3. Open the extension **Options** page.
4. Paste the setup URL, or enter the base URL and pairing code.
5. Optionally set a default vault folder such as \`Inbox\`.

## What it does

- save the current page URL from the popup
- save page URLs from the toolbar shortcut
- save page or link URLs from the right-click context menu
- send captures through the Personal Agent companion API so the host imports them into the knowledge base vault
`,
  },
  {
    id: 'firefox',
    browserSpecificSettings: {
      gecko: {
        id: 'browser-extension@personal-agent.local',
      },
    },
    installReadme: `# Personal Agent browser extension (Firefox)

This bundle is meant for manual temporary installation.

## Install

1. Unzip this bundle somewhere stable on disk.
2. Open \`about:debugging#/runtime/this-firefox\`.
3. Click **Load Temporary Add-on…**.
4. Select the \`manifest.json\` file inside the unzipped folder.

## Important note

This Firefox bundle is **not Mozilla-signed**. On stable Firefox, that means it is mainly useful as a temporary developer-style install. If you want a permanent install path later, add AMO signing to the release flow.

## First-time setup

1. In Personal Agent, open **Settings → Companion Access**.
2. Generate a setup URL or pairing code.
3. Open the extension **Options** page.
4. Paste the setup URL, or enter the base URL and pairing code.
5. Optionally set a default vault folder such as \`Inbox\`.
`,
  },
];

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sanitizeManifestVersion(version) {
  const numeric = version.trim().split('-')[0] || '0.0.0';
  const parts = numeric.split('.').filter((part) => part.length > 0);
  while (parts.length < 3) {
    parts.push('0');
  }
  return parts.slice(0, 4).join('.');
}

function buildManifest(variant) {
  const manifest = {
    manifest_version: 3,
    name: 'Personal Agent URL Saver',
    description: 'Save page and link URLs into a Personal Agent knowledge base through the companion API.',
    version: sanitizeManifestVersion(manifestVersion),
    ...(rawVersion !== manifestVersion ? { version_name: rawVersion } : {}),
    icons: Object.fromEntries(iconSizes.map((size) => [String(size), `icons/icon-${String(size)}.png`])),
    action: {
      default_title: 'Save to Personal Agent',
      default_popup: 'popup.html',
    },
    background: {
      service_worker: 'background.js',
    },
    options_page: 'options.html',
    permissions: ['storage', 'tabs', 'contextMenus', 'notifications'],
    host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      'save-current-page': {
        suggested_key: {
          default: 'Alt+Shift+P',
          mac: 'Alt+Shift+P',
        },
        description: 'Save the current page URL to Personal Agent',
      },
    },
    ...(variant.browserSpecificSettings ? { browser_specific_settings: variant.browserSpecificSettings } : {}),
  };

  return manifest;
}

function buildVariant(variant) {
  const outDir = join(distDir, variant.id);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(sourceDir, outDir, { recursive: true });

  const iconsDir = join(outDir, 'icons');
  mkdirSync(iconsDir, { recursive: true });
  for (const size of iconSizes) {
    copyFileSync(iconSourcePath, join(iconsDir, `icon-${String(size)}.png`));
  }

  writeJson(join(outDir, 'manifest.json'), buildManifest(variant));
  writeFileSync(join(outDir, 'README.md'), variant.installReadme);
  return outDir;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${String(result.status ?? 1)}.`);
  }
}

function createArchive(directoryPath, archivePath) {
  run('zip', ['-qr', archivePath, '.'], { cwd: directoryPath });
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const builtVariants = variants.map((variant) => ({
  id: variant.id,
  outDir: buildVariant(variant),
}));

if (shouldCreateReleaseArchives) {
  mkdirSync(releaseDir, { recursive: true });
  for (const variant of builtVariants) {
    const archiveName = `Personal-Agent-Browser-Extension-${rawVersion}-${variant.id}-unpacked.zip`;
    createArchive(variant.outDir, join(releaseDir, archiveName));
  }
}

console.log(`Built Personal Agent browser extension bundles (${builtVariants.map((variant) => variant.id).join(', ')}).`);
if (shouldCreateReleaseArchives) {
  console.log(`Wrote release archives to ${releaseDir}`);
}
