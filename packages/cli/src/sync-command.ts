import { spawnSync } from 'child_process';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative, resolve } from 'path';
import {
  getPiAgentRuntimeDir,
  getStateRoot,
  mergeConversationAttentionStateDocuments,
} from '@personal-agent/core';
import {
  emitDaemonEventNonFatal,
  getDaemonConfigFilePath,
  getDaemonStatus,
  loadDaemonConfig,
  pingDaemon,
  startDaemonDetached,
  stopDaemonGracefully,
} from '@personal-agent/daemon';
import { bullet, dim, keyValue, section, success, warning } from './ui.js';

const DEFAULT_SYNC_BRANCH = 'main';
const DEFAULT_SYNC_REMOTE = 'origin';
const DEFAULT_PROFILE_CONFIG_JSON = '{\n  "defaultProfile": "shared"\n}\n';
const CONVERSATION_ATTENTION_MERGE_DRIVER = 'personal-agent-conversation-attention';

function syncUsageText(): string {
  return 'Usage: pa sync [status|run|setup|help] [args...]';
}

function syncSetupUsageText(): string {
  return 'Usage: pa sync setup --repo <git-url> [--branch <name>] [--fresh|--bootstrap] [--repo-dir <path>]';
}

function syncStatusUsageText(): string {
  return 'Usage: pa sync status';
}

function syncRunUsageText(): string {
  return 'Usage: pa sync run';
}

function syncMergeConversationAttentionUsageText(): string {
  return 'Usage: pa sync merge-conversation-attention <base-file> <current-file> <other-file>';
}

function isCliHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveCurrentCliEntrypoint(): string {
  const entrypoint = toOptionalString(process.argv[1]);
  if (!entrypoint) {
    throw new Error('Unable to resolve the current CLI entrypoint for sync merge driver setup.');
  }

  return resolve(entrypoint);
}

function buildConversationAttentionMergeDriverCommand(): string {
  return [
    shellQuote(process.execPath),
    shellQuote(resolveCurrentCliEntrypoint()),
    'sync',
    'merge-conversation-attention',
    '%O',
    '%A',
    '%B',
  ].join(' ');
}

function readJsonFileIfExists(path: string): unknown | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  return JSON.parse(readFileSync(path, 'utf-8')) as unknown;
}

