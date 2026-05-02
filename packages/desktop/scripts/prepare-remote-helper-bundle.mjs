#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(currentDir, '..');
const helperDir = resolve(packageDir, 'remote-helper');
const vendorRoot = resolve(packageDir, 'vendor', 'remote-helper');
const packageVersion = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf-8')).version;

const TARGETS = [
  { key: 'darwin-arm64', goos: 'darwin', goarch: 'arm64', binary: 'pa-ssh-remote-helper' },
  { key: 'darwin-x64', goos: 'darwin', goarch: 'amd64', binary: 'pa-ssh-remote-helper' },
  { key: 'linux-arm64', goos: 'linux', goarch: 'arm64', binary: 'pa-ssh-remote-helper' },
  { key: 'linux-x64', goos: 'linux', goarch: 'amd64', binary: 'pa-ssh-remote-helper' },
];

function runGoBuild(target) {
  const targetDir = join(vendorRoot, target.key);
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  const outputPath = join(targetDir, target.binary);

  const result = spawnSync('go', ['build', '-trimpath', '-ldflags', '-s -w', '-o', outputPath, '.'], {
    cwd: helperDir,
    env: {
      ...process.env,
      GOOS: target.goos,
      GOARCH: target.goarch,
      CGO_ENABLED: '0',
    },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const rendered = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    throw new Error(rendered || `go build failed for ${target.key}`);
  }

  chmodSync(outputPath, 0o755);
  writeFileSync(join(targetDir, 'VERSION'), `${packageVersion}\n`, 'utf-8');
}

for (const target of TARGETS) {
  console.log(`Building remote helper for ${target.key}…`);
  runGoBuild(target);
}

console.log(`Built ${TARGETS.length} remote helper targets in ${vendorRoot}`);
