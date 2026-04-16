import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getConfigRoot, getManagedKnowledgeBaseRoot, getStateRoot, getVaultRoot } from './runtime/paths.js';
import {
  DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH,
  readMachineKnowledgeBaseBranch,
  readMachineKnowledgeBaseRepoUrl,
  type MachineConfigOptions,
  type MachineKnowledgeBaseState,
  writeMachineKnowledgeBase,
} from './machine-config.js';

interface WorkingSnapshotEntry {
  blobHash: string;
}

type Snapshot = Record<string, WorkingSnapshotEntry>;

interface StoredKnowledgeBaseState {
  version: 1;
  repoUrl: string;
  branch: string;
  lastSyncAt?: string;
  lastSyncHead?: string;
  snapshot: Snapshot;
}

export type KnowledgeBaseSyncStatus = 'disabled' | 'idle' | 'syncing' | 'error';

export interface KnowledgeBaseState {
  repoUrl: string;
  branch: string;
  configured: boolean;
  effectiveRoot: string;
  managedRoot: string;
  usesManagedRoot: boolean;
  syncStatus: KnowledgeBaseSyncStatus;
  lastSyncAt?: string;
  lastError?: string;
  recoveredEntryCount: number;
  recoveryDir: string;
}

export interface UpdateKnowledgeBaseInput {
  repoUrl?: string | null;
  branch?: string | null;
}

export interface KnowledgeBaseManagerOptions {
  stateRoot?: string;
  configRoot?: string;
}

interface RuntimeSyncState {
  syncStatus: KnowledgeBaseSyncStatus;
  lastSyncAt?: string;
  lastError?: string;
  recoveredEntryCount: number;
}

interface PathChangeResolution {
  path: string;
  winner: 'local' | 'remote';
  localExists: boolean;
  remoteExists: boolean;
  localChanged: boolean;
  remoteChanged: boolean;
}

const SYNC_COMMIT_AUTHOR_NAME = 'Personal Agent';
const SYNC_COMMIT_AUTHOR_EMAIL = 'kb@personal-agent.local';
const KNOWLEDGE_BASE_SYNC_INTERVAL_MS = 15_000;
const LOCAL_STATE_FILE_NAME = 'state.json';
const RECOVERY_INDEX_FILE_NAME = 'recovery-index.json';
const SNAPSHOT_VERSION = 1;
const SOURCE_ENV_VAR = 'PERSONAL_AGENT_VAULT_ROOT';
const SKIPPED_RECOVERY_PATH_SEGMENTS = new Set(['', '.', '..']);
const managerRegistry = new Map<string, KnowledgeBaseManager>();

function normalizeRepoUrl(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBranch(value: string | null | undefined): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH;
}

function computeRecoveryEntryId(relativePath: string, timestamp: string): string {
  return createHash('sha1').update(`${timestamp}:${relativePath}`).digest('hex');
}

function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function toIsoTimestamp(value: number | Date = Date.now()): string {
  return new Date(value).toISOString();
}

function runGitCommand(cwd: string, args: string[], options: { allowFailure?: boolean; encoding?: BufferEncoding | 'buffer' } = {}): string | Buffer {
  try {
    return execFileSync('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: options.encoding === 'buffer' ? undefined : (options.encoding ?? 'utf-8'),
    });
  } catch (error) {
    if (options.allowFailure) {
      return options.encoding === 'buffer' ? Buffer.alloc(0) : '';
    }

    const childError = error as { stderr?: string | Buffer; message?: string };
    const stderr = typeof childError.stderr === 'string'
      ? childError.stderr.trim()
      : Buffer.isBuffer(childError.stderr)
        ? childError.stderr.toString('utf-8').trim()
        : '';
    const message = stderr || childError.message || `git ${args.join(' ')} failed`;
    throw new Error(message);
  }
}

function runGitText(cwd: string, args: string[], options: { allowFailure?: boolean } = {}): string {
  return String(runGitCommand(cwd, args, options));
}

function runGitBuffer(cwd: string, args: string[], options: { allowFailure?: boolean } = {}): Buffer {
  const result = runGitCommand(cwd, args, { ...options, encoding: 'buffer' });
  return Buffer.isBuffer(result) ? result : Buffer.from(String(result), 'utf-8');
}

