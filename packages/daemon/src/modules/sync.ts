import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { hostname } from 'os';
import { join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import {
  createProjectActivityEntry,
  getPiAgentRuntimeDir,
  writeProfileActivityEntry,
  type ProjectActivityEntryDocument,
} from '@personal-agent/core';
import { getRepoRoot } from '@personal-agent/resources';
import type { SyncModuleConfig } from '../config.js';
import type { DaemonEvent } from '../types.js';
import type { DaemonModule, DaemonModuleContext } from './types.js';
import { runCommand } from './command.js';

const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/;
const CONVERSATION_ATTENTION_MERGE_DRIVER = 'personal-agent-conversation-attention';

interface SyncModuleState {
  running: boolean;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastCommitAt?: string;
  lastError?: string;
  lastConflictFiles: string[];
  lastConflictAt?: string;
  lastConflictFingerprint?: string;
  lastResolverStartedAt?: string;
  lastResolverResult?: string;
  lastErrorResolverStartedAt?: string;
  lastErrorResolverResult?: string;
  lastErrorResolverFingerprint?: string;
  lastNotifiedErrorFingerprint?: string;
  lastNotifiedConflictFingerprint?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function trimOutput(value: string, limit = 600): string {
  const trimmed = value.trim();
  if (trimmed.length <= limit) {
    return trimmed;
  }

  return `${trimmed.slice(0, limit - 1)}…`;
}

function summarizeForLine(value: string, limit = 120): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= limit) {
    return singleLine;
  }

  return `${singleLine.slice(0, limit - 1)}…`;
}

function normalizeConflictFingerprint(conflicts: string[]): string {
  return [...conflicts].sort((left, right) => left.localeCompare(right)).join('\n');
}

function buildSyncCommitMessage(timestampIso: string): string {
  const machine = hostname().split('.')[0] || 'machine';
  return `sync(${machine}): ${timestampIso}`;
}

function buildConflictResolverPrompt(repoDir: string, branch: string, remote: string, conflicts: string[]): string {
  const conflictList = conflicts.map((file) => `- ${file}`).join('\n');

  return [
    `Resolve git merge conflicts in ${repoDir}.`,
    '',
    `Remote/branch: ${remote}/${branch}`,
    '',
    'Conflicted files:',
    conflictList.length > 0 ? conflictList : '- (unknown)',
    '',
    'Instructions:',
    '- preserve all valid conversation/session data when possible, especially for JSONL transcript files',
    '- resolve all merge conflicts',
    '- run git add for resolved files',
    '- complete merge/rebase if in progress',
    '- commit the resolution',
    '- push to remote branch',
    '- summarize what was resolved',
  ].join('\n');
}

function buildErrorResolverPrompt(input: {
  repoDir: string;
  branch: string;
  remote: string;
  phase: string;
  trigger: string;
  error: string;
}): string {
  return [
    `Diagnose and recover a personal-agent git sync failure in ${input.repoDir}.`,
    '',
    `Phase: ${input.phase}`,
    `Trigger: ${input.trigger}`,
    `Remote/branch: ${input.remote}/${input.branch}`,
    '',
    'Latest error:',
    input.error,
    '',
    'Instructions:',
    '- inspect repository state (status, branch, remotes, and pending operations)',
    '- determine root cause and apply the minimal safe fix',
    '- do not discard durable state data unless absolutely required',
    '- run the relevant git commands to verify recovery (fetch/merge/push as appropriate)',
    '- if credentials/network are the blocker, capture precise remediation steps',
    '- summarize what changed and what remains blocked',
  ].join('\n');
}

