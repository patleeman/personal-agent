#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const packageJsonPath = resolve(repoRoot, 'package.json');
const releaseDir = resolve(repoRoot, 'dist', 'release');
const defaultEnvPath = resolve(homedir(), 'workingdir', 'familiar', '.env');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: 'inherit',
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const rendered = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
    fail(rendered || `${command} ${args.join(' ')} failed`);
  }

  return (result.stdout ?? '').trim();
}

function tryCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseEnvFile(content) {
  const parsed = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const separatorIndex = normalized.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadReleaseEnv() {
  const env = { ...process.env };
  const envPath = process.env.PERSONAL_AGENT_RELEASE_ENV ?? defaultEnvPath;

  if (existsSync(envPath)) {
    const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!env[key]) {
        env[key] = value;
      }
    }
    console.log(`Loaded release env defaults from ${envPath}`);
  }

  if (!env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_PASSWORD) {
    env.APPLE_APP_SPECIFIC_PASSWORD = env.APPLE_PASSWORD;
  }

  return env;
}

function ensureCleanRepo() {
  const status = capture('git', ['status', '--short']);
  if (status) {
    fail('Release publishing requires a clean working tree. Commit or stash other changes first.');
  }
}

function ensureTagAtHead(tag) {
  const tags = capture('git', ['tag', '--points-at', 'HEAD'])
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!tags.includes(tag)) {
    fail(`HEAD is not tagged with ${tag}. Run npm run release:patch|minor|major first.`);
  }
}

function normalizeCscName(value) {
  return value.replace(/^Developer ID Application:\s*/u, '').trim();
}

function ensureSigningIdentity(env) {
  if (env.CSC_NAME) {
    env.CSC_NAME = normalizeCscName(env.CSC_NAME);
    console.log(`Using CSC_NAME from environment: ${env.CSC_NAME}`);
    return env.CSC_NAME;
  }

  const identitiesOutput = capture('security', ['find-identity', '-v', '-p', 'codesigning']);
  const matches = [...identitiesOutput.matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((name) => name.startsWith('Developer ID Application: '));
  const identities = [...new Set(matches)];

  if (identities.length === 0) {
    fail('No Developer ID Application certificate found in the local keychain.');
  }

  if (identities.length > 1) {
    fail(`Multiple Developer ID Application certificates found (${identities.join(', ')}). Set CSC_NAME explicitly before publishing.`);
  }

  env.CSC_NAME = normalizeCscName(identities[0]);
  console.log(`Using local signing identity: ${env.CSC_NAME}`);
  return env.CSC_NAME;
}

function ensureNotarizationCredentials(env) {
  const hasAppleIdCredentials = Boolean(env.APPLE_ID && env.APPLE_TEAM_ID && env.APPLE_APP_SPECIFIC_PASSWORD);
  const hasApiKeyCredentials = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID);
  const hasKeychainProfile = Boolean(env.APPLE_KEYCHAIN_PROFILE);

  if (hasAppleIdCredentials || hasApiKeyCredentials || hasKeychainProfile) {
    return;
  }

  fail('Missing notarization credentials. Provide APPLE_ID + APPLE_TEAM_ID + APPLE_APP_SPECIFIC_PASSWORD (APPLE_PASSWORD is also accepted as a fallback), APPLE_API_KEY + APPLE_API_KEY_ID, or APPLE_KEYCHAIN_PROFILE.');
}

function buildNotarytoolArgs(env) {
  if (env.APPLE_KEYCHAIN_PROFILE) {
    return ['--keychain-profile', env.APPLE_KEYCHAIN_PROFILE];
  }

  if (env.APPLE_API_KEY && env.APPLE_API_KEY_ID) {
    const args = ['--key', env.APPLE_API_KEY, '--key-id', env.APPLE_API_KEY_ID];
    if (env.APPLE_API_ISSUER) {
      args.push('--issuer', env.APPLE_API_ISSUER);
    }
    return args;
  }

  if (env.APPLE_ID && env.APPLE_TEAM_ID && env.APPLE_APP_SPECIFIC_PASSWORD) {
    return [
      '--apple-id', env.APPLE_ID,
      '--password', env.APPLE_APP_SPECIFIC_PASSWORD,
      '--team-id', env.APPLE_TEAM_ID,
    ];
  }

  fail('Unable to build notarytool arguments from the available notarization credentials.');
}