function refExists(cwd: string, ref: string): boolean {
  const output = runGitText(cwd, ['show-ref', '--verify', ref], { allowFailure: true }).trim();
  return output.length > 0;
}

function headExists(cwd: string): boolean {
  return runGitText(cwd, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).trim().length > 0;
}

function getHeadSha(cwd: string): string {
  return runGitText(cwd, ['rev-parse', 'HEAD']).trim();
}

function getRemoteRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}

function listRemoteSnapshot(cwd: string, branch: string): Snapshot {
  const remoteRef = getRemoteRef(branch);
  if (!refExists(cwd, remoteRef)) {
    return {};
  }

  const output = runGitBuffer(cwd, ['ls-tree', '-rz', '-r', remoteRef], { allowFailure: true });
  if (output.length === 0) {
    return {};
  }

  const snapshot: Snapshot = {};
  for (const rawEntry of output.toString('utf-8').split('\0')) {
    if (!rawEntry) {
      continue;
    }

    const tabIndex = rawEntry.indexOf('\t');
    if (tabIndex < 0) {
      continue;
    }

    const metadata = rawEntry.slice(0, tabIndex).trim().split(/\s+/);
    const path = rawEntry.slice(tabIndex + 1).trim();
    const blobHash = metadata[2]?.trim();
    if (!path || !blobHash) {
      continue;
    }

    snapshot[path] = { blobHash };
  }

  return snapshot;
}

function parseNullSeparatedPaths(value: string): string[] {
  return value
    .split('\0')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function listWorkingTreePaths(cwd: string): string[] {
  const tracked = parseNullSeparatedPaths(runGitText(cwd, ['ls-files', '-z'], { allowFailure: true }));
  const untracked = parseNullSeparatedPaths(runGitText(cwd, ['ls-files', '--others', '--exclude-standard', '-z'], { allowFailure: true }));
  return [...new Set([...tracked, ...untracked])].sort((left, right) => left.localeCompare(right));
}

function computeWorkingBlobHash(cwd: string, relativePath: string): string {
  return runGitText(cwd, ['hash-object', '--', relativePath]).trim();
}

function listWorkingSnapshot(cwd: string): Snapshot {
  const snapshot: Snapshot = {};
  for (const relativePath of listWorkingTreePaths(cwd)) {
    const absolutePath = join(cwd, relativePath);
    if (!existsSync(absolutePath)) {
      continue;
    }

    const stats = statSync(absolutePath);
    if (!stats.isFile()) {
      continue;
    }

    snapshot[relativePath] = {
      blobHash: computeWorkingBlobHash(cwd, relativePath),
    };
  }
  return snapshot;
}

function snapshotsEqual(left: WorkingSnapshotEntry | undefined, right: WorkingSnapshotEntry | undefined): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.blobHash === right.blobHash;
}

function readGitRemoteUrl(cwd: string): string {
  return runGitText(cwd, ['remote', 'get-url', 'origin'], { allowFailure: true }).trim();
}

function safeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'knowledge-base';
}

function sanitizeRecoveryRelativePath(relativePath: string): string {
  const segments = relativePath.split('/').filter((segment) => !SKIPPED_RECOVERY_PATH_SEGMENTS.has(segment));
  return segments.length > 0 ? segments.join('/') : 'recovered-file';
}

function readStoredState(filePath: string): StoredKnowledgeBaseState | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<StoredKnowledgeBaseState>;
    if (parsed.version !== SNAPSHOT_VERSION) {
      return null;
    }

    if (typeof parsed.repoUrl !== 'string' || typeof parsed.branch !== 'string' || !parsed.snapshot || typeof parsed.snapshot !== 'object') {
      return null;
    }

    const snapshot: Snapshot = {};
    for (const [path, entry] of Object.entries(parsed.snapshot as Record<string, { blobHash?: unknown }>)) {
      if (!path || !entry || typeof entry !== 'object' || typeof entry.blobHash !== 'string' || entry.blobHash.trim().length === 0) {
        continue;
      }
      snapshot[path] = { blobHash: entry.blobHash.trim() };
    }

    return {
      version: SNAPSHOT_VERSION,
      repoUrl: parsed.repoUrl.trim(),
      branch: normalizeBranch(parsed.branch),
      ...(typeof parsed.lastSyncAt === 'string' && parsed.lastSyncAt.trim().length > 0 ? { lastSyncAt: parsed.lastSyncAt.trim() } : {}),
      ...(typeof parsed.lastSyncHead === 'string' && parsed.lastSyncHead.trim().length > 0 ? { lastSyncHead: parsed.lastSyncHead.trim() } : {}),
      snapshot,
    };
  } catch {
    return null;
  }
}