function runGit(repoDir: string, args: string[], allowFailure = false): { code: number; stdout: string; stderr: string } {
  const result = spawnSync('git', ['-C', repoDir, ...args], { encoding: 'utf-8' });

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

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

function ensureSymlink(sourcePath: string, targetPath: string): void {
  const sourceExists = existsSync(sourcePath) || lstatSyncSafe(sourcePath) !== undefined;

  if (sourceExists) {
    const sourceStats = lstatSyncSafe(sourcePath);
    if (sourceStats?.isSymbolicLink()) {
      const linkTarget = resolve(dirname(sourcePath), readlinkSync(sourcePath));
      if (linkTarget === targetPath) {
        return;
      }

      rmSync(sourcePath, { force: true });
    } else {
      const targetStats = statSync(targetPath);
      if (targetStats.isDirectory()) {
        rmSync(sourcePath, { recursive: true, force: true });
      } else {
        rmSync(sourcePath, { force: true });
      }
    }
  }

  ensureDirectory(dirname(sourcePath));
  const relativeTarget = relative(dirname(sourcePath), targetPath);
  const targetStats = statSync(targetPath);
  symlinkSync(relativeTarget, sourcePath, targetStats.isDirectory() ? 'dir' : 'file');
}

function lstatSyncSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function movePathIntoSyncRoot(stateRoot: string, syncRoot: string, relativePath: string): void {
  const sourcePath = join(stateRoot, relativePath);
  const targetPath = join(syncRoot, relativePath);

  const sourceStats = lstatSyncSafe(sourcePath);
  if (sourceStats?.isSymbolicLink()) {
    const existingTarget = resolve(dirname(sourcePath), readlinkSync(sourcePath));
    if (existingTarget === targetPath && existsSync(targetPath)) {
      return;
    }

    rmSync(sourcePath, { force: true });
  }

  if (existsSync(sourcePath)) {
    ensureDirectory(dirname(targetPath));

    if (!existsSync(targetPath)) {
      renameSync(sourcePath, targetPath);
    } else {
      const sourceIsDir = statSync(sourcePath).isDirectory();
      const targetIsDir = statSync(targetPath).isDirectory();

      if (sourceIsDir !== targetIsDir) {
        throw new Error(`Cannot merge ${sourcePath} into ${targetPath}: type mismatch`);
      }

      if (sourceIsDir) {
        cpSync(sourcePath, targetPath, { recursive: true, force: true });
        rmSync(sourcePath, { recursive: true, force: true });
      } else {
        cpSync(sourcePath, targetPath, { force: true });
        rmSync(sourcePath, { force: true });
      }
    }
  }

  if (!existsSync(targetPath)) {
    if (relativePath.endsWith('.json')) {
      ensureDirectory(dirname(targetPath));
      writeFileSync(targetPath, DEFAULT_PROFILE_CONFIG_JSON);
    } else {
      ensureDirectory(targetPath);
    }
  }

  ensureSymlink(sourcePath, targetPath);
}

function readFileUtf8Safe(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function ensureLocalDefaultProfileConfig(stateRoot: string, syncRoot: string): string {
  const localConfigPath = join(stateRoot, 'config', 'config.json');
  const legacySyncedConfigPath = join(syncRoot, 'config', 'config.json');
  const fallbackContent = readFileUtf8Safe(localConfigPath)
    ?? readFileUtf8Safe(legacySyncedConfigPath)
    ?? DEFAULT_PROFILE_CONFIG_JSON;

  if (lstatSyncSafe(localConfigPath)?.isSymbolicLink()) {
    rmSync(localConfigPath, { force: true });
  }

  if (existsSync(localConfigPath)) {
    if (statSync(localConfigPath).isDirectory()) {
      throw new Error(`Expected file at ${localConfigPath}, found directory`);
    }

    return localConfigPath;
  }

  ensureDirectory(dirname(localConfigPath));
  writeFileSync(localConfigPath, fallbackContent);
  return localConfigPath;
}

function removeLegacySyncedDefaultProfileConfig(syncRoot: string): void {
  const legacyConfigPath = join(syncRoot, 'config', 'config.json');
  if (lstatSyncSafe(legacyConfigPath)) {
    rmSync(legacyConfigPath, { force: true, recursive: true });
  }

  const legacyConfigDir = join(syncRoot, 'config');
  const legacyConfigDirStats = lstatSyncSafe(legacyConfigDir);
  if (!legacyConfigDirStats?.isDirectory()) {
    return;
  }

  if (readdirSync(legacyConfigDir).length === 0) {
    rmSync(legacyConfigDir, { force: true, recursive: true });
  }
}

function syncRepoGitignore(): string {
  return `# personal-agent sync repo (managed by pa sync setup)\n\n*\n!.gitignore\n!.gitattributes\n!README.md\n\n# Whitelist durable-sync roots so new files/directories under them sync by default\n!profiles/\n!profiles/**\n\n!pi-agent/\n!pi-agent/**\n\n# Never sync machine-local runtime leftovers from older releases\n.DS_Store\n**/.DS_Store\npi-agent/AGENTS.md\npi-agent/APPEND_SYSTEM.md\npi-agent/SYSTEM.md\npi-agent/auth.json\npi-agent/models.json\npi-agent/settings.json\npi-agent/bin/\npi-agent/session-meta-index.json\n`;
}

export function syncRepoGitattributes(): string {
  return `* text=auto\n\n# Append-only session JSONL transcripts merge best with union\npi-agent/sessions/**/*.jsonl text eol=lf merge=union\n\n# Conversation attention state should merge by per-conversation max/union semantics\npi-agent/state/conversation-attention/*.json text eol=lf merge=${CONVERSATION_ATTENTION_MERGE_DRIVER}\n`;
}

function configureManagedMergeDrivers(syncRoot: string): void {
  runGit(syncRoot, [
    'config',
    `merge.${CONVERSATION_ATTENTION_MERGE_DRIVER}.name`,
    'personal-agent conversation attention merge',
  ]);
  runGit(syncRoot, [
    'config',
    `merge.${CONVERSATION_ATTENTION_MERGE_DRIVER}.driver`,
    buildConversationAttentionMergeDriverCommand(),
  ]);
}

function syncRepoReadme(): string {
  return `# personal-agent sync repo\n\nManaged by \`pa sync setup\`.\n\nThis repo tracks durable cross-machine state from sync roots:\n\n- \`profiles/**\`\n- \`pi-agent/**\` (durable sessions/state only)\n\nBuilt-in merge handling is configured for:\n\n- append-only session transcripts under \`pi-agent/sessions/**/*.jsonl\`\n- conversation attention state under \`pi-agent/state/conversation-attention/*.json\`\n\nMachine-local runtime files such as auth, settings, generated prompt materialization, and package bins now live outside the sync repo under the local state root. Machine-local config (including \`config/config.json\` default profile selection) is intentionally not synced.\n`;
}

function migrateLegacyPiAgentRuntimeArtifacts(stateRoot: string, syncRoot: string): void {
  const syncedPiAgentDir = join(syncRoot, 'pi-agent');
  const runtimeAgentDir = getPiAgentRuntimeDir(stateRoot);

  ensureDirectory(runtimeAgentDir);

  for (const relativePath of ['auth.json', 'models.json', 'settings.json', 'session-meta-index.json', 'bin']) {
    const sourcePath = join(syncedPiAgentDir, relativePath);
    const sourceStats = lstatSyncSafe(sourcePath);
    if (!sourceStats) {
      continue;
    }

    const targetPath = join(runtimeAgentDir, relativePath);
    const targetStats = lstatSyncSafe(targetPath);

    if (!targetStats) {
      try {
        renameSync(sourcePath, targetPath);
      } catch {
        cpSync(sourcePath, targetPath, { recursive: sourceStats.isDirectory(), force: true });
        rmSync(sourcePath, { force: true, recursive: true });
      }
      continue;
    }

    if (sourceStats.isDirectory() && targetStats.isDirectory()) {
      cpSync(sourcePath, targetPath, { recursive: true, force: true });
    }

    rmSync(sourcePath, { force: true, recursive: true });
  }

  for (const relativePath of ['AGENTS.md', 'APPEND_SYSTEM.md', 'SYSTEM.md']) {
    const targetPath = join(syncedPiAgentDir, relativePath);
    if (!lstatSyncSafe(targetPath)) {
      continue;
    }

    rmSync(targetPath, { force: true, recursive: true });
  }
}

function writeManagedSyncRepoFiles(syncRoot: string): void {
  writeFileSync(join(syncRoot, '.gitignore'), syncRepoGitignore());
  writeFileSync(join(syncRoot, '.gitattributes'), syncRepoGitattributes());
  writeFileSync(join(syncRoot, 'README.md'), syncRepoReadme());
}

function commitIfNeeded(syncRoot: string, message: string): boolean {
  runGit(syncRoot, ['add', '-A']);
  const staged = runGit(syncRoot, ['diff', '--cached', '--quiet'], true);

  if (staged.code === 0) {
    return false;
  }

  if (staged.code !== 1) {
    throw new Error(staged.stderr || staged.stdout || 'Failed to inspect staged changes');
  }

  runGit(syncRoot, ['commit', '-m', message]);
  return true;
}

function configureRemote(syncRoot: string, remoteUrl: string, remoteName = DEFAULT_SYNC_REMOTE): void {
  const existing = runGit(syncRoot, ['remote', 'get-url', remoteName], true);

  if (existing.code === 0) {
    runGit(syncRoot, ['remote', 'set-url', remoteName, remoteUrl]);
    return;
  }

  runGit(syncRoot, ['remote', 'add', remoteName, remoteUrl]);
}

function ensureGitRepo(syncRoot: string, branch: string): void {
  if (!existsSync(join(syncRoot, '.git'))) {
    runGit(syncRoot, ['init', '-b', branch]);
  }

  runGit(syncRoot, ['checkout', '-B', branch]);
}

function configureDaemonSyncModule(input: {
  repoDir: string;
  branch: string;
  remote: string;
}): string {
  const configPath = getDaemonConfigFilePath();
  const raw = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf-8')) as unknown : {};
  const root = isRecord(raw) ? raw : {};
  const modules = isRecord(root.modules) ? root.modules : {};
  const sync = isRecord(modules.sync) ? modules.sync : {};

  modules.sync = {
    ...sync,
    enabled: true,
    repoDir: input.repoDir,
    branch: input.branch,
    remote: input.remote,
    intervalSeconds: parseNumber(sync.intervalSeconds, 120),
    autoResolveWithAgent: sync.autoResolveWithAgent === false ? false : true,
    conflictResolverTaskSlug: toOptionalString(sync.conflictResolverTaskSlug) ?? 'sync-conflict-resolver',
    resolverCooldownMinutes: parseNumber(sync.resolverCooldownMinutes, 30),
    autoResolveErrorsWithAgent: sync.autoResolveErrorsWithAgent === false ? false : true,
    errorResolverTaskSlug: toOptionalString(sync.errorResolverTaskSlug) ?? 'sync-error-resolver',
    errorResolverCooldownMinutes: parseNumber(sync.errorResolverCooldownMinutes, 30),
  };

  root.modules = modules;

  ensureDirectory(dirname(configPath));
  writeFileSync(configPath, `${JSON.stringify(root, null, 2)}\n`);
  return configPath;
}

function parseSyncSetupArgs(args: string[]): {
  repoUrl: string;
  branch: string;
  mode: 'fresh' | 'bootstrap';
  repoDir: string;
} {
  let repoUrl: string | undefined;
  let branch = DEFAULT_SYNC_BRANCH;
  let mode: 'fresh' | 'bootstrap' = 'fresh';
  let repoDir: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string;

    if (arg === '--repo') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(syncSetupUsageText());
      }

      repoUrl = value;
      index += 1;
      continue;
    }

    if (arg === '--branch') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(syncSetupUsageText());
      }

      branch = value;
      index += 1;
      continue;
    }

    if (arg === '--repo-dir') {
      const value = args[index + 1];
      if (!value) {
        throw new Error(syncSetupUsageText());
      }

      repoDir = resolve(value);
      index += 1;
      continue;
    }

    if (arg === '--fresh') {
      mode = 'fresh';
      continue;
    }

    if (arg === '--bootstrap') {
      mode = 'bootstrap';
      continue;
    }

    throw new Error(syncSetupUsageText());
  }

  if (!repoUrl || repoUrl.trim().length === 0) {
    throw new Error(syncSetupUsageText());
  }

  const stateRoot = getStateRoot();

  return {
    repoUrl: repoUrl.trim(),
    branch: branch.trim() || DEFAULT_SYNC_BRANCH,
    mode,
    repoDir: repoDir ?? join(stateRoot, 'sync'),
  };
}