function managedSyncRepoGitignore(): string {
  return `# personal-agent sync repo (managed by pa sync setup)\n\n*\n!.gitignore\n!.gitattributes\n!README.md\n\n# Durable profile definitions\n!profiles/\nprofiles/*\n!profiles/*.json\n\n# Durable kind-based resources\n!agents/\n!agents/**\n!settings/\n!settings/**\n!models/\n!models/**\n!skills/\n!skills/**\n!notes/\n!notes/**\n!tasks/\n!tasks/**\n!projects/\n!projects/**\n\n# Portable conversation state\n!pi-agent/\npi-agent/*\n!pi-agent/sessions/\n!pi-agent/sessions/**\n!pi-agent/state/\n!pi-agent/state/conversation-attention/\n!pi-agent/state/conversation-attention/**\n\n# Never sync machine-local runtime leftovers\n.DS_Store\n**/.DS_Store\n`;
}

function managedSyncRepoGitattributes(): string {
  return `* text=auto\n\n# Append-only session JSONL transcripts merge best with union\npi-agent/sessions/**/*.jsonl text eol=lf merge=union\n\n# Conversation attention read-state merges semantically across machines\npi-agent/state/conversation-attention/*.json text eol=lf merge=${CONVERSATION_ATTENTION_MERGE_DRIVER}\n`;
}

function readFileUtf8(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function resolveCliMergeDriverEntrypoint(): string {
  const entrypoint = resolve(fileURLToPath(new URL('../../../cli/dist/index.js', import.meta.url)));
  if (!existsSync(entrypoint)) {
    throw new Error(`Cannot configure conversation attention merge driver; missing CLI entrypoint at ${entrypoint}`);
  }

  return entrypoint;
}

function conversationAttentionMergeDriverCommand(): string {
  return `${shellQuote(process.execPath)} ${shellQuote(resolveCliMergeDriverEntrypoint())} sync merge-conversation-attention "%O" "%A" "%B"`;
}

async function configureManagedMergeDrivers(repoDir: string): Promise<void> {
  const mergeDriverCommand = conversationAttentionMergeDriverCommand();
  const commands: Array<[string, string]> = [
    [`merge.${CONVERSATION_ATTENTION_MERGE_DRIVER}.name`, 'personal-agent conversation attention'],
    [`merge.${CONVERSATION_ATTENTION_MERGE_DRIVER}.driver`, mergeDriverCommand],
  ];

  for (const [key, value] of commands) {
    const current = await runGit(repoDir, ['config', '--local', '--get', key], 30_000);
    if (current.code === 0 && current.stdout.trim() === value) {
      continue;
    }

    const result = await runGit(repoDir, ['config', '--local', key, value], 30_000);
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || `Failed to configure git merge driver ${key}`);
    }
  }
}

async function ensureManagedMergeHandling(repoDir: string): Promise<void> {
  const managedFiles = [
    { path: join(repoDir, '.gitignore'), content: managedSyncRepoGitignore() },
    { path: join(repoDir, '.gitattributes'), content: managedSyncRepoGitattributes() },
  ];

  for (const file of managedFiles) {
    if (readFileUtf8(file.path) !== file.content) {
      writeFileSync(file.path, file.content);
    }
  }

  await configureManagedMergeDrivers(repoDir);
}

