import { chmodSync, cpSync, createReadStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { getExecutionTarget, type ExecutionTargetRecord } from '@personal-agent/core';
import { getRepoRoot } from '@personal-agent/resources';
import { resolveStatePaths } from '@personal-agent/core';

const RUNTIME_PACKAGE_NAMES = ['cli', 'core', 'daemon', 'gateway', 'resources'] as const;
const REMOTE_INSTALL_LAYOUT_VERSION = 1;
const REMOTE_MANIFEST_FILE_NAME = 'manifest.json';
const REMOTE_RUNTIME_LAUNCHER_CONTENT = '#!/usr/bin/env sh\n'
  + 'set -eu\n'
  + 'ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\n'
  + 'export PERSONAL_AGENT_REPO_ROOT="${PERSONAL_AGENT_REPO_ROOT:-$ROOT_DIR}"\n'
  + 'exec node "$ROOT_DIR/packages/cli/dist/index.js" "$@"\n';

interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinFilePath?: string;
}

interface RemoteRuntimeBundleManifest {
  version: 1;
  layoutVersion: number;
  runtimeHash: string;
  launcherRelativePath: string;
  createdAt: string;
  nodeMajor: number;
}

interface RemoteStateBundleManifest {
  version: 1;
  stateHash: string;
  createdAt: string;
}

export interface RemoteTargetInstallResult {
  version: 1;
  targetId: string;
  targetLabel: string;
  sshDestination: string;
  remoteHome: string;
  installRoot: string;
  stateRoot: string;
  launcherPath: string;
  runtimeHash: string;
  stateHash: string;
  nodeVersion: string;
  runtimeChanged: boolean;
  stateChanged: boolean;
}

export interface BuiltRemoteBundle {
  tarPath: string;
  hash: string;
  cleanup: () => Promise<void>;
}

interface RemoteInstallManifest {
  version: 1;
  targetId: string;
  runtimeHash: string;
  stateHash: string;
  installRoot: string;
  stateRoot: string;
  launcherPath: string;
  updatedAt: string;
}

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function joinRemotePath(...parts: string[]): string {
  const filtered = parts
    .map((part) => part.replace(/\\/g, '/'))
    .filter((part) => part.length > 0);

  if (filtered.length === 0) {
    return '/';
  }

  const [first, ...rest] = filtered;
  const prefix = first.startsWith('/') ? '/' : '';
  const firstNormalized = first.replace(/^\/+/, '').replace(/\/+$/g, '');
  const normalized = [firstNormalized, ...rest.map((part) => part.replace(/^\/+/, '').replace(/\/+$/g, ''))]
    .filter((part) => part.length > 0)
    .join('/');
  return `${prefix}${normalized}`;
}

function copyFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function ensureRuntimeSourceFile(path: string, label: string): void {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}. Run npm install && npm run build first.`);
  }
}

function runProcess(command: string, args: string[], options: ProcessOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => rejectPromise(error));
    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise({ stdout, stderr });
        return;
      }

      rejectPromise(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${String(code ?? -1)}`));
    });

    if (options.stdinFilePath) {
      createReadStream(options.stdinFilePath)
        .on('error', rejectPromise)
        .pipe(child.stdin);
      return;
    }

    child.stdin.end();
  });
}

function sshArgs(target: ExecutionTargetRecord, remoteCommand: string): string[] {
  return [target.sshDestination, `bash -lc ${quoteShellArg(remoteCommand)}`];
}

async function runSsh(target: ExecutionTargetRecord, remoteCommand: string, options: ProcessOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return runProcess(target.sshCommand || 'ssh', sshArgs(target, remoteCommand), options);
}

async function uploadFile(target: ExecutionTargetRecord, localPath: string, remotePath: string): Promise<void> {
  const remoteDir = remotePath.split('/').slice(0, -1).join('/') || '/';
  const remoteCommand = `mkdir -p ${quoteShellArg(remoteDir)} && cat > ${quoteShellArg(remotePath)}`;
  await runSsh(target, remoteCommand, { stdinFilePath: localPath });
}

