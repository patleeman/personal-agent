import { spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  emitDaemonEvent,
  getDaemonStatus,
  loadDaemonConfig,
  pingDaemon,
  resolveDaemonPaths,
} from '@personal-agent/daemon';
import { getRepoRoot } from '@personal-agent/resources';

interface GatewayLogTail {
  path?: string;
  lines: string[];
}

export interface SyncConfigSummary {
  enabled: boolean;
  repoDir: string;
  remote: string;
  branch: string;
  intervalSeconds: number;
  autoResolveWithAgent: boolean;
  conflictResolverTaskSlug: string;
  resolverCooldownMinutes: number;
  autoResolveErrorsWithAgent: boolean;
  errorResolverTaskSlug: string;
  errorResolverCooldownMinutes: number;
}

export interface SyncGitSummary {
  hasRepo: boolean;
  currentBranch?: string;
  dirtyEntries?: number;
  lastCommit?: string;
  remoteUrl?: string;
}

export interface SyncModuleRuntimeDetail {
  running: boolean;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastCommitAt?: string;
  lastConflictAt?: string;
  lastConflictFiles: string[];
  lastResolverStartedAt?: string;
  lastResolverResult?: string;
  lastErrorResolverStartedAt?: string;
  lastErrorResolverResult?: string;
  lastError?: string;
}

export interface SyncDaemonSummary {
  connected: boolean;
  moduleLoaded: boolean;
  moduleEnabled: boolean;
  moduleDetail?: SyncModuleRuntimeDetail;
}

export interface SyncStateSnapshot {
  warnings: string[];
  config: SyncConfigSummary;
  git: SyncGitSummary;
  daemon: SyncDaemonSummary;
  log: GatewayLogTail;
}

export type SyncSetupMode = 'fresh' | 'bootstrap';

export interface SyncSetupInput {
  repoUrl: string;
  branch: string;
  mode: SyncSetupMode;
  repoDir?: string;
}

const DEFAULT_SYNC_BRANCH = 'main';

function readTailLines(filePath: string | undefined, maxLines = 220, maxBytes = 256 * 1024): string[] {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  let fd: number | undefined;

  try {
    const stats = statSync(filePath);
    const readLength = Math.min(maxBytes, stats.size);
    if (readLength <= 0) {
      return [];
    }

    const buffer = Buffer.alloc(readLength);
    fd = openSync(filePath, 'r');
    readSync(fd, buffer, 0, readLength, stats.size - readLength);

    return buffer
      .toString('utf-8')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function runGit(repoDir: string, args: string[], allowFailure = false): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', repoDir, ...args], {
    encoding: 'utf-8',
  });

  if (result.error) {
    throw result.error;
  }

  const code = result.status ?? 1;
  const stdout = (result.stdout ?? '').trim();
  const stderr = (result.stderr ?? '').trim();

  if (!allowFailure && code !== 0) {
    throw new Error(stderr || stdout || `git ${args.join(' ')} failed with exit code ${code}`);
  }

  return { code, stdout, stderr };
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSyncSetupMode(value: unknown): SyncSetupMode {
  if (value === undefined || value === null || value === '') {
    return 'fresh';
  }

  if (value === 'fresh' || value === 'bootstrap') {
    return value;
  }

  throw new Error('mode must be "fresh" or "bootstrap" when provided');
}

export function parseSyncSetupInput(value: unknown): SyncSetupInput {
  if (!isRecord(value)) {
    throw new Error('sync setup body must be an object');
  }

  const repoUrl = toOptionalString(value.repoUrl);
  if (!repoUrl) {
    throw new Error('repoUrl is required');
  }

  const branch = toOptionalString(value.branch) ?? DEFAULT_SYNC_BRANCH;
  const repoDir = toOptionalString(value.repoDir);

  return {
    repoUrl,
    branch,
    mode: parseSyncSetupMode(value.mode),
    repoDir: repoDir ? resolve(repoDir) : undefined,
  };
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function parseSyncModuleDetail(value: unknown): SyncModuleRuntimeDetail | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  return {
    running: record.running === true,
    lastRunAt: toOptionalString(record.lastRunAt),
    lastSuccessAt: toOptionalString(record.lastSuccessAt),
    lastCommitAt: toOptionalString(record.lastCommitAt),
    lastConflictAt: toOptionalString(record.lastConflictAt),
    lastConflictFiles: toStringArray(record.lastConflictFiles),
    lastResolverStartedAt: toOptionalString(record.lastResolverStartedAt),
    lastResolverResult: toOptionalString(record.lastResolverResult),
    lastErrorResolverStartedAt: toOptionalString(record.lastErrorResolverStartedAt),
    lastErrorResolverResult: toOptionalString(record.lastErrorResolverResult),
    lastError: toOptionalString(record.lastError),
  };
}

function readSyncGitSummary(repoDir: string, remote: string): SyncGitSummary {
  const normalizedRepoDir = repoDir.trim();
  if (normalizedRepoDir.length === 0) {
    return {
      hasRepo: false,
    };
  }

  const gitDir = join(normalizedRepoDir, '.git');
  if (!existsSync(gitDir)) {
    return {
      hasRepo: false,
    };
  }

  const status = runGit(normalizedRepoDir, ['status', '--porcelain'], true);

  return {
    hasRepo: true,
    dirtyEntries: status.code === 0
      ? (status.stdout.length > 0 ? status.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length : 0)
      : undefined,
  };
}

