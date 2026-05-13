/* eslint-env node */

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, '..', '..', '..');

const seed = spawnSync(process.execPath, [resolve(repoRoot, 'scripts', 'desktop-demo.mjs')], {
  cwd: repoRoot,
  encoding: 'utf-8',
  env: process.env,
});

if (seed.error) {
  throw seed.error;
}

if (seed.status !== 0) {
  process.stderr.write(seed.stderr || seed.stdout || 'Failed to seed desktop demo.\n');
  process.exit(seed.status ?? 1);
}

process.stdout.write(seed.stdout);
const envLine = seed.stdout.split('\n').find((line) => line.startsWith('Env file: '));
if (!envLine) {
  process.stderr.write('Could not find demo env file in seed output.\n');
  process.exit(1);
}

const envFile = envLine.slice('Env file: '.length).trim();
const launch = spawnSync('bash', ['-lc', `source ${JSON.stringify(envFile)} && pnpm run desktop:start -- --no-quit-confirmation`], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

if (launch.error) {
  throw launch.error;
}

process.exit(launch.status ?? 0);