function writeStoredState(filePath: string, state: StoredKnowledgeBaseState): void {
  ensureParentDirectory(filePath);
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function clearStoredState(filePath: string): void {
  rmSync(filePath, { force: true });
}

function readRecoveryIndex(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as { entries?: unknown };
    return Array.isArray(parsed.entries)
      ? parsed.entries.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function appendRecoveryIndex(filePath: string, entryId: string): number {
  const entries = readRecoveryIndex(filePath);
  entries.push(entryId);
  ensureParentDirectory(filePath);
  writeFileSync(filePath, `${JSON.stringify({ entries }, null, 2)}\n`);
  return entries.length;
}

function removeEmptyParentDirectories(root: string, filePath: string): void {
  let current = dirname(filePath);
  const resolvedRoot = resolve(root);
  while (current.startsWith(resolvedRoot) && current !== resolvedRoot) {
    try {
      rmSync(current, { force: true, recursive: false });
    } catch {
      break;
    }
    current = dirname(current);
  }
}

function deleteFileIfExists(filePath: string, root: string): void {
  if (!existsSync(filePath)) {
    return;
  }

  unlinkSync(filePath);
  removeEmptyParentDirectories(root, filePath);
}

function ensureBootstrapFiles(root: string): void {
  mkdirSync(join(root, 'skills'), { recursive: true });
  mkdirSync(join(root, 'notes'), { recursive: true });

  const gitignorePath = join(root, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, ['.DS_Store', '.obsidian/'].join('\n') + '\n');
  }

  const skillKeepPath = join(root, 'skills', '.gitkeep');
  if (!existsSync(skillKeepPath)) {
    writeFileSync(skillKeepPath, '');
  }

  const notesKeepPath = join(root, 'notes', '.gitkeep');
  if (!existsSync(notesKeepPath)) {
    writeFileSync(notesKeepPath, '');
  }
}

function readRemoteFileBuffer(cwd: string, branch: string, relativePath: string): Buffer | null {
  const remoteRef = getRemoteRef(branch);
  if (!refExists(cwd, remoteRef)) {
    return null;
  }

  const buffer = runGitBuffer(cwd, ['show', `${remoteRef}:${relativePath}`], { allowFailure: true });
  return buffer.length > 0 ? buffer : null;
}

function readLocalFileBuffer(root: string, relativePath: string): Buffer | null {
  const absolutePath = join(root, relativePath);
  return existsSync(absolutePath) ? readFileSync(absolutePath) : null;
}

function readRemotePathTimestampMs(cwd: string, branch: string, relativePath: string, existsInRemote: boolean): number {
  const remoteRef = getRemoteRef(branch);
  const args = existsInRemote
    ? ['log', '-1', '--format=%ct', remoteRef, '--', relativePath]
    : ['log', '-1', '--diff-filter=D', '--format=%ct', remoteRef, '--', relativePath];
  const output = runGitText(cwd, args, { allowFailure: true }).trim();
  const parsed = Number.parseInt(output, 10);
  return Number.isFinite(parsed) ? parsed * 1000 : 0;
}

function readLocalPathTimestampMs(root: string, relativePath: string, existsInLocal: boolean): number {
  if (!existsInLocal) {
    return Date.now();
  }

  try {
    return statSync(join(root, relativePath)).mtimeMs;
  } catch {
    return Date.now();
  }
}

function setRuntimeState(
  runtimeState: RuntimeSyncState,
  input: Partial<RuntimeSyncState>,
): void {
  if (input.syncStatus) {
    runtimeState.syncStatus = input.syncStatus;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'lastSyncAt')) {
    runtimeState.lastSyncAt = input.lastSyncAt;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'lastError')) {
    runtimeState.lastError = input.lastError;
  }
  if (typeof input.recoveredEntryCount === 'number') {
    runtimeState.recoveredEntryCount = input.recoveredEntryCount;
  }
}

