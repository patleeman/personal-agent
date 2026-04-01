import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDurableRunManifest,
  createInitialDurableRunStatus,
  saveDurableRunManifest,
  saveDurableRunStatus,
} from './store.js';
import {
  deriveLoopState,
  shouldExecuteIteration,
  computeBackoffDelay,
  shouldRetry,
  hasExceededMaxIterations,
  type LoopState,
} from './loop-state.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'loop-state-test-'));
}

describe('deriveLoopState', () => {
  it('returns idle when no children', () => {
    const runsRoot = createTempDir();
    expect(deriveLoopState(runsRoot, 'loop-1')).toBe('idle' as LoopState);
  });

  it('returns idle when all children are terminal', () => {
    const runsRoot = createTempDir();
    
    // Create loop parent
    saveDurableRunManifest(join(runsRoot, 'loop-1', 'manifest.json'), createDurableRunManifest({
      id: 'loop-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    // Create completed child
    const childPaths = join(runsRoot, 'child-1');
    saveDurableRunManifest(join(childPaths, 'manifest.json'), createDurableRunManifest({
      id: 'child-1',
      kind: 'background-run',
      resumePolicy: 'manual',
      parentId: 'loop-1',
    }));
    saveDurableRunStatus(join(childPaths, 'status.json'), createInitialDurableRunStatus({
      runId: 'child-1',
      status: 'completed',
    }));

    expect(deriveLoopState(runsRoot, 'loop-1')).toBe('idle' as LoopState);
  });

  it('returns running when any child is running', () => {
    const runsRoot = createTempDir();
    
    saveDurableRunManifest(join(runsRoot, 'loop-1', 'manifest.json'), createDurableRunManifest({
      id: 'loop-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    const childPaths = join(runsRoot, 'child-1');
    saveDurableRunManifest(join(childPaths, 'manifest.json'), createDurableRunManifest({
      id: 'child-1',
      kind: 'background-run',
      resumePolicy: 'manual',
      parentId: 'loop-1',
    }));
    saveDurableRunStatus(join(childPaths, 'status.json'), createInitialDurableRunStatus({
      runId: 'child-1',
      status: 'running',
    }));

    expect(deriveLoopState(runsRoot, 'loop-1')).toBe('running' as LoopState);
  });

  it('returns waiting when child is queued', () => {
    const runsRoot = createTempDir();
    
    saveDurableRunManifest(join(runsRoot, 'loop-1', 'manifest.json'), createDurableRunManifest({
      id: 'loop-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    const childPaths = join(runsRoot, 'child-1');
    saveDurableRunManifest(join(childPaths, 'manifest.json'), createDurableRunManifest({
      id: 'child-1',
      kind: 'background-run',
      resumePolicy: 'manual',
      parentId: 'loop-1',
    }));
    saveDurableRunStatus(join(childPaths, 'status.json'), createInitialDurableRunStatus({
      runId: 'child-1',
      status: 'queued',
    }));

    expect(deriveLoopState(runsRoot, 'loop-1')).toBe('waiting' as LoopState);
  });
});

describe('shouldExecuteIteration', () => {
  it('returns execute for idle loop (first iteration)', () => {
    const runsRoot = createTempDir();
    
    saveDurableRunManifest(join(runsRoot, 'run-1', 'manifest.json'), createDurableRunManifest({
      id: 'run-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    expect(shouldExecuteIteration(runsRoot, 'run-1')).toBe('execute');
  });

  it('returns skip when loop has running child', () => {
    const runsRoot = createTempDir();
    
    // Create parent loop
    saveDurableRunManifest(join(runsRoot, 'loop-1', 'manifest.json'), createDurableRunManifest({
      id: 'loop-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    // Create running child
    const childPaths = join(runsRoot, 'child-1');
    saveDurableRunManifest(join(childPaths, 'manifest.json'), createDurableRunManifest({
      id: 'child-1',
      kind: 'background-run',
      resumePolicy: 'manual',
      parentId: 'loop-1',
    }));
    saveDurableRunStatus(join(childPaths, 'status.json'), createInitialDurableRunStatus({
      runId: 'child-1',
      status: 'running',
    }));

    // New iteration should skip
    expect(shouldExecuteIteration(runsRoot, 'child-2')).toBe('skip');
  });
});

describe('computeBackoffDelay', () => {
  it('computes linear backoff', () => {
    expect(computeBackoffDelay(1, 'linear', 1000, 10000)).toBe(1000);
    expect(computeBackoffDelay(2, 'linear', 1000, 10000)).toBe(2000);
    expect(computeBackoffDelay(3, 'linear', 1000, 10000)).toBe(3000);
  });

  it('computes exponential backoff', () => {
    expect(computeBackoffDelay(1, 'exponential', 1000, 10000)).toBe(1000);
    expect(computeBackoffDelay(2, 'exponential', 1000, 10000)).toBe(2000);
    expect(computeBackoffDelay(3, 'exponential', 1000, 10000)).toBe(4000);
  });

  it('caps at max delay', () => {
    expect(computeBackoffDelay(10, 'exponential', 1000, 5000)).toBe(5000);
  });
});

describe('shouldRetry', () => {
  it('returns retry for attempts under limit', () => {
    const options = { enabled: true, retry: { attempts: 3 } };
    expect(shouldRetry(options, 0)).toEqual({ retry: true, delayMs: expect.any(Number) });
    expect(shouldRetry(options, 1)).toEqual({ retry: true, delayMs: expect.any(Number) });
    expect(shouldRetry(options, 2)).toEqual({ retry: true, delayMs: expect.any(Number) });
  });

  it('returns no retry at attempt limit', () => {
    const options = { enabled: true, retry: { attempts: 3 } };
    expect(shouldRetry(options, 3)).toEqual({ retry: false });
  });

  it('returns no retry without retry options', () => {
    const options = { enabled: true };
    expect(shouldRetry(options, 0)).toEqual({ retry: false });
  });
});

describe('hasExceededMaxIterations', () => {
  it('returns false when under limit', () => {
    const runsRoot = createTempDir();
    
    saveDurableRunManifest(join(runsRoot, 'loop-1', 'manifest.json'), createDurableRunManifest({
      id: 'loop-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    // Create 2 completed children
    for (let i = 1; i <= 2; i++) {
      const childPaths = join(runsRoot, `child-${i}`);
      saveDurableRunManifest(join(childPaths, 'manifest.json'), createDurableRunManifest({
        id: `child-${i}`,
        kind: 'background-run',
        resumePolicy: 'manual',
        parentId: 'loop-1',
      }));
      saveDurableRunStatus(join(childPaths, 'status.json'), createInitialDurableRunStatus({
        runId: `child-${i}`,
        status: 'completed',
      }));
    }

    expect(hasExceededMaxIterations(runsRoot, 'loop-1', 5)).toBe(false);
  });

  it('returns true when at limit', () => {
    const runsRoot = createTempDir();
    
    saveDurableRunManifest(join(runsRoot, 'loop-1', 'manifest.json'), createDurableRunManifest({
      id: 'loop-1',
      kind: 'background-run',
      resumePolicy: 'continue',
    }));

    // Create 3 completed children
    for (let i = 1; i <= 3; i++) {
      const childPaths = join(runsRoot, `child-${i}`);
      saveDurableRunManifest(join(childPaths, 'manifest.json'), createDurableRunManifest({
        id: `child-${i}`,
        kind: 'background-run',
        resumePolicy: 'manual',
        parentId: 'loop-1',
      }));
      saveDurableRunStatus(join(childPaths, 'status.json'), createInitialDurableRunStatus({
        runId: `child-${i}`,
        status: 'completed',
      }));
    }

    expect(hasExceededMaxIterations(runsRoot, 'loop-1', 3)).toBe(true);
  });

  it('returns false when no max set', () => {
    const runsRoot = createTempDir();
    expect(hasExceededMaxIterations(runsRoot, 'loop-1', undefined)).toBe(false);
  });
});