async function ensureDaemonAvailable(): Promise<void> {
  if (await pingDaemon()) {
    return;
  }

  await startDaemonDetached();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await pingDaemon()) {
      return;
    }

    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }

  throw new Error('Daemon did not become available. Start it with: pa daemon start');
}

async function setupSyncCommand(args: string[]): Promise<number> {
  const parsed = parseSyncSetupArgs(args);
  const stateRoot = getStateRoot();
  const syncRoot = parsed.repoDir;

  ensureDirectory(syncRoot);
  movePathIntoSyncRoot(stateRoot, syncRoot, 'profiles');
  movePathIntoSyncRoot(stateRoot, syncRoot, 'pi-agent');
  migrateLegacyPiAgentRuntimeArtifacts(stateRoot, syncRoot);
  const localProfileConfigPath = ensureLocalDefaultProfileConfig(stateRoot, syncRoot);
  removeLegacySyncedDefaultProfileConfig(syncRoot);
  writeManagedSyncRepoFiles(syncRoot);

  ensureGitRepo(syncRoot, parsed.branch);
  configureManagedMergeDrivers(syncRoot);
  configureRemote(syncRoot, parsed.repoUrl, DEFAULT_SYNC_REMOTE);

  if (parsed.mode === 'bootstrap') {
    commitIfNeeded(syncRoot, 'chore: bootstrap local sync snapshot');

    const fetch = runGit(syncRoot, ['fetch', DEFAULT_SYNC_REMOTE, parsed.branch], true);
    if (fetch.code === 0) {
      const merge = runGit(
        syncRoot,
        ['merge', '--no-edit', '--allow-unrelated-histories', `${DEFAULT_SYNC_REMOTE}/${parsed.branch}`],
        true,
      );

      if (merge.code !== 0) {
        const conflicts = runGit(syncRoot, ['diff', '--name-only', '--diff-filter=U'], true)
          .stdout
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);

        throw new Error(
          conflicts.length > 0
            ? `Bootstrap merge conflict in sync repo (${conflicts.length} files):\n${conflicts.join('\n')}`
            : (merge.stderr || merge.stdout || 'Bootstrap merge failed'),
        );
      }
    }
  } else {
    commitIfNeeded(syncRoot, 'chore: initialize sync repository');
  }

  runGit(syncRoot, ['push', '-u', DEFAULT_SYNC_REMOTE, parsed.branch]);

  const daemonConfigPath = configureDaemonSyncModule({
    repoDir: syncRoot,
    branch: parsed.branch,
    remote: DEFAULT_SYNC_REMOTE,
  });

  if (await pingDaemon()) {
    await stopDaemonGracefully();
  }

  await ensureDaemonAvailable();
  await emitDaemonEventNonFatal({
    type: 'sync.run.requested',
    source: 'cli:sync-setup',
    payload: {
      reason: 'setup',
    },
  });

  console.log(success('Sync setup complete'));
  console.log(keyValue('State root', stateRoot));
  console.log(keyValue('Sync repo', syncRoot));
  console.log(keyValue('Remote', parsed.repoUrl));
  console.log(keyValue('Branch', parsed.branch));
  console.log(keyValue('Mode', parsed.mode));
  console.log(keyValue('Daemon config', daemonConfigPath));
  console.log(keyValue('Profile config', `${localProfileConfigPath} (machine-local)`));
  console.log(`  ${warning('A sync run was requested from the daemon.')}`);

  return 0;
}

