import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import type { MemoryModuleConfig } from '../config.js';
import { runCommand } from './command.js';
import { resolveMemoryConfig } from './memory-config.js';
import { summarizeWithPiSdk } from './memory-summarizer.js';
import { parseSessionTranscript } from './memory-transcript.js';
import {
  cleanupRetention,
  collectFilesRecursive,
  createEmptyScanState,
  loadScanState,
  saveScanState,
  toFingerprint,
  toSummaryPath,
  toWorkspaceKey,
  writeSummaryFile,
} from './memory-store.js';
import type { DaemonModule, DaemonModuleContext } from './types.js';
import type {
  MemoryModuleDependencies,
  MemoryModuleState,
  ResolvedMemoryConfig,
  SessionScanResult,
  SessionScanState,
  SessionSummaryRequest,
} from './memory-types.js';

function removeFileIfExists(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }

  rmSync(path, { force: true });
  return true;
}

async function ensureCollections(config: ResolvedMemoryConfig, context: DaemonModuleContext): Promise<void> {
  for (const collection of config.collections) {
    const args = ['collection', 'add', collection.path, '--name', collection.name];

    if (collection.mask && collection.mask.trim().length > 0) {
      args.push('--mask', collection.mask);
    }

    const result = await runCommand('qmd', args);

    if (result.code !== 0) {
      const stderr = result.stderr.toLowerCase();
      const alreadyExists = stderr.includes('exists') || stderr.includes('already');
      if (!alreadyExists) {
        context.logger.warn(`qmd collection add failed for ${collection.name}: ${result.stderr || 'unknown error'}`);
      }
    }
  }
}

async function runQmdUpdate(config: ResolvedMemoryConfig, context: DaemonModuleContext): Promise<void> {
  const result = await runCommand('qmd', ['update', '--index', config.qmd.index]);
  if (result.code !== 0) {
    throw new Error(result.stderr || 'qmd update failed');
  }

  context.publish('memory.qmd.update.completed', {
    index: config.qmd.index,
    at: new Date().toISOString(),
  });
}

async function runQmdEmbed(config: ResolvedMemoryConfig, context: DaemonModuleContext): Promise<void> {
  const result = await runCommand('qmd', ['embed', '--index', config.qmd.index]);
  if (result.code !== 0) {
    throw new Error(result.stderr || 'qmd embed failed');
  }

  context.publish('memory.qmd.embed.completed', {
    index: config.qmd.index,
    at: new Date().toISOString(),
  });
}

async function scanConcludedSessions(
  config: ResolvedMemoryConfig,
  scanState: SessionScanState,
  nowMs: number,
  hintedFiles: string[],
  summarizeSession: (request: SessionSummaryRequest) => Promise<string>,
  context: DaemonModuleContext,
  state: MemoryModuleState,
): Promise<SessionScanResult> {
  const sessionFiles = new Set<string>(collectFilesRecursive(config.sessionSource, '.jsonl'));

  for (const hintedFile of hintedFiles) {
    sessionFiles.add(resolve(hintedFile));
  }

  const sortedSessionFiles = [...sessionFiles].sort();
  const inactivityMs = config.inactiveAfterMinutes * 60_000;

  let scanned = 0;
  let summarized = 0;
  let skipped = 0;
  let failed = 0;
  let removed = 0;

  for (const sessionFile of sortedSessionFiles) {
    if (!existsSync(sessionFile)) {
      skipped += 1;
      continue;
    }

    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(sessionFile);
    } catch {
      skipped += 1;
      continue;
    }

    if (!stats.isFile()) {
      skipped += 1;
      continue;
    }

    scanned += 1;

    if (nowMs - stats.mtimeMs < inactivityMs) {
      skipped += 1;
      continue;
    }

    const fingerprint = toFingerprint(stats.size, stats.mtimeMs);
    const existingRecord = scanState.sessions[sessionFile];

    if (existingRecord && existingRecord.fingerprint === fingerprint) {
      skipped += 1;
      continue;
    }

    const parsed = (() => {
      try {
        return parseSessionTranscript(sessionFile, config);
      } catch (error) {
        failed += 1;
        const message = (error as Error).message;
        state.lastError = message;
        context.logger.warn(`memory failed to parse session ${sessionFile}: ${message}`);
        return undefined;
      }
    })();

    if (!parsed) {
      continue;
    }

    const workspaceKey = toWorkspaceKey(parsed.cwd);
    const summaryPath = toSummaryPath(config.summaryDir, workspaceKey, parsed.sessionId);

    try {
      const markdown = await summarizeSession({
        sessionFile,
        sessionId: parsed.sessionId,
        cwd: parsed.cwd,
        startedAt: parsed.startedAt,
        endedAt: parsed.endedAt,
        transcript: parsed.transcript,
      });

      if (existingRecord && existingRecord.summaryPath !== summaryPath && removeFileIfExists(existingRecord.summaryPath)) {
        removed += 1;
        state.dirty = true;
        state.needsEmbedding = true;
      }

      const changed = writeSummaryFile(summaryPath, markdown);
      if (changed) {
        state.dirty = true;
        state.needsEmbedding = true;
        state.lastSummaryAt = new Date(nowMs).toISOString();
        context.publish('memory.summary.updated', {
          sessionFile,
          summaryPath,
        });
      }

      scanState.sessions[sessionFile] = {
        fingerprint,
        summaryPath,
        workspaceKey,
        sessionId: parsed.sessionId,
        summarizedAt: new Date(nowMs).toISOString(),
      };

      summarized += 1;
    } catch (error) {
      failed += 1;
      const message = (error as Error).message;
      state.lastError = message;
      context.logger.warn(`memory failed to summarize session ${sessionFile}: ${message}`);
    }
  }

  return {
    scanned,
    summarized,
    skipped,
    failed,
    removed,
  };
}