export class KnowledgeBaseManager {
  private readonly stateRoot: string;
  private readonly configRoot: string;
  private readonly localStateFilePath: string;
  private readonly recoveryDir: string;
  private readonly recoveryIndexPath: string;
  private runtimeState: RuntimeSyncState;
  private interval: NodeJS.Timeout | null = null;
  private syncInProgress = false;

  constructor(options: KnowledgeBaseManagerOptions = {}) {
    this.stateRoot = resolve(options.stateRoot ?? getStateRoot());
    this.configRoot = resolve(options.configRoot ?? getConfigRoot());
    this.localStateFilePath = join(this.stateRoot, 'knowledge-base', LOCAL_STATE_FILE_NAME);
    this.recoveryDir = join(this.stateRoot, 'knowledge-base', 'recovered');
    this.recoveryIndexPath = join(this.stateRoot, 'knowledge-base', RECOVERY_INDEX_FILE_NAME);

    const storedState = readStoredState(this.localStateFilePath);
    this.runtimeState = {
      syncStatus: 'idle',
      ...(storedState?.lastSyncAt ? { lastSyncAt: storedState.lastSyncAt } : {}),
      recoveredEntryCount: readRecoveryIndex(this.recoveryIndexPath).length,
    };
  }

  private machineConfigOptions(): MachineConfigOptions {
    return { configRoot: this.configRoot };
  }

  private readConfig(): MachineKnowledgeBaseState {
    return {
      repoUrl: readMachineKnowledgeBaseRepoUrl(this.machineConfigOptions()),
      branch: readMachineKnowledgeBaseBranch(this.machineConfigOptions()),
    };
  }

  private readStoredStateForConfig(config: MachineKnowledgeBaseState): StoredKnowledgeBaseState | null {
    const stored = readStoredState(this.localStateFilePath);
    if (!stored) {
      return null;
    }

    if (stored.repoUrl !== config.repoUrl || stored.branch !== config.branch) {
      return null;
    }

    return stored;
  }

  private archiveManagedRoot(reason: string): void {
    const managedRoot = getManagedKnowledgeBaseRoot(this.stateRoot);
    if (!existsSync(managedRoot)) {
      return;
    }

    const archiveDir = join(this.stateRoot, 'knowledge-base', 'archives');
    mkdirSync(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, `${toIsoTimestamp().replace(/[:.]/g, '-')}-${safeSlug(reason)}`);
    renameSync(managedRoot, archivePath);
  }

  private ensureRepoCheckout(config: MachineKnowledgeBaseState): string {
    const root = getManagedKnowledgeBaseRoot(this.stateRoot);
    const currentRemoteUrl = existsSync(join(root, '.git')) ? readGitRemoteUrl(root) : '';
    const needsReset = currentRemoteUrl.length > 0 && currentRemoteUrl !== config.repoUrl;
    if (needsReset) {
      this.archiveManagedRoot(`repo-change-${config.repoUrl}`);
      clearStoredState(this.localStateFilePath);
    }

    if (!existsSync(join(root, '.git'))) {
      rmSync(root, { recursive: true, force: true });
      mkdirSync(dirname(root), { recursive: true });
      runGitText(dirname(root), ['clone', config.repoUrl, root]);
    }

    if (readGitRemoteUrl(root) !== config.repoUrl) {
      runGitText(root, ['remote', 'set-url', 'origin', config.repoUrl]);
    }

    ensureBootstrapFiles(root);
    return root;
  }

  private checkoutRemoteBase(root: string, branch: string, remoteExists: boolean): void {
    if (remoteExists) {
      const remoteRef = getRemoteRef(branch);
      runGitText(root, ['checkout', '-B', branch, remoteRef]);
      runGitText(root, ['reset', '--hard', remoteRef]);
      return;
    }

    if (headExists(root)) {
      runGitText(root, ['checkout', '-B', branch]);
      return;
    }

    runGitText(root, ['checkout', '--orphan', branch], { allowFailure: true });
  }

