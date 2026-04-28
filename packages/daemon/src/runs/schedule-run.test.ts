import { describe, expect, it } from 'vitest';
import {
  deriveResumePolicy,
  deriveRunKind,
  formatDelay,
  isActiveStatus,
  isTerminalStatus,
  isWaitingStatus,
  parseDelayToMs,
  resolveCallback,
  resolveLoopOptions,
  validateScheduleRunInput,
  type ScheduleRunInput,
} from './schedule-run.js';

describe('deriveRunKind', () => {
  it('returns conversation for conversation target', () => {
    expect(deriveRunKind({ type: 'conversation', conversationId: 'x', prompt: 'y' })).toBe('conversation');
  });

  it('returns raw-shell for shell target', () => {
    expect(deriveRunKind({ type: 'shell', command: 'ls' })).toBe('raw-shell');
  });

  it('returns background-run for agent target', () => {
    expect(deriveRunKind({ type: 'agent', prompt: 'do stuff' })).toBe('background-run');
  });
});

describe('deriveResumePolicy', () => {
  it('returns continue for conversation target', () => {
    const input: ScheduleRunInput = {
      trigger: { type: 'now' },
      target: { type: 'conversation', conversationId: 'x', prompt: 'y' },
    };
    expect(deriveResumePolicy(input.trigger, input.target)).toBe('continue');
  });

  it('returns continue for loop-enabled runs', () => {
    const input: ScheduleRunInput = {
      trigger: { type: 'now' },
      target: { type: 'shell', command: 'ls' },
      loop: { enabled: true },
    };
    expect(deriveResumePolicy(input.trigger, input.target, input.loop)).toBe('continue');
  });

  it('returns rerun for cron triggers', () => {
    const input: ScheduleRunInput = {
      trigger: { type: 'cron', expression: '0 9 * * *' },
      target: { type: 'agent', prompt: 'do stuff' },
    };
    expect(deriveResumePolicy(input.trigger, input.target)).toBe('rerun');
  });

  it('returns rerun for at triggers', () => {
    const input: ScheduleRunInput = {
      trigger: { type: 'at', at: new Date() },
      target: { type: 'agent', prompt: 'do stuff' },
    };
    expect(deriveResumePolicy(input.trigger, input.target)).toBe('rerun');
  });

  it('returns manual for immediate shell runs', () => {
    const input: ScheduleRunInput = {
      trigger: { type: 'now' },
      target: { type: 'shell', command: 'ls' },
    };
    expect(deriveResumePolicy(input.trigger, input.target)).toBe('manual');
  });

  it('returns manual for deferred runs', () => {
    const input: ScheduleRunInput = {
      trigger: { type: 'defer', delay: '1h' },
      target: { type: 'agent', prompt: 'do stuff' },
    };
    expect(deriveResumePolicy(input.trigger, input.target)).toBe('manual');
  });
});

describe('resolveCallback', () => {
  it('returns defaults when no input', () => {
    expect(resolveCallback()).toEqual({
      alertLevel: 'passive',
      autoResumeIfOpen: true,
      requireAck: false,
    });
  });

  it('merges partial input with defaults', () => {
    expect(resolveCallback({ alertLevel: 'disruptive' })).toEqual({
      alertLevel: 'disruptive',
      autoResumeIfOpen: true,
      requireAck: false,
    });
  });

  it('allows overriding all fields', () => {
    expect(resolveCallback({ alertLevel: 'none', autoResumeIfOpen: false, requireAck: true })).toEqual({
      alertLevel: 'none',
      autoResumeIfOpen: false,
      requireAck: true,
    });
  });
});

describe('resolveLoopOptions', () => {
  it('returns undefined when loop is not enabled', () => {
    expect(resolveLoopOptions({ enabled: false })).toBeUndefined();
    expect(resolveLoopOptions(undefined)).toBeUndefined();
  });

  it('returns loop options with defaults', () => {
    const result = resolveLoopOptions({ enabled: true });
    expect(result?.enabled).toBe(true);
    expect(result?.delay).toBe('1h');
    expect(result?.retry?.attempts).toBe(3);
    expect(result?.retry?.backoff).toBe('exponential');
    expect(result?.retry?.maxDelay).toBe('10m');
  });

  it('merges user options with defaults', () => {
    const result = resolveLoopOptions({
      enabled: true,
      delay: '30m',
      maxIterations: 10,
      retry: { attempts: 5 },
    });
    expect(result?.delay).toBe('30m');
    expect(result?.maxIterations).toBe(10);
    expect(result?.retry?.attempts).toBe(5);
    expect(result?.retry?.backoff).toBe('exponential'); // default
  });
});