export function createMemoryModule(
  config: MemoryModuleConfig,
  dependencies: MemoryModuleDependencies = {},
): DaemonModule {
  const resolvedConfig = resolveMemoryConfig(config);

  const now = dependencies.now ?? (() => new Date());
  const summarizeSession = dependencies.summarizeSession
    ?? ((request: SessionSummaryRequest) => summarizeWithPiSdk(request, resolvedConfig));

  const state: MemoryModuleState = {
    dirty: false,
    needsEmbedding: false,
    scannedSessions: 0,
    summarizedSessions: 0,
    skippedSessions: 0,
    failedSessions: 0,
    deletedSummaries: 0,
    pendingHintedSessions: 0,
  };

  const hintedSessionFiles = new Set<string>();
  let scanState = createEmptyScanState();

  const runScanPass = async (context: DaemonModuleContext): Promise<void> => {
    const startedAt = now();
    const nowMs = startedAt.getTime();

    const hintedFiles = [...hintedSessionFiles];
    hintedSessionFiles.clear();
    state.pendingHintedSessions = 0;

    const scanResult = await scanConcludedSessions(
      resolvedConfig,
      scanState,
      nowMs,
      hintedFiles,
      summarizeSession,
      context,
      state,
    );

    const removedByRetention = cleanupRetention(resolvedConfig, scanState, nowMs);
    if (removedByRetention > 0) {
      state.dirty = true;
      state.needsEmbedding = true;
      state.deletedSummaries += removedByRetention;
    }

    state.scannedSessions += scanResult.scanned;
    state.summarizedSessions += scanResult.summarized;
    state.skippedSessions += scanResult.skipped;
    state.failedSessions += scanResult.failed;
    state.deletedSummaries += scanResult.removed;

    const scanTimestamp = startedAt.toISOString();
    state.lastScanAt = scanTimestamp;
    state.lastCleanupAt = scanTimestamp;

    if (scanResult.failed === 0) {
      state.lastError = undefined;
    }

    saveScanState(resolvedConfig.stateFile, scanState);

    context.publish('memory.scan.completed', {
      scanned: scanResult.scanned,
      summarized: scanResult.summarized,
      skipped: scanResult.skipped,
      failed: scanResult.failed,
      removed: scanResult.removed + removedByRetention,
      at: scanTimestamp,
    });
  };

  return {
    name: 'memory',
    enabled: resolvedConfig.enabled,
    subscriptions: [
      'session.updated',
      'session.closed',
      'memory.reindex.requested',
      'timer.memory.session.scan',
      'timer.memory.qmd.update',
      'timer.memory.qmd.reconcile',
      'timer.memory.qmd.embed',
    ],
    timers: [
      {
        name: 'memory-session-scan',
        eventType: 'timer.memory.session.scan',
        intervalMs: Math.max(60_000, resolvedConfig.scanIntervalMinutes * 60_000),
      },
      {
        name: 'memory-qmd-update',
        eventType: 'timer.memory.qmd.update',
        intervalMs: Math.max(5_000, resolvedConfig.qmd.updateDebounceSeconds * 1000),
      },
      {
        name: 'memory-qmd-reconcile',
        eventType: 'timer.memory.qmd.reconcile',
        intervalMs: Math.max(60_000, resolvedConfig.qmd.reconcileIntervalMinutes * 60_000),
      },
      {
        name: 'memory-qmd-embed',
        eventType: 'timer.memory.qmd.embed',
        intervalMs: Math.max(30_000, resolvedConfig.qmd.embedDebounceSeconds * 1000),
      },
    ],

    async start(context): Promise<void> {
      mkdirSync(resolvedConfig.summaryDir, { recursive: true, mode: 0o700 });
      mkdirSync(dirname(resolvedConfig.stateFile), { recursive: true, mode: 0o700 });
      scanState = loadScanState(resolvedConfig.stateFile, context.logger);

      try {
        await ensureCollections(resolvedConfig, context);
      } catch (error) {
        state.lastError = (error as Error).message;
        context.logger.warn(`memory module startup warning: ${state.lastError}`);
      }

      try {
        await runScanPass(context);
      } catch (error) {
        state.lastError = (error as Error).message;
        context.logger.warn(`memory module initial scan failed: ${state.lastError}`);
      }
    },

    async handleEvent(event, context): Promise<void> {
      if (event.type === 'session.updated' || event.type === 'session.closed') {
        const sessionFile = event.payload.sessionFile;
        if (typeof sessionFile !== 'string' || sessionFile.length === 0) {
          return;
        }

        hintedSessionFiles.add(resolve(sessionFile));
        state.pendingHintedSessions = hintedSessionFiles.size;
        return;
      }

      if (event.type === 'memory.reindex.requested') {
        state.dirty = true;
        state.needsEmbedding = true;
        return;
      }

      if (event.type === 'timer.memory.session.scan') {
        try {
          await runScanPass(context);
        } catch (error) {
          state.lastError = (error as Error).message;
          context.logger.warn(`memory module session scan failed: ${state.lastError}`);
        }

        return;
      }

      if (event.type === 'timer.memory.qmd.update') {
        if (!state.dirty) {
          return;
        }

        try {
          await runQmdUpdate(resolvedConfig, context);
          state.dirty = false;
          state.lastQmdUpdateAt = now().toISOString();
          state.lastError = undefined;
        } catch (error) {
          state.lastError = (error as Error).message;
          context.logger.warn(`memory module qmd update failed: ${state.lastError}`);
        }

        return;
      }

      if (event.type === 'timer.memory.qmd.reconcile') {
        try {
          await runQmdUpdate(resolvedConfig, context);
          state.dirty = false;
          state.lastQmdUpdateAt = now().toISOString();
          state.lastQmdReconcileAt = state.lastQmdUpdateAt;
          state.lastError = undefined;
        } catch (error) {
          state.lastError = (error as Error).message;
          context.logger.warn(`memory module qmd reconcile failed: ${state.lastError}`);
        }

        return;
      }

      if (event.type === 'timer.memory.qmd.embed') {
        if (!state.needsEmbedding || state.dirty) {
          return;
        }

        try {
          await runQmdEmbed(resolvedConfig, context);
          state.needsEmbedding = false;
          state.lastQmdEmbedAt = now().toISOString();
          state.lastError = undefined;
        } catch (error) {
          state.lastError = (error as Error).message;
          context.logger.warn(`memory module qmd embed failed: ${state.lastError}`);
        }
      }
    },

    getStatus(): Record<string, unknown> {
      return {
        dirty: state.dirty,
        needsEmbedding: state.needsEmbedding,
        lastScanAt: state.lastScanAt,
        lastCleanupAt: state.lastCleanupAt,
        lastSummaryAt: state.lastSummaryAt,
        lastQmdUpdateAt: state.lastQmdUpdateAt,
        lastQmdReconcileAt: state.lastQmdReconcileAt,
        lastQmdEmbedAt: state.lastQmdEmbedAt,
        scannedSessions: state.scannedSessions,
        summarizedSessions: state.summarizedSessions,
        skippedSessions: state.skippedSessions,
        failedSessions: state.failedSessions,
        deletedSummaries: state.deletedSummaries,
        pendingHintedSessions: state.pendingHintedSessions,
        stateFile: resolvedConfig.stateFile,
        agentDir: resolvedConfig.agentDir,
        lastError: state.lastError,
      };
    },
  };
}

export type { MemoryModuleDependencies } from './memory-types.js';