  private readState(): KnowledgeBaseState {
    const config = this.readConfig();
    const configured = config.repoUrl.length > 0;
    const sourceOverrideActive = typeof process.env[SOURCE_ENV_VAR] === 'string' && process.env[SOURCE_ENV_VAR]!.trim().length > 0;
    const managedRoot = getManagedKnowledgeBaseRoot(this.stateRoot);
    return {
      repoUrl: config.repoUrl,
      branch: config.branch,
      configured,
      effectiveRoot: configured && !sourceOverrideActive ? managedRoot : getVaultRoot(),
      managedRoot,
      usesManagedRoot: configured && !sourceOverrideActive,
      syncStatus: configured ? this.runtimeState.syncStatus : 'disabled',
      ...(this.runtimeState.lastSyncAt ? { lastSyncAt: this.runtimeState.lastSyncAt } : {}),
      ...(this.runtimeState.lastError ? { lastError: this.runtimeState.lastError } : {}),
      recoveredEntryCount: this.runtimeState.recoveredEntryCount,
      recoveryDir: this.recoveryDir,
    };
  }

  readKnowledgeBaseState(): KnowledgeBaseState {
    return this.readState();
  }

  updateKnowledgeBase(input: UpdateKnowledgeBaseInput): KnowledgeBaseState {
    const currentConfig = this.readConfig();
    const nextRepoUrl = input.repoUrl === undefined ? currentConfig.repoUrl : normalizeRepoUrl(input.repoUrl);
    const nextBranch = input.branch === undefined ? currentConfig.branch : normalizeBranch(input.branch);

    if (currentConfig.repoUrl && nextRepoUrl && currentConfig.repoUrl !== nextRepoUrl) {
      this.archiveManagedRoot(`repo-change-${nextRepoUrl}`);
      clearStoredState(this.localStateFilePath);
    }

    if (!nextRepoUrl) {
      clearStoredState(this.localStateFilePath);
      setRuntimeState(this.runtimeState, {
        syncStatus: 'disabled',
        lastError: undefined,
      });
    }

    writeMachineKnowledgeBase({ repoUrl: nextRepoUrl, branch: nextBranch }, this.machineConfigOptions());

    if (nextRepoUrl) {
      this.syncNow();
    }

    return this.readState();
  }

  private writeRecoveryCopy(relativePath: string, content: Buffer, timestamp: string): void {
    const safeRelativePath = sanitizeRecoveryRelativePath(relativePath);
    const recoveryPath = join(this.recoveryDir, timestamp.replace(/[:.]/g, '-'), safeRelativePath);
    ensureParentDirectory(recoveryPath);
    writeFileSync(recoveryPath, content);
    const nextCount = appendRecoveryIndex(this.recoveryIndexPath, computeRecoveryEntryId(relativePath, timestamp));
    this.runtimeState.recoveredEntryCount = nextCount;
  }

  private stageAndCommitIfNeeded(root: string, branch: string, timestamp: string): void {
    const statusOutput = runGitText(root, ['status', '--porcelain=v1', '--untracked-files=all'], { allowFailure: true }).trim();
    if (!statusOutput) {
      return;
    }

    runGitText(root, ['add', '--all']);
    runGitText(root, [
      '-c', `user.name=${SYNC_COMMIT_AUTHOR_NAME}`,
      '-c', `user.email=${SYNC_COMMIT_AUTHOR_EMAIL}`,
      '-c', 'commit.gpgsign=false',
      'commit',
      '-m', `kb sync ${timestamp}`,
    ]);

    runGitText(root, ['push', 'origin', `HEAD:refs/heads/${branch}`]);
  }

