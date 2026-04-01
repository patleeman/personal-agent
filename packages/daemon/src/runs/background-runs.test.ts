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

    // Check run kind is background-run for agent targets
    expect(manifest?.kind).toBe('background-run');
    expect(manifest?.resumePolicy).toBe('manual');

    // Check that target contains the agent spec
    const target = manifest?.spec.target as Record<string, unknown>;
    expect(target?.type).toBe('agent');
    expect(target?.prompt).toBe('Review the latest diff');
    expect(target?.profile).toBe('datadog');
    expect(target?.model).toBe('openai-codex/gpt-5.4');

    // Check metadata contains task info
    const metadata = manifest?.spec.metadata as Record<string, unknown>;
    expect(metadata?.taskSlug).toBe('code-review');
    expect(metadata?.cwd).toBe('/tmp/workspace');

    // Check checkpoint payload
    const payload = checkpoint?.payload as Record<string, unknown>;
    const payloadTarget = payload?.target as Record<string, unknown>;
    expect(payloadTarget?.prompt).toBe('Review the latest diff');
    expect(metadata?.taskSlug).toBe('code-review');
  });
});
