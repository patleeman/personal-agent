import { existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listProfileActivityEntries } from '@personal-agent/core';

const { getWebUiServiceStatusMock } = vi.hoisted(() => ({
  getWebUiServiceStatusMock: vi.fn(),
}));

vi.mock('@personal-agent/gateway', () => ({
  getWebUiServiceStatus: getWebUiServiceStatusMock,
}));

import {
  writeRestartCompletionInboxEntry,
  writeRestartFailureInboxEntry,
  writeWebUiMarkedBadInboxEntry,
  writeWebUiRollbackInboxEntry,
} from './restartNotifications.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  getWebUiServiceStatusMock.mockReset();
});

afterEach(async () => {
  process.env = originalEnv;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

describe('restart notification inbox entries', () => {
  it('writes a deployment inbox item with blue/green cutover details', () => {
    const stateRoot = createTempDir('pa-restart-notify-state-');
    const repoRoot = createTempDir('pa-restart-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeSlot: 'green',
        activeRelease: {
          revision: 'rev-123',
        },
      },
    });

    const path = writeRestartCompletionInboxEntry({
      profile: 'datadog',
      repoRoot,
      requestedAt: '2026-03-13T14:42:36.000Z',
      daemonStatus: 'restarted (mode: managed service mock-daemon)',
      webUiStatus: 'blue/green swapped blue → green (rev-123)',
      restartedGatewayServices: ['telegram'],
      skippedGatewayServices: [],
    });

    expect(existsSync(path)).toBe(true);

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry).toMatchObject({
      profile: 'datadog',
      kind: 'deployment',
      notificationState: 'none',
      summary: 'Application restart complete · green live · rev-123',
    });
    expect(entries[0]?.entry.details).toContain('Managed web UI blue/green cutover is complete.');
    expect(entries[0]?.entry.details).toContain('- Active slot: green');
    expect(entries[0]?.entry.details).toContain('- Active release: rev-123');
    expect(entries[0]?.entry.details).toContain('- URL: http://127.0.0.1:3741');
  });

  it('writes a failure inbox item when application restart does not complete', () => {
    const stateRoot = createTempDir('pa-restart-notify-state-');
    const repoRoot = createTempDir('pa-restart-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeSlot: 'blue',
        activeRelease: {
          revision: 'rev-old',
        },
      },
    });

    writeRestartFailureInboxEntry({
      profile: 'datadog',
      repoRoot,
      requestedAt: '2026-03-13T14:42:36.000Z',
      phase: 'rebuild packages',
      error: 'npm run build failed',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Application restart failed');
    expect(entries[0]?.entry.details).toContain('- Phase: rebuild packages');
    expect(entries[0]?.entry.details).toContain('- Error: npm run build failed');
    expect(entries[0]?.entry.details).toContain('- Last active slot: blue');
    expect(entries[0]?.entry.details).toContain('- Last active release: rev-old');
  });

  it('writes a rollback inbox item with restored release details', () => {
    const stateRoot = createTempDir('pa-restart-notify-state-');
    const repoRoot = createTempDir('pa-restart-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeSlot: 'blue',
        activeRelease: {
          revision: 'rev-101',
        },
      },
    });

    writeWebUiRollbackInboxEntry({
      profile: 'datadog',
      repoRoot,
      rolledBackFromSlot: 'green',
      rolledBackFromRevision: 'rev-202',
      restoredSlot: 'blue',
      restoredRevision: 'rev-101',
      reason: 'candidate checks regressed',
      markedBadRevision: 'rev-202',
      markedBadReason: 'candidate checks regressed',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Web UI rollback complete · blue live · rev-101');
    expect(entries[0]?.entry.details).toContain('- Rolled back from: green · rev-202');
    expect(entries[0]?.entry.details).toContain('- Restored release: blue · rev-101');
    expect(entries[0]?.entry.details).toContain('- Marked bad: rev-202 · candidate checks regressed');
  });

  it('writes a mark-bad inbox item for the active release', () => {
    const stateRoot = createTempDir('pa-restart-notify-state-');
    const repoRoot = createTempDir('pa-restart-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeSlot: 'green',
        activeRelease: {
          revision: 'rev-404',
        },
      },
    });

    writeWebUiMarkedBadInboxEntry({
      profile: 'datadog',
      repoRoot,
      slot: 'green',
      revision: 'rev-404',
      reason: 'manual rollback requested',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Web UI release marked bad · rev-404 · green');
    expect(entries[0]?.entry.details).toContain('- Revision: rev-404');
    expect(entries[0]?.entry.details).toContain('- Reason: manual rollback requested');
    expect(entries[0]?.entry.details).toContain('- Active slot: green');
  });

  it('still writes a restart completion inbox item when post-restart service inspection fails', () => {
    const stateRoot = createTempDir('pa-restart-notify-state-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockImplementation(() => {
      throw new Error('service unavailable');
    });

    writeRestartCompletionInboxEntry({
      profile: 'datadog',
      requestedAt: '2026-03-13T14:42:36.000Z',
      daemonStatus: 'restarted (mode: detached)',
      webUiStatus: 'blue/green swapped blue → green',
      restartedGatewayServices: [],
      skippedGatewayServices: ['telegram'],
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Application restart complete');
    expect(entries[0]?.entry.details).toContain('- Service inspection: failed (service unavailable)');
    expect(entries[0]?.entry.details).toContain('- Gateway services skipped: telegram');
  });
});
