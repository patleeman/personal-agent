import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readParallelState, readPersistedParallelJobs, resolveParallelJobsFile, type ParallelPromptJob } from './liveSessionParallelJobs.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('liveSessionParallelJobs', () => {
  it('rejects unsafe persisted parallel job image counts', () => {
    const dir = createTempDir('pa-parallel-jobs-');
    const sessionFile = join(dir, 'session.jsonl');
    writeFileSync(resolveParallelJobsFile(sessionFile), JSON.stringify([
      {
        id: 'job-1',
        prompt: 'Compare this screenshot.',
        childConversationId: 'child-1',
        status: 'ready',
        createdAt: '2026-03-12T20:00:00.000Z',
        updatedAt: '2026-03-12T20:01:00.000Z',
        imageCount: Number.MAX_SAFE_INTEGER + 1,
      },
    ]));

    expect(readPersistedParallelJobs(sessionFile)).toEqual([
      expect.objectContaining({ id: 'job-1', imageCount: 0 }),
    ]);
  });

  it('rejects unsafe parallel preview image counts', () => {
    const job: ParallelPromptJob = {
      id: 'job-unsafe',
      prompt: 'Compare this screenshot.',
      childConversationId: 'child-1',
      status: 'ready',
      createdAt: '2026-03-12T20:00:00.000Z',
      updatedAt: '2026-03-12T20:01:00.000Z',
      imageCount: Number.MAX_SAFE_INTEGER + 1,
      attachmentRefs: [],
      touchedFiles: [],
      parentTouchedFiles: [],
      overlapFiles: [],
      sideEffects: [],
      worktreeDirtyPathsAtStart: [],
    };

    expect(readParallelState([job])).toEqual([
      expect.objectContaining({ id: 'job-unsafe', imageCount: 0 }),
    ]);
  });
});
