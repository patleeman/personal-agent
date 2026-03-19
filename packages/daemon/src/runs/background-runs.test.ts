import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadDurableRunCheckpoint, loadDurableRunManifest } from './store.js';
import { createBackgroundRunRecord } from './background-runs.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('createBackgroundRunRecord', () => {
  it('materializes agent runs into durable argv and stores the structured agent spec', async () => {
    const runsRoot = createTempDir('pa-background-run-record-');
    const record = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      agent: {
        prompt: 'Review the latest diff',
        profile: 'datadog',
        model: 'openai-codex/gpt-5.4',
      },
      createdAt: '2026-03-19T20:00:00.000Z',
    });

    expect(record.argv).toBeDefined();
    expect(record.shellCommand).toBeUndefined();
    expect(record.argv).toContain('tui');
    expect(record.argv).toContain('--plain');
    expect(record.argv).toContain('--profile');
    expect(record.argv).toContain('datadog');
    expect(record.argv).toContain('--model');
    expect(record.argv).toContain('openai-codex/gpt-5.4');
    expect(record.argv).toContain('-p');
    expect(record.argv).toContain('Review the latest diff');

    const manifest = loadDurableRunManifest(record.paths.manifestPath);
    const checkpoint = loadDurableRunCheckpoint(record.paths.checkpointPath);

    expect(manifest?.spec).toMatchObject({
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      agent: {
        prompt: 'Review the latest diff',
        profile: 'datadog',
        model: 'openai-codex/gpt-5.4',
      },
      argv: record.argv,
    });
    expect(checkpoint?.payload).toMatchObject({
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      agent: {
        prompt: 'Review the latest diff',
        profile: 'datadog',
        model: 'openai-codex/gpt-5.4',
      },
      argv: record.argv,
    });
  });
});
