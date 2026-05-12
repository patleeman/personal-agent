/**
 * Central SQLite database lifecycle management.
 *
 * Provides:
 * - Periodic WAL checkpointing across all cached runtime databases
 * - Graceful shutdown (checkpoint + close) for all databases
 * - Stale quarantine / backup file pruning
 * - `process.on('exit')` safety net for ungraceful termination
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { checkpointAutomationDbsPassive, closeAutomationDbs } from '../automation/store.js';
import { closeConversationSearchIndexDb } from '../conversations/conversationSearchIndex.js';
import { closeConversationSummariesDb } from '../conversations/conversationSummaries.js';
import { closeExtensionStateDbs } from '../extensions/extensionStorage.js';
import { checkpointRuntimeDbsPassive, closeRuntimeDbs } from '../runs/store.js';

/** How often to run a passive WAL checkpoint (5 minutes). */
const WAL_CHECKPOINT_INTERVAL_MS = 5 * 60 * 1000;

/** Maximum age (in days) for quarantine / backup files before pruning. */
const STALE_FILE_MAX_AGE_DAYS = 7;

/** Maximum number of files to keep per cleanup directory regardless of age. */
const MAX_STALE_FILES = 10;

type LogFn = (level: 'info' | 'warn' | 'error', message: string) => void;

let checkpointTimer: NodeJS.Timeout | null = null;
let exitHandlerRegistered = false;

// ── Periodic WAL checkpoint ───────────────────────────────────────────────────

/**
 * Run a PASSIVE WAL checkpoint on all cached databases.
 * PASSIVE never blocks writers — it just flushes whatever pages it can.
 */
export function checkpointAllDbsPassive(log?: LogFn): void {
  const stores = [
    { name: 'runtime', fn: checkpointRuntimeDbsPassive },
    { name: 'automation', fn: checkpointAutomationDbsPassive },
  ];

  for (const { name, fn } of stores) {
    try {
      fn();
    } catch (error) {
      log?.('warn', `periodic WAL checkpoint failed for ${name}: ${(error as Error).message}`);
    }
  }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

/**
 * Close all cached SQLite databases with a full WAL checkpoint (TRUNCATE).
 * Call this during daemon shutdown.
 */
export function closeAllDbs(log?: LogFn): void {
  const closers = [
    { name: 'runtime', fn: closeRuntimeDbs },
    { name: 'automation', fn: closeAutomationDbs },
    { name: 'conversation-search', fn: closeConversationSearchIndexDb },
    { name: 'conversation-summaries', fn: closeConversationSummariesDb },
    { name: 'extension-state', fn: closeExtensionStateDbs },
  ];

  for (const { name, fn } of closers) {
    try {
      fn();
    } catch (error) {
      log?.('warn', `failed to close ${name} DBs: ${(error as Error).message}`);
    }
  }
}

// ── Process exit safety net ───────────────────────────────────────────────────

/**
 * Register a synchronous `process.on('exit')` handler that closes all
 * databases. This is a last-resort safety net for ungraceful termination
 * (e.g. Electron force-quit, uncaught exception). The 'exit' event fires
 * for most termination scenarios except SIGKILL.
 *
 * better-sqlite3 operations are synchronous, so checkpoint + close works
 * inside the synchronous-only 'exit' handler.
 */
export function registerProcessExitSafetyNet(): void {
  if (exitHandlerRegistered) {
    return;
  }
  exitHandlerRegistered = true;

  process.on('exit', () => {
    try {
      closeAllDbs();
    } catch {
      // Can't do anything useful here — process is exiting.
    }
  });
}

// ── Periodic checkpoint lifecycle ─────────────────────────────────────────────

/**
 * Start the periodic WAL checkpoint timer.
 * Returns a cleanup function that stops the timer.
 */
export function startPeriodicWalCheckpoint(log?: LogFn): () => void {
  stopPeriodicWalCheckpoint();

  checkpointTimer = setInterval(() => {
    checkpointAllDbsPassive(log);
  }, WAL_CHECKPOINT_INTERVAL_MS);

  // Don't keep the process alive just for checkpoints.
  checkpointTimer.unref();

  return () => stopPeriodicWalCheckpoint();
}

export function stopPeriodicWalCheckpoint(): void {
  if (checkpointTimer) {
    clearInterval(checkpointTimer);
    checkpointTimer = null;
  }
}

// ── Stale file pruning ────────────────────────────────────────────────────────

/**
 * Remove old quarantine (`.corrupt/`) and backup (`.backups/`) files
 * under the given daemon root directory.
 *
 * - Files older than {@link STALE_FILE_MAX_AGE_DAYS} are removed.
 * - At most {@link MAX_STALE_FILES} are kept per directory regardless of age.
 */
export function pruneStaleRecoveryFiles(daemonRoot: string, log?: LogFn): void {
  const dirsToCheck = [join(daemonRoot, '.corrupt'), join(daemonRoot, '.backups')];

  const maxAgeMs = STALE_FILE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const now = Date.now();

  for (const dir of dirsToCheck) {
    if (!existsSync(dir)) {
      continue;
    }

    try {
      const entries = readdirSync(dir)
        .map((name) => {
          const fullPath = join(dir, name);
          try {
            return { name, path: fullPath, mtimeMs: statSync(fullPath).mtimeMs };
          } catch {
            return null;
          }
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first

      let removed = 0;
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i]!;
        const isOld = now - entry.mtimeMs > maxAgeMs;
        const isBeyondLimit = i >= MAX_STALE_FILES;

        if (isOld || isBeyondLimit) {
          try {
            rmSync(entry.path, { force: true });
            removed++;
          } catch {
            // Best-effort cleanup.
          }
        }
      }

      if (removed > 0) {
        log?.('info', `pruned ${removed} stale file(s) from ${dir}`);
      }
    } catch (error) {
      log?.('warn', `failed to prune stale files in ${dir}: ${(error as Error).message}`);
    }
  }
}
