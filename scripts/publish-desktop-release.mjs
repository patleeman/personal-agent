#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const repoRoot = process.cwd();
const packageJsonPath = resolve(repoRoot, 'package.json');
const releaseDir = resolve(repoRoot, 'dist', 'release');
const browserExtensionReleaseDir = resolve(repoRoot, 'apps', 'browser-extension', 'dist', 'release');
const repoEnvPath = resolve(repoRoot, '.env');
const defaultEnvPath = resolve(homedir(), 'workingdir', 'familiar', '.env');
const defaultReleaseRepo = 'patleeman/personal-agent-releases';

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
  const envPaths = process.env.PERSONAL_AGENT_RELEASE_ENV
    ? [process.env.PERSONAL_AGENT_RELEASE_ENV]
    : [repoEnvPath, defaultEnvPath];

  for (const envPath of envPaths) {
    if (!envPath || !existsSync(envPath)) {
      continue;
    }

    const parsed = parseEnvFile(readFileSync(envPath, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (!env[key]) {
        env[key] = value;
      }
    }
    console.log(`Loaded release env defaults from ${envPath}`);
    break;
  }

  if (!env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_PASSWORD) {
    env.APPLE_APP_SPECIFIC_PASSWORD = env.APPLE_PASSWORD;
  }

  if (!env.PERSONAL_AGENT_RELEASE_REPO) {
    env.PERSONAL_AGENT_RELEASE_REPO = defaultReleaseRepo;
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

function ensureReleaseRepoExists(releaseRepo) {
  const repoView = tryCapture('gh', ['repo', 'view', releaseRepo, '--json', 'name,visibility,url']);
  if (repoView.status !== 0) {
    const rendered = `${repoView.stderr}${repoView.stdout}`.trim();
    fail(rendered || `Release repo ${releaseRepo} not found. Create it before publishing.`);
  }

  const details = JSON.parse(repoView.stdout || '{}');
  if (details.visibility !== 'PUBLIC') {
    fail(`Release repo ${releaseRepo} must be public for desktop auto-updates to work.`);
  }
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
    .filter((name) => (
      name === 'latest-mac.yml'
      || (name.includes(`-${version}-`) && (
        name.endsWith('.dmg')
        || name.endsWith('.zip')
        || name.endsWith('.blockmap')
      ))
    ))
    .sort()
    .map((name) => resolve(releaseDir, name));

  const hasLatestMac = files.some((file) => file.endsWith('/latest-mac.yml'));
  const hasZip = files.some((file) => file.endsWith('.zip'));
  if (!hasLatestMac || !hasZip) {
    fail(`Expected latest-mac.yml and at least one .zip artifact in ${releaseDir}`);
  }

  return files;
}

function collectBrowserExtensionReleaseFiles(version) {
  if (!existsSync(browserExtensionReleaseDir)) {
    fail(`Browser extension release output directory not found: ${browserExtensionReleaseDir}`);
  }

  const files = readdirSync(browserExtensionReleaseDir)
    .filter((name) => name.includes(`-${version}-`) && name.endsWith('.zip'))
    .sort()
    .map((name) => resolve(browserExtensionReleaseDir, name));

  if (files.length === 0) {
    fail(`Expected browser extension .zip artifacts in ${browserExtensionReleaseDir}`);
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

function validatePackagedAutoUpdateConfig(releaseRepo) {
  const appPath = collectPackagedAppPath();
  if (!appPath) {
    fail(`Packaged desktop app not found under ${releaseDir}; cannot validate auto-update feed config.`);
  }

  const appUpdatePath = resolve(appPath, 'Contents', 'Resources', 'app-update.yml');
  if (!existsSync(appUpdatePath)) {
    fail(`Packaged auto-update config not found: ${appUpdatePath}`);
  }

  const config = readFileSync(appUpdatePath, 'utf8');
  const owner = config.match(/^owner:\s*(.+)$/mu)?.[1]?.trim() ?? '';
  const repo = config.match(/^repo:\s*(.+)$/mu)?.[1]?.trim() ?? '';
  const [expectedOwner, expectedRepo] = releaseRepo.split('/', 2);

  if (owner !== expectedOwner || repo !== expectedRepo) {
    fail([
      'Packaged app-update.yml points at the wrong GitHub repo.',
      `Expected: ${releaseRepo}`,
      `Actual: ${owner}/${repo}`,
      `Path: ${appUpdatePath}`,
    ].join('\n'));
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stapleAndValidate(pathname, env, options = {}) {
  const attempts = options.attempts ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 15_000;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const staple = tryCapture('xcrun', ['stapler', 'staple', pathname], { env });
    if (staple.status === 0) {
      run('xcrun', ['stapler', 'validate', pathname], { env });
      return;
    }

    const rendered = `${staple.stderr ?? ''}${staple.stdout ?? ''}`.trim();
    const ticketPending = rendered.includes('Record not found') || rendered.includes('Could not find base64 encoded ticket');
    if (ticketPending && attempt < attempts) {
      console.log(`Stapler ticket for ${pathname} is not visible yet (attempt ${attempt}/${attempts}). Retrying in ${Math.round(retryDelayMs / 1000)}s...`);
      sleepMs(retryDelayMs);
      continue;
    }

    fail(rendered || `xcrun stapler staple ${pathname} failed`);
  }
}

function submitForNotarization(pathname, env, label, options = {}) {
  const notarytoolArgs = buildNotarytoolArgs(env);
  console.log(`Submitting ${label} ${pathname} for notarization...`);
  run('xcrun', ['notarytool', 'submit', pathname, ...notarytoolArgs, '--wait', ...(options.force ? ['--force'] : [])], { env });
}

function notarizeDistributionContainers(env, files) {
  const zipFiles = files.filter((file) => file.endsWith('.zip'));
  for (const zipFile of zipFiles) {
    submitForNotarization(zipFile, env, 'ZIP');
  }

  const dmgFiles = files.filter((file) => file.endsWith('.dmg'));
  for (const dmgFile of dmgFiles) {
    submitForNotarization(dmgFile, env, 'DMG');
    console.log(`Stapling notarized DMG ${dmgFile}...`);
    stapleAndValidate(dmgFile, env);
  }
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const tag = `v${version}`;
const env = loadReleaseEnv();
const releaseRepo = env.PERSONAL_AGENT_RELEASE_REPO;

rmSync(releaseDir, { recursive: true, force: true });

ensureCleanRepo();
ensureTagAtHead(tag);
ensureSigningIdentity(env);
ensureNotarizationCredentials(env);
ensureGhAuth();
ensureReleaseRepoExists(releaseRepo);

console.log(`Building signed desktop artifacts for ${tag}...`);
run('npm', ['run', 'desktop:dist'], { env });
validatePackagedAutoUpdateConfig(releaseRepo);

const files = collectReleaseFiles(version);
notarizeDistributionContainers(env, files);

console.log(`Building browser extension bundles for ${tag}...`);
run('npm', ['run', 'extension:dist'], { env });
const browserExtensionFiles = collectBrowserExtensionReleaseFiles(version);
const releaseAssets = [...files, ...browserExtensionFiles];

console.log(`Pushing ${tag} to GitHub...`);
pushReleaseRef(tag);

const releaseNotes = [
  `Signed desktop release artifacts for Personal Agent ${version}.`,
  '',
  'This repo intentionally only hosts release assets and update metadata.',
  'Source history stays in the private development repo.',
  'Supplemental browser extension bundles are attached for manual installation.',
].join('\n');

const releaseView = tryCapture('gh', ['release', 'view', tag, '--repo', releaseRepo, '--json', 'url']);
if (releaseView.status === 0) {
  console.log(`Updating existing GitHub release ${tag} in ${releaseRepo}...`);
  run('gh', ['release', 'edit', tag, '--repo', releaseRepo, '--title', `Personal Agent ${version}`, '--notes', releaseNotes]);
  run('gh', ['release', 'upload', tag, ...releaseAssets, '--repo', releaseRepo, '--clobber']);
} else if (`${releaseView.stderr}${releaseView.stdout}`.includes('release not found')) {
  console.log(`Creating GitHub release ${tag} in ${releaseRepo}...`);
  const args = ['release', 'create', tag, ...releaseAssets, '--repo', releaseRepo, '--title', `Personal Agent ${version}`, '--notes', releaseNotes];
  if (version.includes('-')) {
    args.push('--prerelease');
  }
  run('gh', args);
} else {
  const rendered = `${releaseView.stderr}${releaseView.stdout}`.trim();
  fail(rendered || `Unable to inspect GitHub release ${tag} in ${releaseRepo}`);
}

const releaseUrl = capture('gh', ['release', 'view', tag, '--repo', releaseRepo, '--json', 'url', '--jq', '.url']);
console.log(`Published ${tag} to ${releaseRepo}: ${releaseUrl}`);
