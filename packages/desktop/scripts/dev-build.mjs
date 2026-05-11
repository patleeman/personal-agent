#!/usr/bin/env node
/* eslint-env node */
// Dev build: run deps then tsc, accepting non-zero exit from tsc
// since the esbuild/vite outputs are produced regardless.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = resolve(fileURLToPath(import.meta.url), '..');
const packageDir = resolve(currentDir, '..');

function run(...args) {
  try {
    execFileSync('npm', args, { cwd: packageDir, stdio: 'inherit' });
  } catch (e) {
    // non-fatal
  }
}

// clean
run('run', 'clean');

// build deps (vite UI, esbuild server, system extensions)
execFileSync('npm', ['run', 'build:deps'], { cwd: packageDir, stdio: 'inherit' });

// tsc for Electron main process and declarations
// Accept non-zero exit — dist files are still generated
try {
  execFileSync('npx', ['tsc', '--build', '--force'], { cwd: packageDir, stdio: 'inherit' });
} catch {
  // tsc errors are non-fatal for dev
}