describe('parseDelayToMs', () => {
  it('parses seconds', () => {
    expect(parseDelayToMs('30s')).toBe(30_000);
    expect(parseDelayToMs('1s')).toBe(1_000);
  });

  it('parses minutes', () => {
    expect(parseDelayToMs('10m')).toBe(10 * 60_000);
    expect(parseDelayToMs('1m')).toBe(60_000);
  });

  it('parses hours', () => {
    expect(parseDelayToMs('2h')).toBe(2 * 60 * 60_000);
    expect(parseDelayToMs('1h')).toBe(60 * 60_000);
  });

  it('parses days', () => {
    expect(parseDelayToMs('1d')).toBe(24 * 60 * 60_000);
    expect(parseDelayToMs('7d')).toBe(7 * 24 * 60 * 60_000);
  });

  it('parses fractional values', () => {
    expect(parseDelayToMs('1.5h')).toBe(90 * 60_000);
  });

  it('returns undefined for invalid formats', () => {
    expect(parseDelayToMs('abc')).toBeUndefined();
    expect(parseDelayToMs('1x')).toBeUndefined();
    expect(parseDelayToMs('')).toBeUndefined();
    expect(parseDelayToMs('1')).toBeUndefined();
    expect(parseDelayToMs(`${Number.MAX_SAFE_INTEGER}d`)).toBeUndefined();
  });
});

describe('formatDelay', () => {
  it('formats seconds', () => {
    expect(formatDelay(30_000)).toBe('30s');
  });

  it('formats minutes', () => {
    expect(formatDelay(5 * 60_000)).toBe('5m');
  });

  it('formats hours', () => {
    expect(formatDelay(2 * 60 * 60_000)).toBe('2h');
  });

  it('formats days', () => {
    expect(formatDelay(3 * 24 * 60 * 60_000)).toBe('3d');
  });
});

describe('isTerminalStatus', () => {
  it('returns true for terminal statuses', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('waiting')).toBe(false);
  });
});

describe('isWaitingStatus', () => {
  it('returns true for queued and waiting', () => {
    expect(isWaitingStatus('queued')).toBe(true);
    expect(isWaitingStatus('waiting')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isWaitingStatus('running')).toBe(false);
    expect(isWaitingStatus('completed')).toBe(false);
  });
});

describe('isActiveStatus', () => {
  it('returns true for running and recovering', () => {
    expect(isActiveStatus('running')).toBe(true);
    expect(isActiveStatus('recovering')).toBe(true);
  });

  it('returns false for other statuses', () => {
    expect(isActiveStatus('queued')).toBe(false);
    expect(isActiveStatus('completed')).toBe(false);
  });
});

describe('validateScheduleRunInput', () => {
  it('accepts valid now trigger', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid defer trigger', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'defer', delay: '1h' },
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid at trigger', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'at', at: new Date() },
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid cron trigger', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'cron', expression: '0 9 * * *' },
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid conversation target', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'conversation', conversationId: 'conv-123', prompt: 'check status' },
    });
    expect(errors).toHaveLength(0);
  });

  it('accepts valid shell target', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'shell', command: 'ls -la' },
    });
    expect(errors).toHaveLength(0);
  });

  it('rejects missing trigger', () => {
    const errors = validateScheduleRunInput({
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors.some((e) => e.field === 'trigger')).toBe(true);
  });

  it('rejects invalid trigger type', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'invalid' as any },
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors.some((e) => e.field === 'trigger.type')).toBe(true);
  });

  it('rejects invalid defer delay format', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'defer', delay: 'invalid' },
      target: { type: 'agent', prompt: 'do stuff' },
    });
    expect(errors.some((e) => e.field === 'trigger.delay')).toBe(true);
  });

  it('rejects missing target', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
    });
    expect(errors.some((e) => e.field === 'target')).toBe(true);
  });

  it('rejects conversation target without conversationId', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'conversation', prompt: 'check status' } as any,
    });
    expect(errors.some((e) => e.field === 'target.conversationId')).toBe(true);
  });

  it('rejects agent target without prompt', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'agent' } as any,
    });
    expect(errors.some((e) => e.field === 'target.prompt')).toBe(true);
  });

  it('rejects shell target without command', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'shell' } as any,
    });
    expect(errors.some((e) => e.field === 'target.command')).toBe(true);
  });

  it('rejects invalid loop.maxIterations', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'agent', prompt: 'do stuff' },
      loop: { enabled: true, maxIterations: 0 },
    });
    expect(errors.some((e) => e.field === 'loop.maxIterations')).toBe(true);
  });

  it('rejects invalid loop.delay format', () => {
    const errors = validateScheduleRunInput({
      trigger: { type: 'now' },
      target: { type: 'agent', prompt: 'do stuff' },
      loop: { enabled: true, delay: 'bad' },
    });
    expect(errors.some((e) => e.field === 'loop.delay')).toBe(true);
  });
});

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