async function runGit(repoDir: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await runCommand('git', ['-C', repoDir, ...args], timeoutMs);
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function listConflictedFiles(repoDir: string): Promise<string[]> {
  const result = await runGit(repoDir, ['diff', '--name-only', '--diff-filter=U'], 30_000);
  if (result.code !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => left.localeCompare(right));
}

async function hasStagedChanges(repoDir: string): Promise<boolean> {
  const result = await runGit(repoDir, ['diff', '--cached', '--quiet'], 30_000);
  if (result.code === 0) {
    return false;
  }

  if (result.code === 1) {
    return true;
  }

  throw new Error(result.stderr || result.stdout || 'Failed to inspect staged changes');
}

async function remoteExists(repoDir: string, remote: string): Promise<boolean> {
  const result = await runGit(repoDir, ['remote', 'get-url', remote], 30_000);
  return result.code === 0;
}

function sanitizeProfileName(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.trim();
  return PROFILE_NAME_PATTERN.test(normalized) ? normalized : undefined;
}

function resolveMaintenanceStateRoot(stateRoot: string, profile: string): string {
  return join(stateRoot, 'conversation-maintenance', profile, 'sync-maintenance-state');
}

function ensureMaintenanceAgentRuntimeState(stateRoot: string, profile: string): string {
  const maintenanceStateRoot = resolveMaintenanceStateRoot(stateRoot, profile);
  const sourceRuntimeDir = getPiAgentRuntimeDir(stateRoot);
  const targetRuntimeDir = getPiAgentRuntimeDir(maintenanceStateRoot);

  mkdirSync(targetRuntimeDir, { recursive: true, mode: 0o700 });

  for (const fileName of ['auth.json', 'models.json', 'settings.json']) {
    const sourcePath = join(sourceRuntimeDir, fileName);
    const targetPath = join(targetRuntimeDir, fileName);
    if (!existsSync(sourcePath)) {
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }

  return maintenanceStateRoot;
}

function buildResolverAgentCommand(input: {
  stateRoot: string;
  profile: string;
  prompt: string;
}): string[] {
  const maintenanceStateRoot = ensureMaintenanceAgentRuntimeState(input.stateRoot, input.profile);
  const profilesRoot = process.env.PERSONAL_AGENT_PROFILES_ROOT?.trim() || join(input.stateRoot, 'profiles');
  const cliEntrypoint = join(getRepoRoot(), 'packages', 'cli', 'dist', 'index.js');

  return [
    'env',
    `PERSONAL_AGENT_STATE_ROOT=${maintenanceStateRoot}`,
    `PERSONAL_AGENT_PROFILES_ROOT=${profilesRoot}`,
    `PERSONAL_AGENT_REPO_ROOT=${getRepoRoot()}`,
    process.execPath,
    cliEntrypoint,
    'tui',
    '--profile',
    input.profile,
    '-p',
    input.prompt,
  ];
}

function inferProfileFromTaskDir(taskDir: string): string | undefined {
  const normalized = resolve(taskDir);
  const segments = normalized.split(sep).filter((segment) => segment.length > 0);
  const profilesIndex = segments.lastIndexOf('profiles');
  if (profilesIndex < 0) {
    return undefined;
  }

  return sanitizeProfileName(segments[profilesIndex + 1]);
}

function resolveActivityProfile(context: DaemonModuleContext): string {
  return inferProfileFromTaskDir(context.config.modules.tasks.taskDir)
    ?? sanitizeProfileName(process.env.PERSONAL_AGENT_ACTIVE_PROFILE)
    ?? sanitizeProfileName(process.env.PERSONAL_AGENT_PROFILE)
    ?? 'shared';
}

function sanitizeActivityIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'activity';
}

function createActivityId(prefix: string, createdAt: string): string {
  const stamp = createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${sanitizeActivityIdSegment(stamp)}-${sanitizeActivityIdSegment(random)}`;
}

function triggerLabel(event: DaemonEvent): string {
  return event.source
    ? `${event.type} (${event.source})`
    : event.type;
}

function writeSyncActivity(
  context: DaemonModuleContext,
  profile: string,
  input: {
    idPrefix: string;
    kind: ProjectActivityEntryDocument['kind'];
    createdAt?: string;
    summary: string;
    details?: string;
  },
): void {
  const createdAt = input.createdAt ?? nowIso();

  try {
    writeProfileActivityEntry({
      stateRoot: context.paths.stateRoot,
      profile,
      entry: createProjectActivityEntry({
        id: createActivityId(input.idPrefix, createdAt),
        createdAt,
        profile,
        kind: input.kind,
        summary: input.summary,
        details: input.details,
        notificationState: 'none',
      }),
    });
  } catch (error) {
    context.logger.warn(`sync activity write failed: ${(error as Error).message}`);
  }
}

function formatConflictDetails(config: SyncModuleConfig, conflicts: string[], trigger: string): string {
  const conflictLines = conflicts.length > 0
    ? conflicts.map((file) => `- ${file}`)
    : ['- (unknown)'];

  return [
    `Repository: ${config.repoDir}`,
    `Remote/branch: ${config.remote}/${config.branch}`,
    `Trigger: ${trigger}`,
    '',
    'Conflicted files:',
    ...conflictLines,
    '',
    config.autoResolveWithAgent
      ? `Auto resolver is enabled (task: ${config.conflictResolverTaskSlug}).`
      : 'Auto resolver is disabled; resolve conflicts manually.',
  ].join('\n');
}

function maybeNotifySyncError(
  state: SyncModuleState,
  context: DaemonModuleContext,
  config: SyncModuleConfig,
  profile: string,
  event: DaemonEvent,
  phase: string,
  message: string,
): void {
  const normalized = message.trim();
  if (normalized.length === 0) {
    return;
  }

  const fingerprint = `${phase}:${normalized}`;
  if (state.lastNotifiedErrorFingerprint === fingerprint) {
    return;
  }

  state.lastNotifiedErrorFingerprint = fingerprint;

  writeSyncActivity(context, profile, {
    idPrefix: 'sync-error',
    kind: 'service',
    summary: `Sync ${phase} failed: ${summarizeForLine(normalized, 90)}`,
    details: [
      `Repository: ${config.repoDir}`,
      `Remote/branch: ${config.remote}/${config.branch}`,
      `Trigger: ${triggerLabel(event)}`,
      '',
      normalized,
    ].join('\n'),
  });
}

function maybeNotifyConflicts(
  state: SyncModuleState,
  context: DaemonModuleContext,
  config: SyncModuleConfig,
  profile: string,
  event: DaemonEvent,
  conflicts: string[],
): void {
  const fingerprint = normalizeConflictFingerprint(conflicts);
  if (state.lastNotifiedConflictFingerprint === fingerprint) {
    return;
  }

  state.lastNotifiedConflictFingerprint = fingerprint;

  writeSyncActivity(context, profile, {
    idPrefix: 'sync-conflict',
    kind: 'service',
    summary: `Sync blocked by merge conflicts (${conflicts.length} file${conflicts.length === 1 ? '' : 's'}).`,
    details: formatConflictDetails(config, conflicts, triggerLabel(event)),
  });
}

async function startConflictResolverRun(input: {
  config: SyncModuleConfig;
  conflicts: string[];
  profile: string;
  stateRoot: string;
}): Promise<string> {
  const prompt = buildConflictResolverPrompt(input.config.repoDir, input.config.branch, input.config.remote, input.conflicts);

  const result = await runCommand(
    'pa',
    [
      'runs',
      'start',
      input.config.conflictResolverTaskSlug,
      '--cwd',
      input.config.repoDir,
      '--',
      ...buildResolverAgentCommand({
        stateRoot: input.stateRoot,
        profile: input.profile,
        prompt,
      }),
    ],
    60_000,
  );

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pa runs start failed with exit code ${result.code}`);
  }

  return trimOutput(result.stdout || 'started');
}

