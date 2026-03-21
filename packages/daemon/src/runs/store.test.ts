import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  listDurableRunIds,
  resolveDurableRunsRoot,
  loadDurableRunCheckpoint,
  loadDurableRunManifest,
  loadDurableRunStatus,
  readDurableRunEvents,
  resolveDurableRunPaths,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  scanDurableRun,
  scanDurableRunsForRecovery,
  summarizeScannedDurableRuns,
  type DurableRunCheckpointFile,
} from './store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('durable run store', () => {
  afterEach(async () => {
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

  it('resolves the durable runs root under the daemon root', () => {
    const daemonRoot = createTempDir('durable-runs-store-root-');
    expect(resolveDurableRunsRoot(daemonRoot)).toBe(join(daemonRoot, 'runs'));
  });

  it('saves and loads manifest, status, and checkpoint files', () => {
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
  });

  it('appends and reads durable run events from the journal', async () => {
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

    const events = readDurableRunEvents(paths.eventsPath);

    expect(events).toEqual([
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
  });

  it('ignores malformed event lines instead of failing the whole journal read', () => {
    const runsRoot = createTempDir('durable-runs-store-bad-events-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-1');

    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.eventsPath, [
      JSON.stringify({
        version: 1,
        runId: 'run-1',
        timestamp: '2026-03-12T18:00:00Z',
        type: 'run.created',
      }),
      '{bad json',
      JSON.stringify({
        version: 1,
        runId: 'run-1',
        timestamp: 'not-a-date',
        type: 'broken',
      }),
      '',
    ].join('\n'));

    expect(readDurableRunEvents(paths.eventsPath)).toEqual([
      {
        version: 1,
        runId: 'run-1',
        timestamp: '2026-03-12T18:00:00.000Z',
        type: 'run.created',
        attempt: undefined,
        payload: undefined,
      },
    ]);
  });

  it('lists run ids from the durable runs root', () => {
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

    saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
      id: 'run-one',
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
      runId: 'run-one',
      status: 'running',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 1,
    }));

    expect(scanDurableRun(runsRoot, 'run-one')).toEqual(expect.objectContaining({
      runId: 'run-one',
      recoveryAction: 'resume',
      problems: [],
    }));
    expect(scanDurableRun(runsRoot, 'missing')).toBeUndefined();
  });

  it('classifies incomplete continue-policy runs as resumable on recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-resume-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-continue');

    saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
      id: 'run-continue',
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
      runId: 'run-continue',
      status: 'running',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 2,
    }));

    expect(scanDurableRunsForRecovery(runsRoot)).toEqual([
      expect.objectContaining({
        runId: 'run-continue',
        problems: [],
        recoveryAction: 'resume',
      }),
    ]);
  });

  it('classifies incomplete rerun-policy runs as rerun on recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-rerun-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-rerun');

    saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
      id: 'run-rerun',
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
      runId: 'run-rerun',
      status: 'interrupted',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 1,
    }));

    expect(scanDurableRunsForRecovery(runsRoot)).toEqual([
      expect.objectContaining({
        runId: 'run-rerun',
        problems: [],
        recoveryAction: 'rerun',
      }),
    ]);
  });

  it('classifies incomplete manual-policy runs as attention on recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-attention-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-manual');

    saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
      id: 'run-manual',
      kind: 'raw-shell',
      resumePolicy: 'manual',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
      runId: 'run-manual',
      status: 'running',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 1,
    }));

    expect(scanDurableRunsForRecovery(runsRoot)).toEqual([
      expect.objectContaining({
        runId: 'run-manual',
        problems: [],
        recoveryAction: 'attention',
      }),
    ]);
  });

  it('keeps queued and waiting manual background runs as attention on recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-manual-background-');

    const queuedPaths = resolveDurableRunPaths(runsRoot, 'run-background-queued');
    saveDurableRunManifest(queuedPaths.manifestPath, createDurableRunManifest({
      id: 'run-background-queued',
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(queuedPaths.statusPath, createInitialDurableRunStatus({
      runId: 'run-background-queued',
      status: 'queued',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 0,
    }));

    const waitingPaths = resolveDurableRunPaths(runsRoot, 'run-background-waiting');
    saveDurableRunManifest(waitingPaths.manifestPath, createDurableRunManifest({
      id: 'run-background-waiting',
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-12T18:01:00Z',
    }));
    saveDurableRunStatus(waitingPaths.statusPath, createInitialDurableRunStatus({
      runId: 'run-background-waiting',
      status: 'waiting',
      createdAt: '2026-03-12T18:01:00Z',
      activeAttempt: 0,
    }));

    expect(scanDurableRunsForRecovery(runsRoot)).toEqual([
      expect.objectContaining({
        runId: 'run-background-queued',
        problems: [],
        recoveryAction: 'attention',
      }),
      expect.objectContaining({
        runId: 'run-background-waiting',
        problems: [],
        recoveryAction: 'attention',
      }),
    ]);
  });

  it('treats terminal runs as not needing recovery', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-terminal-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-complete');

    saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
      id: 'run-complete',
      kind: 'workflow',
      resumePolicy: 'continue',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
      runId: 'run-complete',
      status: 'completed',
      createdAt: '2026-03-12T18:00:00Z',
      updatedAt: '2026-03-12T18:05:00Z',
      activeAttempt: 1,
    }));

    expect(scanDurableRunsForRecovery(runsRoot)).toEqual([
      expect.objectContaining({
        runId: 'run-complete',
        problems: [],
        recoveryAction: 'none',
      }),
    ]);
  });

  it('marks invalid run records during recovery scan', () => {
    const runsRoot = createTempDir('durable-runs-store-scan-invalid-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-bad');

    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.manifestPath, JSON.stringify({ id: 'different-id' }));
    writeFileSync(paths.statusPath, JSON.stringify({ runId: 'also-different' }));

    const [scan] = scanDurableRunsForRecovery(runsRoot);

    expect(scan?.runId).toBe('run-bad');
    expect(scan?.recoveryAction).toBe('invalid');
    expect(scan?.problems).toEqual([
      'missing or invalid manifest',
      'missing or invalid status',
    ]);
  });

  it('summarizes scanned durable runs by recovery action and status', () => {
    const runsRoot = createTempDir('durable-runs-store-summary-');

    const resumePaths = resolveDurableRunPaths(runsRoot, 'resume-run');
    saveDurableRunManifest(resumePaths.manifestPath, createDurableRunManifest({
      id: 'resume-run',
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(resumePaths.statusPath, createInitialDurableRunStatus({
      runId: 'resume-run',
      status: 'running',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 1,
    }));

    const rerunPaths = resolveDurableRunPaths(runsRoot, 'rerun-run');
    saveDurableRunManifest(rerunPaths.manifestPath, createDurableRunManifest({
      id: 'rerun-run',
      kind: 'scheduled-task',
      resumePolicy: 'rerun',
      createdAt: '2026-03-12T18:00:00Z',
    }));
    saveDurableRunStatus(rerunPaths.statusPath, createInitialDurableRunStatus({
      runId: 'rerun-run',
      status: 'interrupted',
      createdAt: '2026-03-12T18:00:00Z',
      activeAttempt: 1,
    }));

    const summary = summarizeScannedDurableRuns(scanDurableRunsForRecovery(runsRoot));

    expect(summary).toEqual({
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

  it('writes files under the resolved run paths', () => {
    const runsRoot = createTempDir('durable-runs-store-paths-');
    const paths = resolveDurableRunPaths(runsRoot, 'run-1');

    saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({ runId: 'run-1' }));

    expect(existsSync(paths.root)).toBe(true);
    expect(existsSync(paths.statusPath)).toBe(true);
    expect(JSON.parse(readFileSync(paths.statusPath, 'utf-8'))).toMatchObject({
      runId: 'run-1',
      status: 'queued',
    });
  });
});