async function readSyncDaemonSummary(): Promise<SyncDaemonSummary> {
  const config = loadDaemonConfig();

  if (!(await pingDaemon(config))) {
    return {
      connected: false,
      moduleLoaded: false,
      moduleEnabled: false,
    };
  }

  const status = await getDaemonStatus(config);
  const moduleEntry = status.modules.find((entry) => entry.name === 'sync');

  return {
    connected: true,
    moduleLoaded: Boolean(moduleEntry),
    moduleEnabled: moduleEntry?.enabled === true,
    moduleDetail: parseSyncModuleDetail(moduleEntry?.detail),
  };
}

function readSyncConfig(): SyncConfigSummary {
  const config = loadDaemonConfig();
  const sync = config.modules.sync;

  return {
    enabled: sync?.enabled === true,
    repoDir: sync?.repoDir ?? '',
    remote: sync?.remote ?? 'origin',
    branch: sync?.branch ?? 'main',
    intervalSeconds: typeof sync?.intervalSeconds === 'number' ? sync.intervalSeconds : 120,
    autoResolveWithAgent: sync?.autoResolveWithAgent !== false,
    conflictResolverTaskSlug: sync?.conflictResolverTaskSlug ?? 'sync-conflict-resolver',
    resolverCooldownMinutes: typeof sync?.resolverCooldownMinutes === 'number' ? sync.resolverCooldownMinutes : 30,
    autoResolveErrorsWithAgent: sync?.autoResolveErrorsWithAgent !== false,
    errorResolverTaskSlug: sync?.errorResolverTaskSlug ?? 'sync-error-resolver',
    errorResolverCooldownMinutes: typeof sync?.errorResolverCooldownMinutes === 'number' ? sync.errorResolverCooldownMinutes : 30,
  };
}

function buildWarnings(input: {
  config: SyncConfigSummary;
  git: SyncGitSummary;
  daemon: SyncDaemonSummary;
}): string[] {
  const warnings: string[] = [];

  if (!input.config.enabled) {
    warnings.push('Sync module is disabled in daemon configuration.');
  }

  if (!input.git.hasRepo) {
    warnings.push(`Sync repo is not initialized at ${input.config.repoDir}. Run "pa sync setup --repo <git-url> --fresh".`);
  }

  if (!input.daemon.connected) {
    warnings.push('Daemon is offline; automatic sync is not running.');
  } else if (!input.daemon.moduleLoaded) {
    warnings.push('Daemon does not report the sync module. Restart daemon after upgrading.');
  }

  if (input.daemon.moduleDetail?.lastConflictFiles.length) {
    warnings.push(`Sync has unresolved conflicts in ${input.daemon.moduleDetail.lastConflictFiles.length} file(s).`);
  }

  if (input.daemon.moduleDetail?.lastError) {
    warnings.push(`Last sync error: ${input.daemon.moduleDetail.lastError}`);
  }

  return warnings;
}

export async function readSyncState(): Promise<SyncStateSnapshot> {
  const config = readSyncConfig();
  const git = readSyncGitSummary(config.repoDir, config.remote);
  const daemon = await readSyncDaemonSummary();

  const daemonPaths = resolveDaemonPaths(loadDaemonConfig().ipc.socketPath);

  return {
    warnings: buildWarnings({ config, git, daemon }),
    config,
    git,
    daemon,
    log: {
      path: daemonPaths.logFile,
      lines: readTailLines(daemonPaths.logFile).filter((line) => line.includes('[module:sync]') || line.includes('sync ')).slice(-160),
    },
  };
}

function trimProcessOutput(value: string | undefined, maxLength = 2_000): string {
  const trimmed = (value ?? '').trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1)}…`;
}

function runSyncSetupCommand(input: SyncSetupInput): void {
  const repoRoot = getRepoRoot();
  const cliEntryFile = join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

  if (!existsSync(cliEntryFile)) {
    throw new Error(`CLI entrypoint is not built at ${cliEntryFile}. Run "npm --prefix packages/cli run build" from ${repoRoot}.`);
  }

  const args = [
    cliEntryFile,
    'sync',
    'setup',
    '--repo',
    input.repoUrl,
    '--branch',
    input.branch,
    input.mode === 'bootstrap' ? '--bootstrap' : '--fresh',
  ];

  if (input.repoDir) {
    args.push('--repo-dir', input.repoDir);
  }

  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      PERSONAL_AGENT_REPO_ROOT: repoRoot,
    },
  });

  if (result.error) {
    throw result.error;
  }

  const code = result.status ?? 1;
  if (code !== 0) {
    const details = [trimProcessOutput(result.stderr), trimProcessOutput(result.stdout)]
      .filter((entry) => entry.length > 0)
      .join('\n');

    throw new Error(details || `pa sync setup failed with exit code ${code}`);
  }
}

export async function setupSyncAndReadState(input: SyncSetupInput): Promise<SyncStateSnapshot> {
  runSyncSetupCommand(input);
  return readSyncState();
}

export async function requestSyncRunAndReadState(): Promise<SyncStateSnapshot> {
  const config = loadDaemonConfig();

  if (!(await pingDaemon(config))) {
    throw new Error('Daemon is offline. Start it from the Daemon page or run "pa daemon start".');
  }

  const accepted = await emitDaemonEvent({
    type: 'sync.run.requested',
    source: 'web:sync',
    payload: {
      reason: 'manual-web',
    },
  }, config);

  if (!accepted) {
    throw new Error('Daemon queue is full; sync run was not accepted. Try again in a moment.');
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  return readSyncState();
}