async function createRemoteTempDir(target: ExecutionTargetRecord): Promise<string> {
  const { stdout } = await runSsh(target, 'mktemp -d');
  const remoteTempDir = stdout.trim();
  if (!remoteTempDir) {
    throw new Error(`Remote target ${target.id} did not return a temporary directory path.`);
  }

  return remoteTempDir;
}

function appendPathHash(
  hash: ReturnType<typeof createHash>,
  sourcePath: string,
  relativePath: string,
  options: { dereferenceSymlinks?: boolean } = {},
): void {
  if (!existsSync(sourcePath)) {
    hash.update(`missing:${relativePath}\0`);
    return;
  }

  const stat = lstatSync(sourcePath);
  if (stat.isSymbolicLink() && options.dereferenceSymlinks !== true) {
    hash.update(`link:${relativePath}\0${readlinkSync(sourcePath)}`);
    return;
  }

  const effectivePath = stat.isSymbolicLink() && options.dereferenceSymlinks === true ? realpathSync(sourcePath) : sourcePath;
  const effectiveStat = lstatSync(effectivePath);

  if (effectiveStat.isDirectory()) {
    hash.update(`dir:${relativePath}\0`);
    const entries = readdirSync(effectivePath, { withFileTypes: true })
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    for (const entry of entries) {
      appendPathHash(hash, join(effectivePath, entry), relativePath ? `${relativePath}/${entry}` : entry, options);
    }
    return;
  }

  hash.update(`file:${relativePath}\0`);
  hash.update(readFileSync(effectivePath));
}

function computePathSetHash(entries: Array<{ sourcePath: string; relativePath: string; dereferenceSymlinks?: boolean }>): string {
  const hash = createHash('sha256');
  for (const entry of entries) {
    appendPathHash(hash, entry.sourcePath, entry.relativePath, { dereferenceSymlinks: entry.dereferenceSymlinks });
  }
  return hash.digest('hex');
}

async function createTarball(stageRoot: string, tarPath: string): Promise<void> {
  await runProcess('tar', ['-czf', tarPath, '-C', stageRoot, '.'], {
    env: {
      ...process.env,
      COPYFILE_DISABLE: '1',
      COPY_EXTENDED_ATTRIBUTES_DISABLE: '1',
    },
  });
}

function copyDirIfExists(source: string, destination: string, options: { dereference?: boolean; filter?: (source: string) => boolean } = {}): void {
  if (!existsSync(source)) {
    return;
  }

  cpSync(source, destination, {
    recursive: true,
    dereference: options.dereference ?? false,
    force: true,
    verbatimSymlinks: false,
    filter: options.filter,
  });
}

function copyFileIfExists(source: string, destination: string, options: { dereference?: boolean } = {}): void {
  if (!existsSync(source)) {
    return;
  }

  cpSync(source, destination, {
    dereference: options.dereference ?? false,
    force: true,
    verbatimSymlinks: false,
  });
}

function createRuntimeLauncher(stageRoot: string): void {
  const launcherPath = join(stageRoot, 'bin', 'pa-remote');
  copyFile(launcherPath, REMOTE_RUNTIME_LAUNCHER_CONTENT);
  chmodSync(launcherPath, 0o755);
}

function copyRuntimePackage(repoRoot: string, stageRoot: string, packageName: (typeof RUNTIME_PACKAGE_NAMES)[number]): void {
  const sourceRoot = join(repoRoot, 'packages', packageName);
  const destRoot = join(stageRoot, 'packages', packageName);
  ensureRuntimeSourceFile(join(sourceRoot, 'package.json'), `Runtime package manifest for ${packageName}`);
  ensureRuntimeSourceFile(join(sourceRoot, 'dist'), `Runtime dist directory for ${packageName}`);
  copyFileIfExists(join(sourceRoot, 'package.json'), join(destRoot, 'package.json'));
  copyDirIfExists(join(sourceRoot, 'dist'), join(destRoot, 'dist'));
}