  private resolveChangedPaths(
    root: string,
    branch: string,
    baseSnapshot: Snapshot,
    workingSnapshot: Snapshot,
    remoteSnapshot: Snapshot,
  ): PathChangeResolution[] {
    const changedPaths = new Set<string>();
    for (const path of Object.keys(baseSnapshot)) {
      if (!snapshotsEqual(baseSnapshot[path], workingSnapshot[path]) || !snapshotsEqual(baseSnapshot[path], remoteSnapshot[path])) {
        changedPaths.add(path);
      }
    }
    for (const path of Object.keys(workingSnapshot)) {
      if (!snapshotsEqual(baseSnapshot[path], workingSnapshot[path]) || !snapshotsEqual(baseSnapshot[path], remoteSnapshot[path])) {
        changedPaths.add(path);
      }
    }
    for (const path of Object.keys(remoteSnapshot)) {
      if (!snapshotsEqual(baseSnapshot[path], remoteSnapshot[path]) || !snapshotsEqual(baseSnapshot[path], workingSnapshot[path])) {
        changedPaths.add(path);
      }
    }

    const resolutions: PathChangeResolution[] = [];
    for (const path of [...changedPaths].sort((left, right) => left.localeCompare(right))) {
      const localExists = Boolean(workingSnapshot[path]);
      const remoteExists = Boolean(remoteSnapshot[path]);
      const localChanged = !snapshotsEqual(baseSnapshot[path], workingSnapshot[path]);
      const remoteChanged = !snapshotsEqual(baseSnapshot[path], remoteSnapshot[path]);

      if (!localChanged && !remoteChanged) {
        continue;
      }

      if (localChanged && !remoteChanged) {
        resolutions.push({ path, winner: 'local', localExists, remoteExists, localChanged, remoteChanged });
        continue;
      }

      if (!localChanged && remoteChanged) {
        resolutions.push({ path, winner: 'remote', localExists, remoteExists, localChanged, remoteChanged });
        continue;
      }

      if (!localExists && !remoteExists) {
        resolutions.push({ path, winner: 'remote', localExists, remoteExists, localChanged, remoteChanged });
        continue;
      }

      const localTimestampMs = readLocalPathTimestampMs(root, path, localExists);
      const remoteTimestampMs = readRemotePathTimestampMs(root, branch, path, remoteExists);
      const winner = localTimestampMs >= remoteTimestampMs ? 'local' : 'remote';
      resolutions.push({ path, winner, localExists, remoteExists, localChanged, remoteChanged });
    }

    return resolutions;
  }

  syncNow(): KnowledgeBaseState {
    const config = this.readConfig();
    if (!config.repoUrl) {
      setRuntimeState(this.runtimeState, {
        syncStatus: 'disabled',
        lastError: undefined,
      });
      return this.readState();
    }

    if (this.syncInProgress) {
      return this.readState();
    }

    this.syncInProgress = true;
    setRuntimeState(this.runtimeState, {
      syncStatus: 'syncing',
      lastError: undefined,
    });

    try {
      const root = this.ensureRepoCheckout(config);
      runGitText(root, ['fetch', 'origin'], { allowFailure: true });
      ensureBootstrapFiles(root);

      const remoteSnapshot = listRemoteSnapshot(root, config.branch);
      const remoteExists = Object.keys(remoteSnapshot).length > 0 || refExists(root, getRemoteRef(config.branch));
      const storedState = this.readStoredStateForConfig(config);
      const baseSnapshot = storedState?.snapshot ?? (remoteExists ? remoteSnapshot : {});
      const timestamp = toIsoTimestamp();

      if (!remoteExists) {
        this.checkoutRemoteBase(root, config.branch, false);
        ensureBootstrapFiles(root);
        this.stageAndCommitIfNeeded(root, config.branch, timestamp);
        const snapshot = listWorkingSnapshot(root);
        writeStoredState(this.localStateFilePath, {
          version: SNAPSHOT_VERSION,
          repoUrl: config.repoUrl,
          branch: config.branch,
          lastSyncAt: timestamp,
          ...(headExists(root) ? { lastSyncHead: getHeadSha(root) } : {}),
          snapshot,
        });
        setRuntimeState(this.runtimeState, {
          syncStatus: 'idle',
          lastSyncAt: timestamp,
          lastError: undefined,
        });
        return this.readState();
      }

      const workingSnapshot = listWorkingSnapshot(root);
      const localContents = new Map<string, Buffer>();
      for (const path of Object.keys(workingSnapshot)) {
        const content = readLocalFileBuffer(root, path);
        if (content) {
          localContents.set(path, content);
        }
      }

      const resolutions = this.resolveChangedPaths(root, config.branch, baseSnapshot, workingSnapshot, remoteSnapshot);
      const managedExistingPaths = new Set<string>([
        ...Object.keys(workingSnapshot),
        ...Object.keys(remoteSnapshot),
        ...Object.keys(baseSnapshot),
      ]);

      for (const path of Object.keys(workingSnapshot)) {
        deleteFileIfExists(join(root, path), root);
      }

      this.checkoutRemoteBase(root, config.branch, true);

      const finalPaths = new Set<string>(Object.keys(remoteSnapshot));
      for (const resolution of resolutions) {
        const timestampForRecovery = timestamp;
        const localContent = localContents.get(resolution.path) ?? null;
        const remoteContent = resolution.remoteExists ? readRemoteFileBuffer(root, config.branch, resolution.path) : null;

        if (resolution.winner === 'remote') {
          if (resolution.localExists && localContent && (!remoteContent || !localContent.equals(remoteContent))) {
            this.writeRecoveryCopy(resolution.path, localContent, timestampForRecovery);
          }

          if (!resolution.remoteExists) {
            finalPaths.delete(resolution.path);
            deleteFileIfExists(join(root, resolution.path), root);
          }
          continue;
        }

        if (resolution.remoteExists && remoteContent && (!localContent || !remoteContent.equals(localContent))) {
          this.writeRecoveryCopy(resolution.path, remoteContent, timestampForRecovery);
        }

        if (!resolution.localExists || !localContent) {
          finalPaths.delete(resolution.path);
          deleteFileIfExists(join(root, resolution.path), root);
          continue;
        }

        const absolutePath = join(root, resolution.path);
        ensureParentDirectory(absolutePath);
        writeFileSync(absolutePath, localContent);
        finalPaths.add(resolution.path);
      }

      for (const path of managedExistingPaths) {
        if (!finalPaths.has(path)) {
          deleteFileIfExists(join(root, path), root);
        }
      }

      ensureBootstrapFiles(root);
      this.stageAndCommitIfNeeded(root, config.branch, timestamp);

      const snapshot = listWorkingSnapshot(root);
      writeStoredState(this.localStateFilePath, {
        version: SNAPSHOT_VERSION,
        repoUrl: config.repoUrl,
        branch: config.branch,
        lastSyncAt: timestamp,
        ...(headExists(root) ? { lastSyncHead: getHeadSha(root) } : {}),
        snapshot,
      });

      setRuntimeState(this.runtimeState, {
        syncStatus: 'idle',
        lastSyncAt: timestamp,
        lastError: undefined,
      });
      return this.readState();
    } catch (error) {
      setRuntimeState(this.runtimeState, {
        syncStatus: 'error',
        lastError: error instanceof Error ? error.message : String(error),
      });
      return this.readState();
    } finally {
      this.syncInProgress = false;
    }
  }

