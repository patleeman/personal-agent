#!/usr/bin/env node
/* eslint-env node */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const labsRoot = resolve(repoRoot, 'experimental-extensions');
const extensionId = readFlag('--extension') ?? process.argv[2];
const target = readFlag('--target') ?? 'testing';

if (!extensionId) fail('Usage: npm run install -- --extension <extension-id> [--target testing|production|/custom/state/root]');

const extensionRoot = resolve(labsRoot, 'extensions', extensionId);
if (!existsSync(resolve(extensionRoot, 'extension.json'))) fail(`No extension found at ${extensionRoot}`);

const stateRoot = resolveTargetStateRoot(target);
const destination = resolve(stateRoot, 'extensions', extensionId);
rmSync(destination, { recursive: true, force: true });
cpSync(extensionRoot, destination, { recursive: true });
console.log(`Installed ${extensionId} to ${destination}`);

function resolveTargetStateRoot(value) {
  if (value === 'testing') return resolve(homedir(), '.local/state/personal-agent-testing');
  if (value === 'production' || value === 'prod') return resolve(homedir(), '.local/state/personal-agent');
  return resolve(value);
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