async function startErrorResolverRun(input: {
  config: SyncModuleConfig;
  phase: string;
  error: string;
  trigger: string;
  cwd: string;
  profile: string;
  stateRoot: string;
}): Promise<string> {
  const prompt = buildErrorResolverPrompt({
    repoDir: input.config.repoDir,
    branch: input.config.branch,
    remote: input.config.remote,
    phase: input.phase,
    trigger: input.trigger,
    error: input.error,
  });

  const result = await runCommand(
    'pa',
    [
      'runs',
      'start',
      input.config.errorResolverTaskSlug,
      '--cwd',
      input.cwd,
      '--',
      ...buildResolverAgentCommand({
        stateRoot: input.stateRoot,
        profile: input.profile,
        prompt,
      }),
    ],
    60_000,
  );

  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `pa runs start failed with exit code ${result.code}`);
  }

  return trimOutput(result.stdout || 'started');
}

export function createSyncModule(config: SyncModuleConfig): DaemonModule {
  const state: SyncModuleState = {
    running: false,
    lastConflictFiles: [],
  };

  async function maybeStartConflictResolver(
    conflicts: string[],
    event: DaemonEvent,
    context: DaemonModuleContext,
    profile: string,
  ): Promise<void> {
    if (!config.autoResolveWithAgent) {
      return;
    }

    const fingerprint = normalizeConflictFingerprint(conflicts);
    const now = nowIso();

    const cooldownMs = Math.max(1, config.resolverCooldownMinutes) * 60_000;
    const canRetryByTime = !state.lastResolverStartedAt
      || (Date.now() - Date.parse(state.lastResolverStartedAt)) >= cooldownMs;
    const shouldStartResolver = state.lastConflictFingerprint !== fingerprint || canRetryByTime;

    if (!shouldStartResolver) {
      return;
    }

    try {
      const resolverResult = await startConflictResolverRun({
        config,
        conflicts,
        profile,
        stateRoot: context.paths.stateRoot,
      });
      state.lastResolverStartedAt = now;
      state.lastResolverResult = resolverResult;
      state.lastConflictFingerprint = fingerprint;
      context.logger.warn(`git sync conflict detected; started resolver run (${resolverResult})`);

      writeSyncActivity(context, profile, {
        idPrefix: 'sync-resolver',
        kind: 'background-run',
        createdAt: now,
        summary: 'Sync conflict resolver run started.',
        details: [
          `Repository: ${config.repoDir}`,
          `Remote/branch: ${config.remote}/${config.branch}`,
          `Trigger: ${triggerLabel(event)}`,
          '',
          'Conflicted files:',
          ...conflicts.map((file) => `- ${file}`),
          '',
          'Resolver output:',
          resolverResult,
        ].join('\n'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = `conflict resolver start failed: ${message}`;
      context.logger.error(state.lastError);
      maybeNotifySyncError(state, context, config, profile, event, 'resolver', state.lastError);
    }
  }

  async function maybeStartErrorResolver(input: {
    phase: string;
    message: string;
    event: DaemonEvent;
    context: DaemonModuleContext;
    profile: string;
  }): Promise<void> {
    if (!config.autoResolveErrorsWithAgent) {
      return;
    }

    const normalized = input.message.trim();
    if (normalized.length === 0) {
      return;
    }

    const fingerprint = `${input.phase}:${normalized}`;
    const now = nowIso();
    const cooldownMs = Math.max(1, config.errorResolverCooldownMinutes) * 60_000;
    const canRetryByTime = !state.lastErrorResolverStartedAt
      || (Date.now() - Date.parse(state.lastErrorResolverStartedAt)) >= cooldownMs;
    const shouldStartResolver = state.lastErrorResolverFingerprint !== fingerprint || canRetryByTime;

    if (!shouldStartResolver) {
      return;
    }

    try {
      const resolverResult = await startErrorResolverRun({
        config,
        phase: input.phase,
        error: normalized,
        trigger: triggerLabel(input.event),
        cwd: input.context.paths.root,
        profile: input.profile,
        stateRoot: input.context.paths.stateRoot,
      });

      state.lastErrorResolverStartedAt = now;
      state.lastErrorResolverResult = resolverResult;
      state.lastErrorResolverFingerprint = fingerprint;
      input.context.logger.warn(`git sync error detected; started error resolver run (${resolverResult})`);

      writeSyncActivity(input.context, input.profile, {
        idPrefix: 'sync-error-resolver',
        kind: 'background-run',
        createdAt: now,
        summary: 'Sync error resolver run started.',
        details: [
          `Repository: ${config.repoDir}`,
          `Remote/branch: ${config.remote}/${config.branch}`,
          `Trigger: ${triggerLabel(input.event)}`,
          `Phase: ${input.phase}`,
          '',
          'Error:',
          normalized,
          '',
          'Resolver output:',
          resolverResult,
        ].join('\n'),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = `error resolver start failed: ${message}`;
      input.context.logger.error(state.lastError);
      maybeNotifySyncError(state, input.context, config, input.profile, input.event, 'error-resolver', state.lastError);
    }
  }

  async function runSyncCycle(event: DaemonEvent, context: DaemonModuleContext): Promise<void> {
    if (state.running) {
      return;
    }

    state.running = true;
    const profile = resolveActivityProfile(context);

    try {
      const startedAt = nowIso();
      state.lastRunAt = startedAt;

      if (!existsSync(join(config.repoDir, '.git'))) {
        state.lastError = `sync repo not initialized: ${config.repoDir}`;
        context.logger.warn(state.lastError);
        maybeNotifySyncError(state, context, config, profile, event, 'setup', state.lastError);
        await maybeStartErrorResolver({
          phase: 'setup',
          message: state.lastError,
          event,
          context,
          profile,
        });
        return;
      }

      try {
        await ensureManagedMergeHandling(config.repoDir);
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        context.logger.warn(`git sync repair failed: ${state.lastError}`);
        maybeNotifySyncError(state, context, config, profile, event, 'repair', state.lastError);
        return;
      }

      const preexistingConflicts = await listConflictedFiles(config.repoDir);
      if (preexistingConflicts.length > 0) {
        state.lastConflictAt = startedAt;
        state.lastConflictFiles = preexistingConflicts;
        state.lastError = `sync blocked by ${preexistingConflicts.length} unresolved merge conflict(s)`;

        maybeNotifyConflicts(state, context, config, profile, event, preexistingConflicts);
        await maybeStartConflictResolver(preexistingConflicts, event, context, profile);
        return;
      }

      const addResult = await runGit(config.repoDir, ['add', '-A']);
      if (addResult.code !== 0) {
        state.lastError = addResult.stderr || addResult.stdout || 'git add failed';
        context.logger.warn(`git sync add failed: ${state.lastError}`);
        maybeNotifySyncError(state, context, config, profile, event, 'add', state.lastError);
        await maybeStartErrorResolver({
          phase: 'add',
          message: state.lastError,
          event,
          context,
          profile,
        });
        return;
      }

      if (await hasStagedChanges(config.repoDir)) {
        const commitTimestamp = nowIso();
        const commitResult = await runGit(config.repoDir, ['commit', '-m', buildSyncCommitMessage(commitTimestamp)]);
        if (commitResult.code !== 0) {
          state.lastError = commitResult.stderr || commitResult.stdout || 'git commit failed';
          context.logger.warn(`git sync commit failed: ${state.lastError}`);
          maybeNotifySyncError(state, context, config, profile, event, 'commit', state.lastError);
          await maybeStartErrorResolver({
            phase: 'commit',
            message: state.lastError,
            event,
            context,
            profile,
          });
          return;
        }

        state.lastCommitAt = commitTimestamp;
      }

      if (!(await remoteExists(config.repoDir, config.remote))) {
        state.lastError = undefined;
        state.lastConflictFiles = [];
        state.lastConflictFingerprint = undefined;
        state.lastErrorResolverFingerprint = undefined;
        state.lastNotifiedConflictFingerprint = undefined;
        state.lastNotifiedErrorFingerprint = undefined;
        state.lastSuccessAt = nowIso();
        return;
      }

      const fetchResult = await runGit(config.repoDir, ['fetch', config.remote, config.branch]);
      if (fetchResult.code !== 0) {
        state.lastError = fetchResult.stderr || fetchResult.stdout || 'git fetch failed';
        context.logger.warn(`git sync fetch failed: ${state.lastError}`);
        maybeNotifySyncError(state, context, config, profile, event, 'fetch', state.lastError);
        await maybeStartErrorResolver({
          phase: 'fetch',
          message: state.lastError,
          event,
          context,
          profile,
        });
        return;
      }

      const mergeResult = await runGit(config.repoDir, ['merge', '--no-edit', `${config.remote}/${config.branch}`]);
      if (mergeResult.code !== 0) {
        const conflicts = await listConflictedFiles(config.repoDir);
        if (conflicts.length > 0) {
          state.lastConflictAt = nowIso();
          state.lastConflictFiles = conflicts;
          state.lastError = `sync blocked by ${conflicts.length} unresolved merge conflict(s)`;
          context.logger.warn(state.lastError);
          maybeNotifyConflicts(state, context, config, profile, event, conflicts);
          await maybeStartConflictResolver(conflicts, event, context, profile);
          return;
        }

        state.lastError = mergeResult.stderr || mergeResult.stdout || 'git merge failed';
        context.logger.warn(`git sync merge failed: ${state.lastError}`);
        maybeNotifySyncError(state, context, config, profile, event, 'merge', state.lastError);
        await maybeStartErrorResolver({
          phase: 'merge',
          message: state.lastError,
          event,
          context,
          profile,
        });
        return;
      }

      const pushResult = await runGit(config.repoDir, ['push', config.remote, `HEAD:${config.branch}`]);
      if (pushResult.code !== 0) {
        state.lastError = pushResult.stderr || pushResult.stdout || 'git push failed';
        context.logger.warn(`git sync push failed: ${state.lastError}`);
        maybeNotifySyncError(state, context, config, profile, event, 'push', state.lastError);
        await maybeStartErrorResolver({
          phase: 'push',
          message: state.lastError,
          event,
          context,
          profile,
        });
        return;
      }

      state.lastConflictFiles = [];
      state.lastConflictFingerprint = undefined;
      state.lastErrorResolverFingerprint = undefined;
      state.lastNotifiedConflictFingerprint = undefined;
      state.lastError = undefined;
      state.lastNotifiedErrorFingerprint = undefined;
      state.lastSuccessAt = nowIso();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message;
      context.logger.warn(`git sync cycle failed: ${message}`);
      maybeNotifySyncError(state, context, config, profile, event, 'runtime', message);
      await maybeStartErrorResolver({
        phase: 'runtime',
        message,
        event,
        context,
        profile,
      });
    } finally {
      state.running = false;
    }
  }

  return {
    name: 'sync',
    enabled: config.enabled,
    subscriptions: ['timer.sync.tick', 'sync.run.requested'],
    timers: [
      {
        name: 'sync-tick',
        eventType: 'timer.sync.tick',
        intervalMs: Math.max(15_000, config.intervalSeconds * 1_000),
      },
    ],

    async start(): Promise<void> {
      // No-op.
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type !== 'timer.sync.tick' && event.type !== 'sync.run.requested') {
        return;
      }

      await runSyncCycle(event, context);
    },

    getStatus(): Record<string, unknown> {
      return {
        repoDir: config.repoDir,
        branch: config.branch,
        remote: config.remote,
        intervalSeconds: config.intervalSeconds,
        autoResolveWithAgent: config.autoResolveWithAgent,
        conflictResolverTaskSlug: config.conflictResolverTaskSlug,
        resolverCooldownMinutes: config.resolverCooldownMinutes,
        autoResolveErrorsWithAgent: config.autoResolveErrorsWithAgent,
        errorResolverTaskSlug: config.errorResolverTaskSlug,
        errorResolverCooldownMinutes: config.errorResolverCooldownMinutes,
        running: state.running,
        lastRunAt: state.lastRunAt,
        lastSuccessAt: state.lastSuccessAt,
        lastCommitAt: state.lastCommitAt,
        lastConflictAt: state.lastConflictAt,
        lastConflictFiles: state.lastConflictFiles,
        lastResolverStartedAt: state.lastResolverStartedAt,
        lastResolverResult: state.lastResolverResult,
        lastErrorResolverStartedAt: state.lastErrorResolverStartedAt,
        lastErrorResolverResult: state.lastErrorResolverResult,
        lastError: state.lastError,
      };
    },
  } satisfies DaemonModule;
}
