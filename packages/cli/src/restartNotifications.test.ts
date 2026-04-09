import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listProfileActivityEntries } from '@personal-agent/core';

const { getWebUiServiceStatusMock } = vi.hoisted(() => ({
  getWebUiServiceStatusMock: vi.fn(),
}));

vi.mock('@personal-agent/services', () => ({
  getWebUiServiceStatus: getWebUiServiceStatusMock,
}));

import {
  writeRestartCompletionInboxEntry,
  writeRestartFailureInboxEntry,
  writeUpdateCompletionInboxEntry,
  writeUpdateFailureInboxEntry,
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
  it('writes a deployment inbox item with restart details', () => {
    const stateRoot = createTempDir('pa-restart-notify-state-');
    const repoRoot = createTempDir('pa-restart-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeRelease: {
          revision: 'rev-123',
        },
      },
    });

    writeRestartCompletionInboxEntry({
      profile: 'datadog',
      repoRoot,
      requestedAt: '2026-03-13T14:42:36.000Z',
      daemonStatus: 'restarted (mode: managed service mock-daemon)',
      webUiStatus: 'restarted (mock-web-ui @ http://127.0.0.1:3741)',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry).toMatchObject({
      profile: 'datadog',
      kind: 'deployment',
      notificationState: 'none',
      summary: 'Application restart complete · rev-123',
    });
    expect(entries[0]?.entry.details).toContain('Managed web UI restart is complete.');
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
    expect(entries[0]?.entry.details).toContain('- Active release: rev-old');
  });

  it('writes an update completion inbox item with restart details', () => {
    const stateRoot = createTempDir('pa-update-notify-state-');
    const repoRoot = createTempDir('pa-update-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeRelease: {
          revision: 'rev-777',
        },
      },
    });

    writeUpdateCompletionInboxEntry({
      profile: 'datadog',
      repoRoot,
      requestedAt: '2026-03-13T14:42:36.000Z',
      daemonStatus: 'restarted (mode: managed service mock-daemon)',
      webUiStatus: 'restarted (mock-web-ui @ http://127.0.0.1:3741)',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Application update complete · rev-777');
    expect(entries[0]?.entry.details).toContain('Managed application update is complete.');
    expect(entries[0]?.entry.details).toContain('- Active release: rev-777');
  });

  it('writes a failure inbox item when application update does not complete', () => {
    const stateRoot = createTempDir('pa-update-notify-state-');
    const repoRoot = createTempDir('pa-update-notify-repo-');
    process.env.PERSONAL_AGENT_STATE_ROOT = stateRoot;

    getWebUiServiceStatusMock.mockReturnValue({
      url: 'http://127.0.0.1:3741',
      deployment: {
        activeRelease: {
          revision: 'rev-before-update',
        },
      },
    });

    writeUpdateFailureInboxEntry({
      profile: 'datadog',
      repoRoot,
      requestedAt: '2026-03-13T14:42:36.000Z',
      phase: 'pull latest changes from git',
      error: 'git pull failed',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Application update failed');
    expect(entries[0]?.entry.details).toContain('- Phase: pull latest changes from git');
    expect(entries[0]?.entry.details).toContain('- Error: git pull failed');
    expect(entries[0]?.entry.details).toContain('- Active release: rev-before-update');
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
      webUiStatus: 'restarted (mock-web-ui @ http://127.0.0.1:3741)',
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry.summary).toBe('Application restart complete');
    expect(entries[0]?.entry.details).toContain('- Service inspection: failed (service unavailable)');
  });
});
