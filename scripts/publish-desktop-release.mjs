#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = process.cwd();
const packageJsonPath = resolve(repoRoot, 'package.json');
const repoEnvPath = resolve(repoRoot, '.env');
const defaultEnvPath = undefined;
const defaultReleaseRepo = 'patleeman/personal-agent';

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

function isTruthyEnv(value) {
  return ['1', 'true', 'yes'].includes(
    String(value ?? '')
      .trim()
      .toLowerCase(),
  );
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

function readJsonFile(pathname) {
  return JSON.parse(readFileSync(pathname, 'utf8'));
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
  const envPaths = process.env.PERSONAL_AGENT_RELEASE_ENV ? [process.env.PERSONAL_AGENT_RELEASE_ENV] : [repoEnvPath, defaultEnvPath];

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
    fail(`HEAD is not tagged with ${tag}. Run pnpm run release:patch|minor|major first.`);
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

  fail(
    'Missing notarization credentials. Provide APPLE_ID + APPLE_TEAM_ID + APPLE_APP_SPECIFIC_PASSWORD (APPLE_PASSWORD is also accepted as a fallback), APPLE_API_KEY + APPLE_API_KEY_ID, or APPLE_KEYCHAIN_PROFILE.',
  );
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
    return ['--apple-id', env.APPLE_ID, '--password', env.APPLE_APP_SPECIFIC_PASSWORD, '--team-id', env.APPLE_TEAM_ID];
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
    console.warn(`Warning: ${releaseRepo} is ${details.visibility}. Auto-updates will require a public repo or auth tokens.`);
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

function createCleanReleaseSnapshot(env) {
  const buildRoot = mkdtempSync(join(tmpdir(), 'personal-agent-release-'));
  process.on('exit', () => {
    rmSync(buildRoot, { recursive: true, force: true });
  });
  console.log(`Creating clean release snapshot in ${buildRoot}...`);
  run('bash', ['-lc', 'git archive --format=tar HEAD | tar -xf - -C "$PERSONAL_AGENT_RELEASE_BUILD_ROOT"'], {
    cwd: repoRoot,
    env: {
      ...env,
      PERSONAL_AGENT_RELEASE_BUILD_ROOT: buildRoot,
    },
  });

  console.log('Installing clean release snapshot dependencies with pnpm install --frozen-lockfile...');
  run('pnpm', ['install', '--frozen-lockfile'], {
    cwd: buildRoot,
    env,
  });

  return buildRoot;
}

function collectReleaseFiles(releaseDir, version) {
  if (!existsSync(releaseDir)) {
    fail(`Release output directory not found: ${releaseDir}`);
  }

  const files = readdirSync(releaseDir)
    .filter(
      (name) =>
        name === 'latest-mac.yml' ||
        (name.includes(`-${version}-`) && (name.endsWith('.dmg') || name.endsWith('.zip') || name.endsWith('.blockmap'))),
    )
    .sort()
    .map((name) => resolve(releaseDir, name));

  const hasLatestMac = files.some((file) => file.endsWith('/latest-mac.yml'));
  const hasZip = files.some((file) => file.endsWith('.zip'));
  if (!hasLatestMac || !hasZip) {
    fail(`Expected latest-mac.yml and at least one .zip artifact in ${releaseDir}`);
  }

  return files;
}

function collectPackagedAppPath(releaseDir) {
  const macOutputDir = resolve(releaseDir, 'mac-arm64');
  if (!existsSync(macOutputDir)) {
    return null;
  }

  const appName = readdirSync(macOutputDir).find((name) => name.endsWith('.app'));

  return appName ? resolve(macOutputDir, appName) : null;
}

function validatePackagedAutoUpdateConfig(releaseDir, releaseRepo) {
  const appPath = collectPackagedAppPath(releaseDir);
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
    fail(
      [
        'Packaged app-update.yml points at the wrong GitHub repo.',
        `Expected: ${releaseRepo}`,
        `Actual: ${owner}/${repo}`,
        `Path: ${appUpdatePath}`,
      ].join('\n'),
    );
  }
}

function listWorkspacePackageDirs(buildRoot) {
  const packagesDir = resolve(buildRoot, 'packages');
  const workspaceDirs = new Map();

  if (!existsSync(packagesDir)) {
    fail(`Workspace packages directory not found: ${packagesDir}`);
  }

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = resolve(packagesDir, entry.name);
    const packageJsonPath = resolve(packageDir, 'package.json');
    if (!existsSync(packageJsonPath)) {
      continue;
    }

    const packageJson = readJsonFile(packageJsonPath);
    if (typeof packageJson.name === 'string' && packageJson.name.trim().length > 0) {
      workspaceDirs.set(packageJson.name.trim(), packageDir);
    }
  }

  return workspaceDirs;
}

