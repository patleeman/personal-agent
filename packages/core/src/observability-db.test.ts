import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { resolveLegacyAppTelemetryDbPath, resolveLegacyTraceDbPath } from './observability-db.js';

describe('observability-db paths', () => {
  const testDir = join(tmpdir(), `observability-db-test-${randomUUID()}`);

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('falls back to legacy sync trace paths when direct legacy files are absent', () => {
    const tracePath = join(testDir, 'sync', 'pi-agent', 'state', 'trace', 'trace.db');
    const telemetryPath = join(testDir, 'sync', 'pi-agent', 'state', 'trace', 'app-telemetry.db');
    mkdirSync(dirname(tracePath), { recursive: true });
    writeFileSync(tracePath, '');
    writeFileSync(telemetryPath, '');

    expect(resolveLegacyTraceDbPath(testDir)).toBe(tracePath);
    expect(resolveLegacyAppTelemetryDbPath(testDir)).toBe(telemetryPath);
  });
});
