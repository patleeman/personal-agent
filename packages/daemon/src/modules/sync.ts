import { existsSync } from 'fs';
import { hostname } from 'os';
import { join } from 'path';
import type { SyncModuleConfig } from '../config.js';
import type { DaemonModule } from './types.js';
import { runCommand } from './command.js';

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

async function startConflictResolverRun(config: SyncModuleConfig, conflicts: string[]): Promise<string> {
  const prompt = buildConflictResolverPrompt(config.repoDir, config.branch, config.remote, conflicts);

  const result = await runCommand(
    'pa',
    [
      'runs',
      'start',
      config.conflictResolverTaskSlug,
      '--cwd',
      config.repoDir,
      '--',
      'pa',
      '-p',
      prompt,
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

  async function maybeStartConflictResolver(conflicts: string[], context: Parameters<DaemonModule['handleEvent']>[1]): Promise<void> {
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
      const resolverResult = await startConflictResolverRun(config, conflicts);
      state.lastResolverStartedAt = now;
      state.lastResolverResult = resolverResult;
      state.lastConflictFingerprint = fingerprint;
      context.logger.warn(`git sync conflict detected; started resolver run (${resolverResult})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = `conflict resolver start failed: ${message}`;
      context.logger.error(state.lastError);
    }
  }

  async function runSyncCycle(context: Parameters<DaemonModule['handleEvent']>[1]): Promise<void> {
    if (state.running) {
      return;
    }

    state.running = true;

    try {
      const startedAt = nowIso();
      state.lastRunAt = startedAt;

      if (!existsSync(join(config.repoDir, '.git'))) {
        state.lastError = `sync repo not initialized: ${config.repoDir}`;
        context.logger.warn(state.lastError);
        return;
      }

      const preexistingConflicts = await listConflictedFiles(config.repoDir);
      if (preexistingConflicts.length > 0) {
        state.lastConflictAt = startedAt;
        state.lastConflictFiles = preexistingConflicts;
        state.lastError = `sync blocked by ${preexistingConflicts.length} unresolved merge conflict(s)`;
        await maybeStartConflictResolver(preexistingConflicts, context);
        return;
      }

      const addResult = await runGit(config.repoDir, ['add', '-A']);
      if (addResult.code !== 0) {
        state.lastError = addResult.stderr || addResult.stdout || 'git add failed';
        context.logger.warn(`git sync add failed: ${state.lastError}`);
        return;
      }

      if (await hasStagedChanges(config.repoDir)) {
        const commitTimestamp = nowIso();
        const commitResult = await runGit(config.repoDir, ['commit', '-m', buildSyncCommitMessage(commitTimestamp)]);
        if (commitResult.code !== 0) {
          state.lastError = commitResult.stderr || commitResult.stdout || 'git commit failed';
          context.logger.warn(`git sync commit failed: ${state.lastError}`);
          return;
        }

        state.lastCommitAt = commitTimestamp;
      }

      if (!(await remoteExists(config.repoDir, config.remote))) {
        state.lastError = undefined;
        state.lastSuccessAt = nowIso();
        return;
      }

      const fetchResult = await runGit(config.repoDir, ['fetch', config.remote, config.branch]);
      if (fetchResult.code !== 0) {
        state.lastError = fetchResult.stderr || fetchResult.stdout || 'git fetch failed';
        context.logger.warn(`git sync fetch failed: ${state.lastError}`);
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
          await maybeStartConflictResolver(conflicts, context);
          return;
        }

        state.lastError = mergeResult.stderr || mergeResult.stdout || 'git merge failed';
        context.logger.warn(`git sync merge failed: ${state.lastError}`);
        return;
      }

      const pushResult = await runGit(config.repoDir, ['push', config.remote, `HEAD:${config.branch}`]);
      if (pushResult.code !== 0) {
        state.lastError = pushResult.stderr || pushResult.stdout || 'git push failed';
        context.logger.warn(`git sync push failed: ${state.lastError}`);
        return;
      }

      state.lastConflictFiles = [];
      state.lastError = undefined;
      state.lastSuccessAt = nowIso();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastError = message;
      context.logger.warn(`git sync cycle failed: ${message}`);
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

      await runSyncCycle(context);
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
        running: state.running,
        lastRunAt: state.lastRunAt,
        lastSuccessAt: state.lastSuccessAt,
        lastCommitAt: state.lastCommitAt,
        lastConflictAt: state.lastConflictAt,
        lastConflictFiles: state.lastConflictFiles,
        lastResolverStartedAt: state.lastResolverStartedAt,
        lastResolverResult: state.lastResolverResult,
        lastError: state.lastError,
      };
    },
  } satisfies DaemonModule;
}
