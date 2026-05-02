import { describe, expect, it } from 'vitest';

describe('scheduleRun', () => {
  it('creates a run with correct kind for agent target', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tempDir = mkdtempSync(join(tmpdir(), 'schedule-run-test-'));

    const { scheduleRun } = await import('./schedule-run.js');
    const { loadDurableRunManifest, loadDurableRunStatus } = await import('./store.js');

    const result = await scheduleRun(tempDir, {
      trigger: { type: 'now' },
      target: { type: 'agent', prompt: 'do stuff' },
    });

    expect(result.runId).toMatch(/^run-run-/);
    expect(result.kind).toBe('background-run');
    expect(result.resumePolicy).toBe('manual');

    const manifest = loadDurableRunManifest(result.paths.manifestPath);
    expect(manifest?.kind).toBe('background-run');
    expect(manifest?.resumePolicy).toBe('manual');

    const status = loadDurableRunStatus(result.paths.statusPath);
    expect(status?.status).toBe('queued');
  });

  it('creates a run with correct kind for conversation target', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tempDir = mkdtempSync(join(tmpdir(), 'schedule-run-test-'));

    const { scheduleRun } = await import('./schedule-run.js');
    const { loadDurableRunManifest } = await import('./store.js');

    const result = await scheduleRun(tempDir, {
      conversation: { id: 'conv-123', state: 'open' },
      trigger: { type: 'now' },
      target: { type: 'conversation', conversationId: 'conv-123', prompt: 'check status' },
    });

    expect(result.kind).toBe('conversation');
    expect(result.resumePolicy).toBe('continue');

    const manifest = loadDurableRunManifest(result.paths.manifestPath);
    expect(manifest?.kind).toBe('conversation');
    expect(manifest?.resumePolicy).toBe('continue');
    expect(manifest?.rootId).toBe('conv-123');
  });

  it('creates a run with correct kind for shell target', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tempDir = mkdtempSync(join(tmpdir(), 'schedule-run-test-'));

    const { scheduleRun } = await import('./schedule-run.js');
    const { loadDurableRunManifest } = await import('./store.js');

    const result = await scheduleRun(tempDir, {
      trigger: { type: 'now' },
      target: { type: 'shell', command: 'ls -la' },
    });

    expect(result.kind).toBe('raw-shell');
    expect(result.resumePolicy).toBe('manual');

    const manifest = loadDurableRunManifest(result.paths.manifestPath);
    expect(manifest?.kind).toBe('raw-shell');
  });

  it('creates a deferred run with waiting status', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tempDir = mkdtempSync(join(tmpdir(), 'schedule-run-test-'));

    const { scheduleRun } = await import('./schedule-run.js');
    const { loadDurableRunStatus } = await import('./store.js');

    const result = await scheduleRun(tempDir, {
      trigger: { type: 'defer', delay: '1h' },
      target: { type: 'agent', prompt: 'do stuff later' },
    });

    const status = loadDurableRunStatus(result.paths.statusPath);
    expect(status?.status).toBe('waiting');
  });

  it('stores spec with callback defaults', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tempDir = mkdtempSync(join(tmpdir(), 'schedule-run-test-'));

    const { scheduleRun } = await import('./schedule-run.js');
    const { loadDurableRunManifest } = await import('./store.js');

    const result = await scheduleRun(tempDir, {
      trigger: { type: 'now' },
      target: { type: 'agent', prompt: 'do stuff' },
    });

    const manifest = loadDurableRunManifest(result.paths.manifestPath);
    expect(manifest?.spec.callback).toEqual({
      alertLevel: 'passive',
      autoResumeIfOpen: true,
      requireAck: false,
    });
  });

  it('accepts custom callback options', async () => {
    const { mkdtempSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');

    const tempDir = mkdtempSync(join(tmpdir(), 'schedule-run-test-'));

    const { scheduleRun } = await import('./schedule-run.js');
    const { loadDurableRunManifest } = await import('./store.js');

    const result = await scheduleRun(tempDir, {
      trigger: { type: 'now' },
      target: { type: 'agent', prompt: 'do stuff' },
      callback: {
        alertLevel: 'disruptive',
        autoResumeIfOpen: false,
        requireAck: true,
      },
    });

    const manifest = loadDurableRunManifest(result.paths.manifestPath);
    expect(manifest?.spec.callback).toEqual({
      alertLevel: 'disruptive',
      autoResumeIfOpen: false,
      requireAck: true,
    });
  });
});