function filterNodeModulesSource(repoRoot: string, path: string): boolean {
  const nodeModulesRoot = join(repoRoot, 'node_modules');
  const rel = relative(nodeModulesRoot, path).replace(/\\/g, '/');
  if (!rel || rel === '') {
    return true;
  }

  return rel !== '@personal-agent' && !rel.startsWith('@personal-agent/');
}

function createWorkspacePackageLinks(stageRoot: string): void {
  const scopeRoot = join(stageRoot, 'node_modules', '@personal-agent');
  mkdirSync(scopeRoot, { recursive: true });
  for (const packageName of RUNTIME_PACKAGE_NAMES) {
    symlinkSync(join('..', '..', 'packages', packageName), join(scopeRoot, packageName), 'dir');
  }
}

function computeRemoteRuntimeHash(repoRoot: string): string {
  const runtimeInputHash = computePathSetHash([
    { sourcePath: join(repoRoot, 'defaults'), relativePath: 'defaults' },
    { sourcePath: join(repoRoot, 'extensions'), relativePath: 'extensions' },
    { sourcePath: join(repoRoot, 'themes'), relativePath: 'themes' },
    { sourcePath: join(repoRoot, 'prompt-catalog'), relativePath: 'prompt-catalog' },
    { sourcePath: join(repoRoot, 'package.json'), relativePath: 'package.json' },
    { sourcePath: join(repoRoot, 'package-lock.json'), relativePath: 'package-lock.json' },
    ...RUNTIME_PACKAGE_NAMES.flatMap((packageName) => ([
      { sourcePath: join(repoRoot, 'packages', packageName, 'package.json'), relativePath: `packages/${packageName}/package.json` },
      { sourcePath: join(repoRoot, 'packages', packageName, 'dist'), relativePath: `packages/${packageName}/dist` },
    ])),
  ]);

  return createHash('sha256')
    .update(runtimeInputHash)
    .update('\0launcher\0')
    .update(REMOTE_RUNTIME_LAUNCHER_CONTENT)
    .digest('hex');
}

