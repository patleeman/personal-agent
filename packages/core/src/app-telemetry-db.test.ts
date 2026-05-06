import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeAppTelemetryDbs, queryAppTelemetryEvents, writeAppTelemetryEvent } from './app-telemetry-db.js';

describe('app-telemetry-db', () => {
  const testDir = join(tmpdir(), `app-telemetry-db-test-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;

  beforeAll(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    process.env.PERSONAL_AGENT_STATE_ROOT = testDir;
  });

  afterAll(() => {
    closeAppTelemetryDbs();
    if (originalRoot) {
      process.env.PERSONAL_AGENT_STATE_ROOT = originalRoot;
    } else {
      delete process.env.PERSONAL_AGENT_STATE_ROOT;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    closeAppTelemetryDbs();
    rmSync(join(testDir, 'pi-agent'), { recursive: true, force: true });
  });

  it('writes and queries generic telemetry events', () => {
    writeAppTelemetryEvent({
      source: 'renderer',
      category: 'navigation',
      name: 'route_view',
      route: '/telemetry',
      durationMs: 12.4,
      metadata: { viewport: { width: 1280, height: 720 } },
    });

    const rows = queryAppTelemetryEvents({ since: new Date(Date.now() - 60_000).toISOString() });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'renderer', category: 'navigation', name: 'route_view', route: '/telemetry' });
    expect(rows[0].durationMs).toBe(12.4);
    expect(rows[0].metadataJson).toContain('viewport');
  });

  it('drops events without category or name', () => {
    writeAppTelemetryEvent({ source: 'server', category: '', name: 'request' });
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: '' });

    expect(queryAppTelemetryEvents({ since: new Date(Date.now() - 60_000).toISOString() })).toHaveLength(0);
  });
});