function ensureGhAuth() {
  run('gh', ['auth', 'status']);
}

function getDefaultRemoteBranch() {
  const value = capture('git', ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  return value.replace(/^refs\/remotes\/origin\//u, '');
}

function pushReleaseRef(tag) {
  const branch = tryCapture('git', ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (branch.status === 0) {
    run('git', ['push', '--follow-tags']);
    return;
  }

  const defaultBranch = getDefaultRemoteBranch();
  console.log(`Detached HEAD detected; pushing to origin/${defaultBranch} explicitly...`);
  run('git', ['push', 'origin', `HEAD:${defaultBranch}`]);
  run('git', ['push', 'origin', tag]);
}

function collectReleaseFiles(version) {
  if (!existsSync(releaseDir)) {
    fail(`Release output directory not found: ${releaseDir}`);
  }

  const files = readdirSync(releaseDir)
    .filter((name) => name.includes(`-${version}-`))
    .filter((name) => name.endsWith('.dmg') || name.endsWith('.zip'))
    .sort()
    .map((name) => resolve(releaseDir, name));

  if (files.length === 0) {
    fail(`No .dmg or .zip release artifacts found in ${releaseDir}`);
  }

  return files;
}

function collectPackagedAppPath() {
  const macOutputDir = resolve(releaseDir, 'mac-arm64');
  if (!existsSync(macOutputDir)) {
    return null;
  }

  const appName = readdirSync(macOutputDir)
    .find((name) => name.endsWith('.app'));

  return appName ? resolve(macOutputDir, appName) : null;
}

function stapleAndValidate(pathname) {
  run('xcrun', ['stapler', 'staple', pathname]);
  run('xcrun', ['stapler', 'validate', pathname]);
}

function notarizeDistributionContainers(env, files) {
  const appPath = collectPackagedAppPath();
  if (appPath) {
    console.log(`Stapling packaged app ${appPath}...`);
    stapleAndValidate(appPath);
  }

  const dmgFiles = files.filter((file) => file.endsWith('.dmg'));
  const notarytoolArgs = buildNotarytoolArgs(env);
  for (const dmgFile of dmgFiles) {
    console.log(`Submitting ${dmgFile} for DMG notarization...`);
    run('xcrun', ['notarytool', 'submit', dmgFile, ...notarytoolArgs, '--wait']);
    console.log(`Stapling notarized DMG ${dmgFile}...`);
    stapleAndValidate(dmgFile);
  }
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const tag = `v${version}`;
const env = loadReleaseEnv();

rmSync(releaseDir, { recursive: true, force: true });

ensureCleanRepo();
ensureTagAtHead(tag);
ensureSigningIdentity(env);
ensureNotarizationCredentials(env);
ensureGhAuth();

console.log(`Building signed desktop artifacts for ${tag}...`);
run('npm', ['run', 'desktop:dist'], { env });

const files = collectReleaseFiles(version);
notarizeDistributionContainers(env, files);

console.log(`Pushing ${tag} to GitHub...`);
pushReleaseRef(tag);

const releaseView = tryCapture('gh', ['release', 'view', tag, '--json', 'url']);
if (releaseView.status === 0) {
  console.log(`Updating existing GitHub release ${tag}...`);
  run('gh', ['release', 'upload', tag, ...files, '--clobber']);
} else if (`${releaseView.stderr}${releaseView.stdout}`.includes('release not found')) {
  console.log(`Creating GitHub release ${tag}...`);
  const args = ['release', 'create', tag, ...files, '--generate-notes'];
  if (version.includes('-')) {
    args.push('--prerelease');
  }
  run('gh', args);
} else {
  const rendered = `${releaseView.stderr}${releaseView.stdout}`.trim();
  fail(rendered || `Unable to inspect GitHub release ${tag}`);
}

const releaseUrl = capture('gh', ['release', 'view', tag, '--json', 'url', '--jq', '.url']);
console.log(`Published ${tag}: ${releaseUrl}`);
