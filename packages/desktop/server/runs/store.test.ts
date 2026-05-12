import { openSqliteDatabase } from '@personal-agent/core';
import { existsSync, mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  type DurableRunCheckpointFile,
  listDurableRunIds,
  loadDurableRunCheckpoint,
  loadDurableRunManifest,
  loadDurableRunStatus,
  readDurableRunEvents,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  resolveRuntimeDbPath,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
} from './store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('durable run store', () => {
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('creates initial run status with queued defaults', () => {
    const status = createInitialDurableRunStatus({
      runId: 'run-1',
      createdAt: '2026-03-12T18:00:00Z',
    });

    expect(status).toEqual({
      version: 1,
      runId: 'run-1',
      status: 'queued',
      createdAt: '2026-03-12T18:00:00.000Z',
      updatedAt: '2026-03-12T18:00:00.000Z',
      activeAttempt: 0,
      startedAt: undefined,
      checkpointKey: undefined,
      lastError: undefined,
    });
  });

  it('falls back to the current clock for invalid run record timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T18:00:00.000Z'));

    expect(
      createDurableRunManifest({
        id: 'run-invalid-manifest-time',
        kind: 'workflow',
        resumePolicy: 'continue',
        createdAt: 'not-a-date',
      }).createdAt,
    ).toBe('2026-03-12T18:00:00.000Z');

    expect(
      createInitialDurableRunStatus({
        runId: 'run-invalid-status-time',
        createdAt: 'not-a-date',
        updatedAt: 'also-not-a-date',
        startedAt: 'bad-start',
        completedAt: 'bad-complete',
      }),
    ).toEqual(
      expect.objectContaining({
        createdAt: '2026-03-12T18:00:00.000Z',
        updatedAt: '2026-03-12T18:00:00.000Z',
        startedAt: undefined,
        completedAt: undefined,
      }),
    );
  });

  it('falls back to the current clock for non-ISO run record timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-12T18:00:00.000Z'));

    expect(
      createDurableRunManifest({
        id: 'run-non-iso-manifest-time',
        kind: 'workflow',
        resumePolicy: 'continue',
        createdAt: '1',
      }).createdAt,
    ).toBe('2026-03-12T18:00:00.000Z');

    expect(
      createInitialDurableRunStatus({
        runId: 'run-non-iso-status-time',
        createdAt: '1',
        updatedAt: '1',
        startedAt: '1',
        completedAt: '1',
      }),
    ).toEqual(
      expect.objectContaining({
        createdAt: '2026-03-12T18:00:00.000Z',
        updatedAt: '2026-03-12T18:00:00.000Z',
        startedAt: undefined,
        completedAt: undefined,
      }),
    );
  });

  it('resolves the durable runs root under the daemon root', () => {
    const daemonRoot = createTempDir('durable-runs-store-root-');
    expect(resolveDurableRunsRoot(daemonRoot)).toBe(join(daemonRoot, 'runs'));
    expect(resolveRuntimeDbPath(daemonRoot)).toBe(join(daemonRoot, 'runtime.db'));
  });

  it('persists manifest, status, and checkpoint rows in sqlite', () => {
    const runsRoot = createTempDir('durable-runs-store-save-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-1');

    const manifest = createDurableRunManifest({
      id: 'run-1',
      kind: 'workflow',
      resumePolicy: 'continue',
      createdAt: '2026-03-12T18:00:00Z',
      spec: { step: 'discover' },
      source: {
        type: 'manual',
        id: 'source-1',
      },
    });

    const status = createInitialDurableRunStatus({
      runId: 'run-1',
      status: 'running',
      createdAt: '2026-03-12T18:00:00Z',
      updatedAt: '2026-03-12T18:01:00Z',
      activeAttempt: 1,
      startedAt: '2026-03-12T18:00:30Z',
      checkpointKey: 'step-1',
    });

    const checkpoint: DurableRunCheckpointFile = {
      version: 1,
      runId: 'run-1',
      updatedAt: '2026-03-12T18:01:00Z',
      step: 'discover',
      cursor: 'batch-3',
      payload: {
        filesSeen: 30,
      },
    };

    saveDurableRunManifest(paths.manifestPath, manifest);
    saveDurableRunStatus(paths.statusPath, status);
    saveDurableRunCheckpoint(paths.checkpointPath, checkpoint);

    expect(loadDurableRunManifest(paths.manifestPath)).toEqual({
      ...manifest,
      createdAt: '2026-03-12T18:00:00.000Z',
    });
    expect(loadDurableRunStatus(paths.statusPath)).toEqual({
      ...status,
      createdAt: '2026-03-12T18:00:00.000Z',
      updatedAt: '2026-03-12T18:01:00.000Z',
      startedAt: '2026-03-12T18:00:30.000Z',
    });
    expect(loadDurableRunCheckpoint(paths.checkpointPath)).toEqual({
      ...checkpoint,
      updatedAt: '2026-03-12T18:01:00.000Z',
    });

    expect(existsSync(join(runsRoot, 'runtime.db'))).toBe(true);
    expect(existsSync(paths.manifestPath)).toBe(false);
    expect(existsSync(paths.statusPath)).toBe(false);
    expect(existsSync(paths.checkpointPath)).toBe(false);
  });

  it('appends and reads durable run events from sqlite', async () => {
    const runsRoot = createTempDir('durable-runs-store-events-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-1');

    await appendDurableRunEvent(paths.eventsPath, {
      version: 1,
      runId: 'run-1',
      timestamp: '2026-03-12T18:00:00Z',
      type: 'run.created',
      attempt: 0,
      payload: { source: 'manual' },
    });

    await appendDurableRunEvent(paths.eventsPath, {
      version: 1,
      runId: 'run-1',
      timestamp: '2026-03-12T18:01:00Z',
      type: 'run.started',
      attempt: 1,
    });

    expect(readDurableRunEvents(paths.eventsPath)).toEqual([
      {
        version: 1,
        runId: 'run-1',
        timestamp: '2026-03-12T18:00:00.000Z',
        type: 'run.created',
        attempt: 0,
        payload: { source: 'manual' },
      },
      {
        version: 1,
        runId: 'run-1',
        timestamp: '2026-03-12T18:01:00.000Z',
        type: 'run.started',
        attempt: 1,
        payload: undefined,
      },
    ]);
    expect(existsSync(paths.eventsPath)).toBe(false);
  });

  it('ignores legacy file journals after the sqlite cutover', () => {
    const runsRoot = createTempDir('durable-runs-store-legacy-events-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-1');

    expect(readDurableRunEvents(paths.eventsPath)).toEqual([]);
  });

  it('lists run ids from sqlite', () => {
    const runsRoot = createTempDir('durable-runs-store-list-');
    const a = resolveDurableRunPaths(runsRoot, 'run-a');
    const b = resolveDurableRunPaths(runsRoot, 'run-b');

    saveDurableRunStatus(a.statusPath, createInitialDurableRunStatus({ runId: 'run-a' }));
    saveDurableRunStatus(b.statusPath, createInitialDurableRunStatus({ runId: 'run-b' }));

    expect(listDurableRunIds(runsRoot)).toEqual(['run-a', 'run-b']);
  });

  it('scans one durable run by id', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-one-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-one');

    saveDurableRunManifest(
      paths.manifestPath,
      createDurableRunManifest({
        id: 'run-one',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      paths.statusPath,
      createInitialDurableRunStatus({
        runId: 'run-one',
        status: 'running',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 1,
      }),
    );

    expect(scanDurableRun(runsRoot, 'run-one')).toEqual(
      expect.objectContaining({
        runId: 'run-one',
        recoveryAction: 'resume',
        problems: [],
      }),
    );
    expect(scanDurableRun(runsRoot, 'missing')).toBeUndefined();
  });

  it('classifies incomplete runs by resume policy during recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-kinds-');

    const continuePaths = resolveDurableRunPaths(runsRoot, 'run-continue');
    saveDurableRunManifest(
      continuePaths.manifestPath,
      createDurableRunManifest({
        id: 'run-continue',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      continuePaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'run-continue',
        status: 'running',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 2,
      }),
    );

    const rerunPaths = resolveDurableRunPaths(runsRoot, 'run-rerun');
    saveDurableRunManifest(
      rerunPaths.manifestPath,
      createDurableRunManifest({
        id: 'run-rerun',
        kind: 'scheduled-task',
        resumePolicy: 'rerun',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      rerunPaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'run-rerun',
        status: 'interrupted',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 1,
      }),
    );

    const attentionPaths = resolveDurableRunPaths(runsRoot, 'run-manual');
    saveDurableRunManifest(
      attentionPaths.manifestPath,
      createDurableRunManifest({
        id: 'run-manual',
        kind: 'background-run',
        resumePolicy: 'manual',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      attentionPaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'run-manual',
        status: 'waiting',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 0,
      }),
    );

    expect(scanDurableRunsForRecovery(runsRoot)).toEqual([
      expect.objectContaining({ runId: 'run-continue', recoveryAction: 'resume' }),
      expect.objectContaining({ runId: 'run-manual', recoveryAction: 'attention' }),
      expect.objectContaining({ runId: 'run-rerun', recoveryAction: 'rerun' }),
    ]);
  });

  it('does not mark idle web live sessions as recoverable when they have no pending operation', () => {
    const runsRoot = createTempDir('durable-runs-store-web-live-idle-');
    const idlePaths = resolveDurableRunPaths(runsRoot, 'conversation-live-idle');

    saveDurableRunManifest(
      idlePaths.manifestPath,
      createDurableRunManifest({
        id: 'conversation-live-idle',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T18:00:00Z',
        source: { type: 'web-live-session', id: 'idle' },
      }),
    );
    saveDurableRunStatus(
      idlePaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'conversation-live-idle',
        status: 'waiting',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 0,
      }),
    );
    saveDurableRunCheckpoint(idlePaths.checkpointPath, {
      version: 1,
      runId: 'conversation-live-idle',
      updatedAt: '2026-03-12T18:00:00Z',
      payload: { conversationId: 'idle' },
    });

    expect(scanDurableRun(runsRoot, 'conversation-live-idle')).toEqual(expect.objectContaining({ recoveryAction: 'none' }));

    saveDurableRunCheckpoint(idlePaths.checkpointPath, {
      version: 1,
      runId: 'conversation-live-idle',
      updatedAt: '2026-03-12T18:00:00Z',
      payload: { conversationId: 'idle', pendingOperation: { type: 'turn' } },
    });

    expect(scanDurableRun(runsRoot, 'conversation-live-idle')).toEqual(expect.objectContaining({ recoveryAction: 'resume' }));
  });

  it('marks invalid sqlite rows during recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-invalid-');
    const db = openSqliteDatabase(join(runsRoot, 'runtime.db'));
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id TEXT PRIMARY KEY,
        manifest_json TEXT,
        created_at TEXT,
        kind TEXT,
        resume_policy TEXT,
        parent_id TEXT,
        root_id TEXT,
        source_type TEXT,
        source_id TEXT,
        source_file_path TEXT,
        status_json TEXT,
        status_status TEXT,
        status_updated_at TEXT,
        status_completed_at TEXT,
        checkpoint_json TEXT,
        checkpoint_updated_at TEXT,
        checkpoint_step TEXT
      );
    `);
    db.prepare('INSERT INTO runs (run_id, manifest_json, status_json) VALUES (?, ?, ?)').run(
      'run-bad',
      JSON.stringify({ id: 'different-id' }),
      JSON.stringify({ runId: 'also-different' }),
    );
    db.close();

    const [scan] = scanDurableRunsForRecovery(runsRoot);
    expect(scan?.runId).toBe('run-bad');
    expect(scan?.recoveryAction).toBe('invalid');
    expect(scan?.problems).toEqual(['missing or invalid manifest', 'missing or invalid status']);
  });

  it('summarizes scanned durable runs by recovery action and status', () => {
    const runsRoot = createTempDir('durable-runs-store-summary-');

    const resumePaths = resolveDurableRunPaths(runsRoot, 'resume-run');
    saveDurableRunManifest(
      resumePaths.manifestPath,
      createDurableRunManifest({
        id: 'resume-run',
        kind: 'conversation',
        resumePolicy: 'continue',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      resumePaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'resume-run',
        status: 'running',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 1,
      }),
    );

    const rerunPaths = resolveDurableRunPaths(runsRoot, 'rerun-run');
    saveDurableRunManifest(
      rerunPaths.manifestPath,
      createDurableRunManifest({
        id: 'rerun-run',
        kind: 'scheduled-task',
        resumePolicy: 'rerun',
        createdAt: '2026-03-12T18:00:00Z',
      }),
    );
    saveDurableRunStatus(
      rerunPaths.statusPath,
      createInitialDurableRunStatus({
        runId: 'rerun-run',
        status: 'interrupted',
        createdAt: '2026-03-12T18:00:00Z',
        activeAttempt: 1,
      }),
    );

    expect(summarizeScannedDurableRuns(scanDurableRunsForRecovery(runsRoot))).toEqual({
      total: 2,
      recoveryActions: {
        none: 0,
        resume: 1,
        rerun: 1,
        attention: 0,
        invalid: 0,
      },
      statuses: {
        running: 1,
        interrupted: 1,
      },
    });
  });

  it('rejects unsafe durable run status attempts', () => {
    const runsRoot = createTempDir('durable-runs-store-unsafe-attempt-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-unsafe');

    saveDurableRunStatus(paths.statusPath, {
      version: 1,
      runId: 'run-unsafe',
      status: 'running',
      createdAt: '2026-03-12T18:00:00.000Z',
      updatedAt: '2026-03-12T18:01:00.000Z',
      activeAttempt: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(loadDurableRunStatus(paths.statusPath)).toBeUndefined();
  });
});