function resolveInstalledPackageDir(buildRoot, startDir, packageName) {
  const segments = packageName.split('/');
  let currentDir = resolve(startDir);
  const normalizedBuildRoot = resolve(buildRoot);

  while (true) {
    const candidate = resolve(currentDir, 'node_modules', ...segments);
    if (existsSync(resolve(candidate, 'package.json'))) {
      return candidate;
    }

    if (currentDir === normalizedBuildRoot) {
      break;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  // pnpm stores all packages at buildRoot/node_modules/ with symlinks to .pnpm/.
  // The upward walk from a symlink-resolved path may never reach this directory,
  // so check it explicitly as a fallback.
  const rootCandidate = resolve(normalizedBuildRoot, 'node_modules', ...segments);
  if (existsSync(resolve(rootCandidate, 'package.json'))) {
    return rootCandidate;
  }

  // Last resort: use a build-root-based require to resolve through pnpm's store.
  // The normal walk-based resolution can fail because pnpm's symlinks resolve
  // into .pnpm/ directly, bypassing the root node_modules/ directory.
  try {
    const buildRequire = createRequire(resolve(normalizedBuildRoot, 'package.json'));
    const resolved = buildRequire.resolve(packageName);
    if (existsSync(resolved)) {
      // Walk up from the resolved file until we find package.json
      let dir = dirname(resolved);
      while (dir !== normalizedBuildRoot && dir !== dirname(dir)) {
        const pkgJson = resolve(dir, 'package.json');
        if (existsSync(pkgJson)) {
          return dir;
        }
        dir = dirname(dir);
      }
    }
  } catch {
    // Not resolvable via Node's module resolution either
  }

  return null;
}

function collectExpectedRuntimePackages(buildRoot) {
  const workspaceDirs = listWorkspacePackageDirs(buildRoot);
  const visitedWorkspacePackages = new Set();
  const visitedExternalPackages = new Set();

  function visitWorkspacePackage(packageName) {
    if (visitedWorkspacePackages.has(packageName)) {
      return;
    }

    const packageDir = workspaceDirs.get(packageName);
    if (!packageDir) {
      fail(`Workspace package ${packageName} was not found under ${resolve(buildRoot, 'packages')}.`);
    }

    visitedWorkspacePackages.add(packageName);
    const packageJson = readJsonFile(resolve(packageDir, 'package.json'));
    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      if (workspaceDirs.has(dependencyName)) {
        visitWorkspacePackage(dependencyName);
      } else {
        visitExternalPackage(dependencyName, packageDir);
      }
    }
  }

  function visitExternalPackage(packageName, requesterDir) {
    if (visitedExternalPackages.has(packageName)) {
      return;
    }

    const packageDir = resolveInstalledPackageDir(buildRoot, requesterDir, packageName);
    if (!packageDir) {
      fail(`Could not resolve installed runtime dependency ${packageName} from ${requesterDir}.`);
    }

    visitedExternalPackages.add(packageName);
    const packageJson = readJsonFile(resolve(packageDir, 'package.json'));
    for (const dependencyName of Object.keys(packageJson.dependencies ?? {})) {
      if (workspaceDirs.has(dependencyName)) {
        visitWorkspacePackage(dependencyName);
      } else {
        visitExternalPackage(dependencyName, packageDir);
      }
    }
  }

  visitWorkspacePackage('@personal-agent/desktop');

  return [
    ...[...visitedWorkspacePackages].filter((packageName) => packageName !== '@personal-agent/desktop').sort(),
    ...[...visitedExternalPackages].sort(),
  ];
}

function hasPackagedNodeModule(packageName, packageEntries, resourcesDir) {
  const packageEntryPrefix = `/node_modules/${packageName}`;
  if (packageEntries.some((entry) => entry === packageEntryPrefix || entry.startsWith(`${packageEntryPrefix}/`))) {
    return true;
  }

  const packagePathSegments = packageName.split('/');
  return (
    existsSync(resolve(resourcesDir, 'node_modules', ...packagePathSegments, 'package.json')) ||
    existsSync(resolve(resourcesDir, 'app.asar.unpacked', 'node_modules', ...packagePathSegments, 'package.json'))
  );
}

function validatePackagedRuntimeDependencies(buildRoot, releaseDir) {
  const appPath = collectPackagedAppPath(releaseDir);
  if (!appPath) {
    fail(`Packaged desktop app not found under ${releaseDir}; cannot validate packaged runtime dependencies.`);
  }

  const resourcesDir = resolve(appPath, 'Contents', 'Resources');
  const appAsarPath = resolve(resourcesDir, 'app.asar');
  if (!existsSync(appAsarPath)) {
    fail(`Packaged desktop app archive not found: ${appAsarPath}`);
  }

  const releaseRequire = createRequire(resolve(buildRoot, 'package.json'));
  const { listPackage } = releaseRequire('@electron/asar');
  const packageEntries = listPackage(appAsarPath);
  const expectedPackages = collectExpectedRuntimePackages(buildRoot);
  const missingPackages = expectedPackages.filter((packageName) => !hasPackagedNodeModule(packageName, packageEntries, resourcesDir));

  if (missingPackages.length > 0) {
    fail(
      [
        'Packaged desktop app is missing runtime dependencies.',
        `App: ${appAsarPath}`,
        'Missing packages:',
        ...missingPackages.map((packageName) => `- ${packageName}`),
      ].join('\n'),
    );
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
      console.log(
        `Stapler ticket for ${pathname} is not visible yet (attempt ${attempt}/${attempts}). Retrying in ${Math.round(
          retryDelayMs / 1000,
        )}s...`,
      );
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

function requireSmokeTestApproval(env, releaseDir, buildRoot) {
  if (isTruthyEnv(env.PERSONAL_AGENT_RELEASE_SMOKE_TESTED)) {
    console.log('Release smoke test gate acknowledged via PERSONAL_AGENT_RELEASE_SMOKE_TESTED=1.');
    return;
  }

  const appPath = collectPackagedAppPath(releaseDir);
  if (!appPath) {
    fail(`Packaged desktop app not found under ${releaseDir}; cannot run release smoke test.`);
  }
  const smokeScriptPath = resolve(buildRoot, 'scripts', 'smoke-desktop-release.mjs');

  if (!isTruthyEnv(env.PERSONAL_AGENT_RELEASE_SKIP_AUTOMATED_SMOKE)) {
    console.log('Running automated release smoke test against the built app with isolated daemon state...');
    run('node', [smokeScriptPath, appPath], { cwd: buildRoot, env });
    return;
  }

  if (!process.stdin.isTTY) {
    fail(
      [
        'Release smoke test is required before pushing/uploading artifacts.',
        `Test the built app at: ${appPath}`,
        'Then rerun with PERSONAL_AGENT_RELEASE_SMOKE_TESTED=1 once startup and core app flows pass.',
        'Automated smoke was skipped by PERSONAL_AGENT_RELEASE_SKIP_AUTOMATED_SMOKE=1.',
      ].join('\n'),
    );
  }

  console.log('');
  console.log('Release smoke test required before publishing.');
  console.log(`Built app: ${appPath}`);
  console.log('Suggested check: launch the app, verify it starts, and smoke test one conversation and one knowledge route.');
  console.log('Press Enter only after the built binary passes the smoke test, or Ctrl-C to abort.');
  run('bash', ['-lc', 'read -r _ < /dev/tty']);
}

const packageJson = readJsonFile(packageJsonPath);
const version = packageJson.version;
const tag = `v${version}`;
const env = loadReleaseEnv();
const releaseRepo = env.PERSONAL_AGENT_RELEASE_REPO;

ensureCleanRepo();
ensureTagAtHead(tag);
ensureSigningIdentity(env);
ensureNotarizationCredentials(env);
ensureGhAuth();
ensureReleaseRepoExists(releaseRepo);

const buildRoot = createCleanReleaseSnapshot(env);
const releaseDir = resolve(buildRoot, 'dist', 'release');

rmSync(releaseDir, { recursive: true, force: true });

console.log(`Building signed desktop artifacts for ${tag} from the clean snapshot...`);
run('pnpm', ['run', 'desktop:dist'], { cwd: buildRoot, env });
validatePackagedAutoUpdateConfig(releaseDir, releaseRepo);
validatePackagedRuntimeDependencies(buildRoot, releaseDir);
const packagedAppForExtensionCheck = collectPackagedAppPath(releaseDir);
if (!packagedAppForExtensionCheck) {
  fail('Packaged desktop app not found; cannot validate packaged extensions.');
}
run('node', ['scripts/check-packaged-extensions.mjs', packagedAppForExtensionCheck], { cwd: buildRoot, env });

const files = collectReleaseFiles(releaseDir, version);
notarizeDistributionContainers(env, files);
requireSmokeTestApproval(env, releaseDir, buildRoot);

console.log(`Pushing ${tag} to GitHub...`);
pushReleaseRef(tag);

const packagedAppPath = collectPackagedAppPath(releaseDir);
const releaseProductName = packagedAppPath
  ? packagedAppPath
      .split('/')
      .pop()
      ?.replace(/\.app$/u, '') || 'Personal Agent'
  : 'Personal Agent';
const releaseNotes = [
  `Signed desktop release artifacts for ${releaseProductName} ${version}.`,
  '',
  'Release assets and update metadata are hosted alongside the source repo.',
].join('\n');

const releaseView = tryCapture('gh', ['release', 'view', tag, '--repo', releaseRepo, '--json', 'url']);
if (releaseView.status === 0) {
  console.log(`Updating existing GitHub release ${tag} in ${releaseRepo}...`);
  run('gh', ['release', 'edit', tag, '--repo', releaseRepo, '--title', `${releaseProductName} ${version}`, '--notes', releaseNotes]);
  run('gh', ['release', 'upload', tag, ...files, '--repo', releaseRepo, '--clobber']);
} else if (`${releaseView.stderr}${releaseView.stdout}`.includes('release not found')) {
  console.log(`Creating GitHub release ${tag} in ${releaseRepo}...`);
  const args = [
    'release',
    'create',
    tag,
    ...files,
    '--repo',
    releaseRepo,
    '--title',
    `${releaseProductName} ${version}`,
    '--notes',
    releaseNotes,
  ];
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
rmSync(buildRoot, { recursive: true, force: true });