export async function createRemoteRuntimeBundle(options: { repoRoot?: string } = {}): Promise<BuiltRemoteBundle> {
  const repoRoot = getRepoRoot(options.repoRoot);
  ensureRuntimeSourceFile(join(repoRoot, 'node_modules'), 'node_modules');
  ensureRuntimeSourceFile(join(repoRoot, 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js'), 'repo-local pi CLI');

  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pa-remote-runtime-'));
  const stageRoot = join(workspaceRoot, 'stage');
  const tarPath = join(workspaceRoot, 'runtime.tgz');

  mkdirSync(stageRoot, { recursive: true });
  copyDirIfExists(join(repoRoot, 'defaults'), join(stageRoot, 'defaults'));
  copyDirIfExists(join(repoRoot, 'extensions'), join(stageRoot, 'extensions'));
  copyDirIfExists(join(repoRoot, 'themes'), join(stageRoot, 'themes'));
  copyDirIfExists(join(repoRoot, 'prompt-catalog'), join(stageRoot, 'prompt-catalog'));
  copyDirIfExists(join(repoRoot, 'node_modules'), join(stageRoot, 'node_modules'), {
    dereference: true,
    filter: (source) => filterNodeModulesSource(repoRoot, source),
  });

  for (const packageName of RUNTIME_PACKAGE_NAMES) {
    copyRuntimePackage(repoRoot, stageRoot, packageName);
  }

  createWorkspacePackageLinks(stageRoot);
  createRuntimeLauncher(stageRoot);

  const runtimeHash = computeRemoteRuntimeHash(repoRoot);
  const manifest: RemoteRuntimeBundleManifest = {
    version: 1,
    layoutVersion: REMOTE_INSTALL_LAYOUT_VERSION,
    runtimeHash,
    launcherRelativePath: 'bin/pa-remote',
    createdAt: new Date().toISOString(),
    nodeMajor: 20,
  };
  copyFile(join(stageRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await createTarball(stageRoot, tarPath);

  return {
    tarPath,
    hash: runtimeHash,
    cleanup: async () => {
      await rm(workspaceRoot, { recursive: true, force: true });
    },
  };
}

function computeRemoteStateHash(stateRoot: string): string {
  return computePathSetHash([
    { sourcePath: join(stateRoot, 'profiles'), relativePath: 'profiles', dereferenceSymlinks: true },
    { sourcePath: join(stateRoot, 'config', 'local'), relativePath: 'config/local', dereferenceSymlinks: true },
    { sourcePath: join(stateRoot, 'config', 'config.json'), relativePath: 'config/config.json', dereferenceSymlinks: true },
    { sourcePath: join(stateRoot, 'pi-agent-runtime', 'auth.json'), relativePath: 'pi-agent-runtime/auth.json', dereferenceSymlinks: true },
  ]);
}

export async function createRemoteStateBundle(options: { stateRoot?: string } = {}): Promise<BuiltRemoteBundle> {
  const stateRoot = resolve(options.stateRoot ?? resolveStatePaths().root);
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pa-remote-state-'));
  const stageRoot = join(workspaceRoot, 'stage');
  const tarPath = join(workspaceRoot, 'state.tgz');

  mkdirSync(stageRoot, { recursive: true });
  copyDirIfExists(join(stateRoot, 'profiles'), join(stageRoot, 'profiles'), { dereference: true });
  copyDirIfExists(join(stateRoot, 'config', 'local'), join(stageRoot, 'config', 'local'), { dereference: true });
  copyFileIfExists(join(stateRoot, 'config', 'config.json'), join(stageRoot, 'config', 'config.json'), { dereference: true });
  copyFileIfExists(join(stateRoot, 'pi-agent-runtime', 'auth.json'), join(stageRoot, 'pi-agent-runtime', 'auth.json'), { dereference: true });

  const stateHash = computeRemoteStateHash(stateRoot);
  const manifest: RemoteStateBundleManifest = {
    version: 1,
    stateHash,
    createdAt: new Date().toISOString(),
  };
  copyFile(join(stageRoot, 'state-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await createTarball(stageRoot, tarPath);

  return {
    tarPath,
    hash: stateHash,
    cleanup: async () => {
      await rm(workspaceRoot, { recursive: true, force: true });
    },
  };
}

function parseNodeVersion(stdout: string): string {
  const nodeVersion = stdout.trim().split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1);
  if (!nodeVersion) {
    throw new Error('Remote target did not return a Node.js version.');
  }

  return nodeVersion.startsWith('v') ? nodeVersion : `v${nodeVersion}`;
}

function parseNodeMajor(version: string): number {
  const match = /^v?(\d+)/.exec(version.trim());
  return match ? Number.parseInt(match[1] as string, 10) : Number.NaN;
}

function resolveRemoteInstallPaths(targetId: string, remoteHome: string) {
  const installRoot = joinRemotePath(remoteHome, '.local', 'share', 'personal-agent', 'targets', targetId);
  const stateRoot = joinRemotePath(remoteHome, '.local', 'state', 'personal-agent');
  const currentRoot = joinRemotePath(installRoot, 'current');
  const launcherPath = joinRemotePath(currentRoot, 'bin', 'pa-remote');
  return {
    installRoot,
    releasesRoot: joinRemotePath(installRoot, 'releases'),
    manifestPath: joinRemotePath(installRoot, REMOTE_MANIFEST_FILE_NAME),
    currentRoot,
    launcherPath,
    stateRoot,
  };
}

async function resolveRemoteHome(target: ExecutionTargetRecord): Promise<string> {
  const { stdout } = await runSsh(target, 'printf "%s\\n" "$HOME"');
  const remoteHome = stdout.trim();
  if (!remoteHome.startsWith('/')) {
    throw new Error(`Could not determine remote home directory for ${target.id}.`);
  }

  return remoteHome;
}

async function inspectRemoteNodeVersion(target: ExecutionTargetRecord): Promise<string> {
  const { stdout } = await runSsh(target, 'set -eu && command -v tar >/dev/null 2>&1 && command -v node >/dev/null 2>&1 && node --version');
  const nodeVersion = parseNodeVersion(stdout);
  const nodeMajor = parseNodeMajor(nodeVersion);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    throw new Error(`Remote target ${target.id} requires Node.js 20+. Found ${nodeVersion}.`);
  }

  return nodeVersion;
}

async function readRemoteManifest(target: ExecutionTargetRecord, manifestPath: string): Promise<RemoteInstallManifest | null> {
  const { stdout } = await runSsh(target, `[ -f ${quoteShellArg(manifestPath)} ] && cat ${quoteShellArg(manifestPath)} || true`);
  const text = stdout.trim();
  if (!text) {
    return null;
  }

  const parsed = JSON.parse(text) as Partial<RemoteInstallManifest>;
  if (parsed.version !== 1 || typeof parsed.runtimeHash !== 'string' || typeof parsed.stateHash !== 'string') {
    return null;
  }

  return {
    version: 1,
    targetId: typeof parsed.targetId === 'string' ? parsed.targetId : target.id,
    runtimeHash: parsed.runtimeHash,
    stateHash: parsed.stateHash,
    installRoot: typeof parsed.installRoot === 'string' ? parsed.installRoot : '',
    stateRoot: typeof parsed.stateRoot === 'string' ? parsed.stateRoot : '',
    launcherPath: typeof parsed.launcherPath === 'string' ? parsed.launcherPath : '',
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
  };
}

export async function ensureRemoteTargetInstall(options: { targetId: string; force?: boolean }): Promise<RemoteTargetInstallResult> {
  const target = getExecutionTarget({ targetId: options.targetId });
  if (!target) {
    throw new Error(`Execution target not found: ${options.targetId}`);
  }

  const repoRoot = getRepoRoot();
  const stateRoot = resolveStatePaths().root;
  const [remoteHome, nodeVersion] = await Promise.all([
    resolveRemoteHome(target),
    inspectRemoteNodeVersion(target),
  ]);

  const paths = resolveRemoteInstallPaths(target.id, remoteHome);
  const [remoteManifest, runtimeHash, stateHash] = await Promise.all([
    readRemoteManifest(target, paths.manifestPath),
    Promise.resolve(computeRemoteRuntimeHash(repoRoot)),
    Promise.resolve(computeRemoteStateHash(stateRoot)),
  ]);
  const runtimeChanged = options.force === true || remoteManifest?.runtimeHash !== runtimeHash;
  const stateChanged = options.force === true || remoteManifest?.stateHash !== stateHash;

  if (!runtimeChanged && !stateChanged) {
    return {
      version: 1,
      targetId: target.id,
      targetLabel: target.label,
      sshDestination: target.sshDestination,
      remoteHome,
      installRoot: paths.installRoot,
      stateRoot: paths.stateRoot,
      launcherPath: remoteManifest?.launcherPath || paths.launcherPath,
      runtimeHash,
      stateHash,
      nodeVersion,
      runtimeChanged: false,
      stateChanged: false,
    };
  }

  const [runtimeBundle, stateBundle] = await Promise.all([
    runtimeChanged ? createRemoteRuntimeBundle({ repoRoot }) : Promise.resolve(null),
    stateChanged ? createRemoteStateBundle({ stateRoot }) : Promise.resolve(null),
  ]);

  const remoteTempDir = await createRemoteTempDir(target);
  const localManifestPath = join(tmpdir(), `pa-remote-target-manifest-${target.id}-${Date.now()}.json`);
  const remoteManifestPath = joinRemotePath(remoteTempDir, REMOTE_MANIFEST_FILE_NAME);

  try {
    const installManifest: RemoteInstallManifest = {
      version: 1,
      targetId: target.id,
      runtimeHash,
      stateHash,
      installRoot: paths.installRoot,
      stateRoot: paths.stateRoot,
      launcherPath: paths.launcherPath,
      updatedAt: new Date().toISOString(),
    };
    writeFileSync(localManifestPath, `${JSON.stringify(installManifest, null, 2)}\n`);

    if (runtimeChanged && runtimeBundle) {
      await uploadFile(target, runtimeBundle.tarPath, joinRemotePath(remoteTempDir, 'runtime.tgz'));
    }
    if (stateChanged && stateBundle) {
      await uploadFile(target, stateBundle.tarPath, joinRemotePath(remoteTempDir, 'state.tgz'));
    }
    await uploadFile(target, localManifestPath, remoteManifestPath);

    const remoteCommands = [
      'set -eu',
      `mkdir -p ${quoteShellArg(paths.installRoot)} ${quoteShellArg(paths.releasesRoot)} ${quoteShellArg(paths.stateRoot)} ${quoteShellArg(joinRemotePath(paths.stateRoot, 'config'))} ${quoteShellArg(joinRemotePath(paths.stateRoot, 'pi-agent-runtime'))}`,
    ];

    if (runtimeChanged) {
      const releaseRoot = joinRemotePath(paths.releasesRoot, runtimeHash);
      const stagingRoot = `${releaseRoot}.tmp`;
      remoteCommands.push(
        `rm -rf ${quoteShellArg(stagingRoot)}`,
        `mkdir -p ${quoteShellArg(stagingRoot)}`,
        `tar -xzf ${quoteShellArg(joinRemotePath(remoteTempDir, 'runtime.tgz'))} -C ${quoteShellArg(stagingRoot)}`,
        `rm -rf ${quoteShellArg(releaseRoot)}`,
        `mv ${quoteShellArg(stagingRoot)} ${quoteShellArg(releaseRoot)}`,
        `rm -rf ${quoteShellArg(paths.currentRoot)}`,
        `ln -s ${quoteShellArg(releaseRoot)} ${quoteShellArg(paths.currentRoot)}`,
      );
    }

    if (stateChanged) {
      remoteCommands.push(
        `rm -rf ${quoteShellArg(joinRemotePath(paths.stateRoot, 'profiles'))}`,
        `rm -rf ${quoteShellArg(joinRemotePath(paths.stateRoot, 'config', 'local'))}`,
        `rm -f ${quoteShellArg(joinRemotePath(paths.stateRoot, 'config', 'config.json'))}`,
        `rm -f ${quoteShellArg(joinRemotePath(paths.stateRoot, 'pi-agent-runtime', 'auth.json'))}`,
        `tar -xzf ${quoteShellArg(joinRemotePath(remoteTempDir, 'state.tgz'))} -C ${quoteShellArg(paths.stateRoot)}`,
      );
    }

    remoteCommands.push(`cp ${quoteShellArg(remoteManifestPath)} ${quoteShellArg(paths.manifestPath)}`);
    await runSsh(target, remoteCommands.join(' && '));

    return {
      version: 1,
      targetId: target.id,
      targetLabel: target.label,
      sshDestination: target.sshDestination,
      remoteHome,
      installRoot: paths.installRoot,
      stateRoot: paths.stateRoot,
      launcherPath: paths.launcherPath,
      runtimeHash,
      stateHash,
      nodeVersion,
      runtimeChanged,
      stateChanged,
    };
  } finally {
    await Promise.allSettled([
      runtimeBundle?.cleanup(),
      stateBundle?.cleanup(),
      rm(localManifestPath, { force: true }),
      runSsh(target, `rm -rf ${quoteShellArg(remoteTempDir)}`).catch(() => undefined),
    ]);
  }
}
