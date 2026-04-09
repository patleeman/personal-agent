#!/usr/bin/env node

import { basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';

const repoRoot = process.cwd();
const workerConfigPath = resolve(repoRoot, 'tools/cloudflare-download-gate/wrangler.toml');
const defaultBucket = process.env.PERSONAL_AGENT_DOWNLOAD_BUCKET ?? 'personal-agent-downloads';
const defaultPrefix = process.env.PERSONAL_AGENT_DOWNLOAD_PREFIX ?? '';
const baseUrl = process.env.PERSONAL_AGENT_DOWNLOAD_BASE_URL ?? '';

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    encoding: 'utf8',
    env: process.env,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function detectContentType(filePath) {
  if (filePath.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (filePath.endsWith('.zip')) return 'application/zip';
  if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) return 'text/yaml; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.blockmap')) return 'application/octet-stream';
  return 'application/octet-stream';
}

const args = process.argv.slice(2);
let prefix = defaultPrefix;
const fileArgs = [];

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--prefix') {
    prefix = args[i + 1] ?? '';
    i += 1;
    continue;
  }
  fileArgs.push(arg);
}

if (!existsSync(workerConfigPath)) {
  fail(`Missing Worker config at ${workerConfigPath}`);
}

if (fileArgs.length === 0) {
  fail('Usage: npm run downloads:upload -- [--prefix releases/v0.1.3/] <file> [more files...]');
}

const normalizedPrefix = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix;

for (const input of fileArgs) {
  const filePath = resolve(repoRoot, input);
  if (!existsSync(filePath)) {
    fail(`Missing file: ${input}`);
  }
  if (!statSync(filePath).isFile()) {
    fail(`Not a file: ${input}`);
  }

  const key = `${normalizedPrefix}${basename(filePath)}`;
  console.log(`Uploading ${input} -> r2://${defaultBucket}/${key}`);
  run('wrangler', [
    'r2',
    'object',
    'put',
    `${defaultBucket}/${key}`,
    '--remote',
    '--file',
    filePath,
    '--content-type',
    detectContentType(filePath),
  ]);

  if (baseUrl) {
    console.log(`Protected URL: ${baseUrl.replace(/\/$/, '')}/${key}`);
  }
}
