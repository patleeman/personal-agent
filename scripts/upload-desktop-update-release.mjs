#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf-8'));
const version = packageJson.version;
const releaseDir = resolve(repoRoot, 'dist', 'release');
const uploadScript = resolve(repoRoot, 'scripts', 'upload-protected-downloads.mjs');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function findArtifact(pattern, label) {
  const match = readdirSync(releaseDir).find((name) => pattern.test(name));
  if (!match) {
    fail(`Missing ${label} in ${releaseDir}`);
  }
  return resolve(releaseDir, match);
}

function runUpload(prefix, files) {
  const result = spawnSync('node', [uploadScript, '--prefix', prefix, ...files], {
    cwd: repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(releaseDir)) {
  fail(`Missing release output directory: ${releaseDir}`);
}

const zip = findArtifact(new RegExp(`-${version}-mac-arm64\\.zip$`, 'i'), 'mac zip artifact');
const dmg = findArtifact(new RegExp(`-${version}-mac-arm64\\.dmg$`, 'i'), 'mac dmg artifact');
const zipBlockmap = `${zip}.blockmap`;
const latestMacYml = resolve(releaseDir, 'latest-mac.yml');

for (const requiredPath of [zipBlockmap, latestMacYml]) {
  if (!existsSync(requiredPath)) {
    fail(`Missing auto-update artifact: ${requiredPath}`);
  }
}

runUpload(`releases/v${version}`, [dmg, zip, zipBlockmap, latestMacYml]);
runUpload('updates/stable', [dmg, zip, zipBlockmap, latestMacYml]);

console.log(`Uploaded Personal Agent ${version} release artifacts to the protected bucket.`);
console.log(`Archive prefix: releases/v${version}`);
console.log('Updater prefix: updates/stable');