  startSyncLoop(intervalMs: number = KNOWLEDGE_BASE_SYNC_INTERVAL_MS): void {
    if (this.interval || process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
      return;
    }

    this.interval = setInterval(() => {
      try {
        this.syncNow();
      } catch {
        // syncNow already records failure state; never crash the loop.
      }
    }, intervalMs);
    this.interval.unref?.();
  }

  stopSyncLoop(): void {
    if (!this.interval) {
      return;
    }

    clearInterval(this.interval);
    this.interval = null;
  }
}

function managerKey(options: KnowledgeBaseManagerOptions = {}): string {
  return `${resolve(options.stateRoot ?? getStateRoot())}::${resolve(options.configRoot ?? getConfigRoot())}`;
}

export function getKnowledgeBaseManager(options: KnowledgeBaseManagerOptions = {}): KnowledgeBaseManager {
  const key = managerKey(options);
  const existing = managerRegistry.get(key);
  if (existing) {
    return existing;
  }

  const manager = new KnowledgeBaseManager(options);
  managerRegistry.set(key, manager);
  return manager;
}

export function readKnowledgeBaseState(options: KnowledgeBaseManagerOptions = {}): KnowledgeBaseState {
  return getKnowledgeBaseManager(options).readKnowledgeBaseState();
}

export function updateKnowledgeBase(input: UpdateKnowledgeBaseInput, options: KnowledgeBaseManagerOptions = {}): KnowledgeBaseState {
  return getKnowledgeBaseManager(options).updateKnowledgeBase(input);
}

export function syncKnowledgeBaseNow(options: KnowledgeBaseManagerOptions = {}): KnowledgeBaseState {
  return getKnowledgeBaseManager(options).syncNow();
}

export function startKnowledgeBaseSyncLoop(options: KnowledgeBaseManagerOptions & { intervalMs?: number } = {}): void {
  getKnowledgeBaseManager(options).startSyncLoop(options.intervalMs);
}

export function stopKnowledgeBaseSyncLoop(options: KnowledgeBaseManagerOptions = {}): void {
  getKnowledgeBaseManager(options).stopSyncLoop();
}