async function syncStatusCommand(args: string[]): Promise<number> {
  if (args.length > 0) {
    throw new Error(syncStatusUsageText());
  }

  const daemonConfig = loadDaemonConfig();
  const syncConfig = daemonConfig.modules.sync;

  if (!syncConfig) {
    console.log(section('Sync status'));
    console.log(dim('Sync module is not configured. Run: pa sync setup --repo <git-url>'));
    return 1;
  }

  console.log(section('Sync status'));
  console.log(keyValue('Enabled', syncConfig.enabled ? 'yes' : 'no'));
  console.log(keyValue('Repo', syncConfig.repoDir));
  console.log(keyValue('Remote', syncConfig.remote));
  console.log(keyValue('Branch', syncConfig.branch));
  console.log(keyValue('Interval', `${syncConfig.intervalSeconds}s`));
  console.log(keyValue('Conflict resolver', syncConfig.autoResolveWithAgent ? 'enabled' : 'disabled'));
  console.log(keyValue('Error resolver', syncConfig.autoResolveErrorsWithAgent ? 'enabled' : 'disabled'));

  if (existsSync(join(syncConfig.repoDir, '.git'))) {
    const branch = runGit(syncConfig.repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'], true);
    const status = runGit(syncConfig.repoDir, ['status', '--porcelain'], true);
    const lastCommit = runGit(syncConfig.repoDir, ['log', '-1', '--pretty=%h %ad %s', '--date=iso'], true);

    console.log('');
    console.log(section('Git'));
    console.log(keyValue('Current branch', branch.code === 0 ? (branch.stdout || dim('unknown')) : dim('unknown')));
    console.log(keyValue('Dirty entries', status.code === 0 ? String(status.stdout ? status.stdout.split(/\r?\n/).filter(Boolean).length : 0) : dim('unknown')));
    console.log(keyValue('Last commit', lastCommit.code === 0 ? (lastCommit.stdout || dim('none')) : dim('unknown')));
  } else {
    console.log('');
    console.log(warning(`Git repo not initialized at ${syncConfig.repoDir}`));
  }

  if (await pingDaemon()) {
    const status = await getDaemonStatus();
    const module = status.modules.find((entry) => entry.name === 'sync');

    if (module?.detail) {
      console.log('');
      console.log(section('Daemon module detail'));
      const detail = module.detail as Record<string, unknown>;
      console.log(keyValue('Last run', toOptionalString(detail.lastRunAt) ?? dim('never')));
      console.log(keyValue('Last success', toOptionalString(detail.lastSuccessAt) ?? dim('never')));
      console.log(keyValue('Last commit', toOptionalString(detail.lastCommitAt) ?? dim('none')));
      console.log(keyValue('Last conflict', toOptionalString(detail.lastConflictAt) ?? dim('none')));
      console.log(keyValue('Last conflict resolver', toOptionalString(detail.lastResolverStartedAt) ?? dim('none')));
      console.log(keyValue('Last error resolver', toOptionalString(detail.lastErrorResolverStartedAt) ?? dim('none')));
      if (toOptionalString(detail.lastError)) {
        console.log(keyValue('Last error', toOptionalString(detail.lastError) as string));
      }
    }
  }

  return 0;
}

async function syncRunCommand(args: string[]): Promise<number> {
  if (args.length > 0) {
    throw new Error(syncRunUsageText());
  }

  await ensureDaemonAvailable();
  await emitDaemonEventNonFatal({
    type: 'sync.run.requested',
    source: 'cli:sync-run',
    payload: {
      reason: 'manual',
    },
  });

  console.log(success('Requested sync run from daemon'));
  return 0;
}

export async function mergeConversationAttentionFilesCommand(args: string[]): Promise<number> {
  if (args.length !== 3 || args.some((arg) => isCliHelpToken(arg))) {
    throw new Error(syncMergeConversationAttentionUsageText());
  }

  const [basePath, currentPath, otherPath] = args.map((arg) => resolve(arg));
  const merged = mergeConversationAttentionStateDocuments({
    documents: [
      readJsonFileIfExists(basePath),
      readJsonFileIfExists(currentPath),
      readJsonFileIfExists(otherPath),
    ],
  });

  writeFileSync(currentPath, `${JSON.stringify(merged, null, 2)}\n`);
  return 0;
}

function printSyncHelp(): void {
  console.log(section('Sync commands'));
  console.log('');
  console.log(`Usage: pa sync [status|run|setup|help] [args...]

Commands:
  status                                      Show sync configuration and daemon sync status
  run                                         Trigger an immediate daemon sync cycle
  setup --repo <git-url> [--branch <name>] [--fresh|--bootstrap] [--repo-dir <path>]
                                              Configure git sync, move profiles/pi-agent state under <state>/sync, and enable daemon auto-sync
  help                                        Show sync help
`);
  console.log(bullet('Fresh mode initializes from current local state and pushes to remote.'));
  console.log(bullet('Bootstrap mode fetches and merges from an existing remote branch.'));
}

export async function syncCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand || isCliHelpToken(subcommand)) {
    if (subcommand && rest.length > 0) {
      throw new Error(syncUsageText());
    }

    printSyncHelp();
    return 0;
  }

  if (subcommand === 'setup') {
    return setupSyncCommand(rest);
  }

  if (subcommand === 'status') {
    return syncStatusCommand(rest);
  }

  if (subcommand === 'run') {
    return syncRunCommand(rest);
  }

  if (subcommand === 'merge-conversation-attention') {
    return mergeConversationAttentionFilesCommand(rest);
  }

  throw new Error(syncUsageText());
}
