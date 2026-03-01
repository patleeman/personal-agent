import { existsSync, mkdirSync, rmSync, statSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import type { MemoryModuleConfig } from '../config.js';
import { runCommand } from './command.js';
import { resolveMemoryConfig } from './memory-config.js';
import { formatMemoryCard, parseAndNormalizeMemoryCard } from './memory-card.js';
import { summarizeMemoryCardWithPiSdk, summarizeWithPiSdk } from './memory-summarizer.js';
import { parseSessionTranscript } from './memory-transcript.js';
import {
  cleanupRetention,
  collectFilesRecursive,
  createEmptyScanState,
  loadScanState,
  saveScanState,
  toCardPath,
  toFingerprint,
  toSkipMarkerPath,
  toSummaryPath,
  toWorkspaceKey,
  writeCardFile,
  writeSkipMarkerFile,
  writeSummaryFile,
} from './memory-store.js';
import type { DaemonModule, DaemonModuleContext } from './types.js';
import type {
  MemoryModuleDependencies,
  MemoryModuleState,
  ResolvedMemoryConfig,
  SessionMemoryCardRequest,
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

function countApproxTokens(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }

  return normalized.split(/\s+/).length;
}

async function ensureCollection(
  name: string,
  path: string,
  mask: string | undefined,
  context: DaemonModuleContext,
): Promise<void> {
  const args = ['collection', 'add', path, '--name', name];

  if (mask && mask.trim().length > 0) {
    args.push('--mask', mask);
  }

  const result = await runCommand('qmd', args);

  if (result.code !== 0) {
    const stderr = result.stderr.toLowerCase();
    const alreadyExists = stderr.includes('exists') || stderr.includes('already');
    if (!alreadyExists) {
      context.logger.warn(`qmd collection add failed for ${name}: ${result.stderr || 'unknown error'}`);
    }
  }
}

async function ensureCollections(config: ResolvedMemoryConfig, context: DaemonModuleContext): Promise<void> {
  for (const collection of config.collections) {
    await ensureCollection(collection.name, collection.path, collection.mask, context);
  }

  // Ensure cards collection points at the configured cardsDir even if a stale
  // collection with the same name exists from prior runs/tests.
  await runCommand('qmd', ['collection', 'remove', config.cardsCollectionName]);
  await ensureCollection(config.cardsCollectionName, config.cardsDir, '**/*.json', context);
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
  summarizeMemoryCard: (request: SessionMemoryCardRequest) => Promise<string>,
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
      const artifactExists = existsSync(existingRecord.summaryPath);
      const cardExists = existingRecord.cardPath ? existsSync(existingRecord.cardPath) : true;

      if (artifactExists && cardExists) {
        skipped += 1;
        continue;
      }
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
    const cardPath = toCardPath(config.cardsDir, workspaceKey, parsed.sessionId);
    const summaryRelativePath = relative(config.summaryDir, summaryPath).replace(/\\/g, '/');
    const transcriptTokens = countApproxTokens(parsed.transcript);

    if (transcriptTokens < config.summarization.minTranscriptTokens) {
      const skipMarkerPath = toSkipMarkerPath(config.summaryDir, workspaceKey, parsed.sessionId);

      try {
        if (removeFileIfExists(summaryPath)) {
          removed += 1;
          state.dirty = true;
          state.needsEmbedding = true;
        }

        if (removeFileIfExists(cardPath)) {
          state.dirty = true;
          state.needsEmbedding = true;
        }

        if (existingRecord) {
          if (existingRecord.summaryPath !== skipMarkerPath && removeFileIfExists(existingRecord.summaryPath)) {
            if (existingRecord.summaryPath.endsWith('.md')) {
              removed += 1;
              state.dirty = true;
              state.needsEmbedding = true;
            }
          }

          if (existingRecord.cardPath && existingRecord.cardPath !== cardPath && removeFileIfExists(existingRecord.cardPath)) {
            state.dirty = true;
            state.needsEmbedding = true;
          }
        }

        writeSkipMarkerFile(skipMarkerPath, transcriptTokens);
        scanState.sessions[sessionFile] = {
          fingerprint,
          summaryPath: skipMarkerPath,
          cardPath: undefined,
          workspaceKey,
          sessionId: parsed.sessionId,
          summarizedAt: new Date(nowMs).toISOString(),
        };

        skipped += 1;
      } catch (error) {
        failed += 1;
        const message = (error as Error).message;
        state.lastError = message;
        context.logger.warn(`memory failed to persist low-signal skip marker for ${sessionFile}: ${message}`);
      }

      continue;
    }

    try {
      const markdown = await summarizeSession({
        sessionFile,
        sessionId: parsed.sessionId,
        cwd: parsed.cwd,
        startedAt: parsed.startedAt,
        endedAt: parsed.endedAt,
        transcript: parsed.transcript,
      });

      const rawMemoryCard = await summarizeMemoryCard({
        sessionFile,
        sessionId: parsed.sessionId,
        cwd: parsed.cwd,
        transcript: parsed.transcript,
        summaryRelativePath,
      });

      const memoryCard = parseAndNormalizeMemoryCard(rawMemoryCard, {
        sessionFile,
        sessionId: parsed.sessionId,
        cwd: parsed.cwd,
        transcript: parsed.transcript,
        summaryRelativePath,
      });

      if (existingRecord) {
        if (existingRecord.summaryPath !== summaryPath && removeFileIfExists(existingRecord.summaryPath)) {
          if (existingRecord.summaryPath.endsWith('.md')) {
            removed += 1;
          }
          state.dirty = true;
          state.needsEmbedding = true;
        }

        if (existingRecord.cardPath && existingRecord.cardPath !== cardPath && removeFileIfExists(existingRecord.cardPath)) {
          state.dirty = true;
          state.needsEmbedding = true;
        }
      }

      const summaryChanged = writeSummaryFile(summaryPath, markdown);
      const cardChanged = writeCardFile(cardPath, formatMemoryCard(memoryCard));

      if (summaryChanged) {
        state.dirty = true;
        state.needsEmbedding = true;
        state.lastSummaryAt = new Date(nowMs).toISOString();
        context.publish('memory.summary.updated', {
          sessionFile,
          summaryPath,
        });
      }

      if (cardChanged) {
        state.dirty = true;
        state.needsEmbedding = true;
        context.publish('memory.card.updated', {
          sessionFile,
          cardPath,
        });
      }

      scanState.sessions[sessionFile] = {
        fingerprint,
        summaryPath,
        cardPath,
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
  const summarizeMemoryCard = dependencies.summarizeMemoryCard
    ?? ((request: SessionMemoryCardRequest) => summarizeMemoryCardWithPiSdk(request, resolvedConfig));

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
      summarizeMemoryCard,
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
      mkdirSync(resolvedConfig.cardsDir, { recursive: true, mode: 0o700 });
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
        summaryDir: resolvedConfig.summaryDir,
        cardsDir: resolvedConfig.cardsDir,
        cardsCollectionName: resolvedConfig.cardsCollectionName,
        lastError: state.lastError,
      };
    },
  };
}

export type { MemoryModuleDependencies } from './memory-types.js';
