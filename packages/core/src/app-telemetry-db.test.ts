import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeAppTelemetryDbs, maintainAppTelemetryDb, queryAppTelemetryEvents, writeAppTelemetryEvent } from './app-telemetry-db.js';
import { exportAppTelemetryLogBundle, listAppTelemetryLogFiles, resolveAppTelemetryLogPath } from './app-telemetry-log.js';
import { openSqliteDatabase } from './sqlite.js';
import { closeTraceDbs, maintainTraceDb, writeTraceStats } from './trace-db.js';

describe('app-telemetry-db', () => {
  const testDir = join(tmpdir(), `app-telemetry-db-test-${randomUUID()}`);
  const originalRoot = process.env.PERSONAL_AGENT_STATE_ROOT;
  const originalTelemetryMaxEvents = process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS;
  const originalTelemetryMaxBytes = process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES;

  beforeAll(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
    process.env.PERSONAL_AGENT_STATE_ROOT = testDir;
  });

  afterAll(() => {
    closeAppTelemetryDbs();
    closeTraceDbs();
    if (originalRoot) {
      process.env.PERSONAL_AGENT_STATE_ROOT = originalRoot;
    } else {
      delete process.env.PERSONAL_AGENT_STATE_ROOT;
    }
    if (originalTelemetryMaxEvents) {
      process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS = originalTelemetryMaxEvents;
    } else {
      delete process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS;
    }
    if (originalTelemetryMaxBytes) {
      process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES = originalTelemetryMaxBytes;
    } else {
      delete process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES;
    }
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    closeAppTelemetryDbs();
    closeTraceDbs();
    delete process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS;
    delete process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES;
    rmSync(join(testDir, 'pi-agent'), { recursive: true, force: true });
    rmSync(join(testDir, 'observability'), { recursive: true, force: true });
    rmSync(join(testDir, 'logs'), { recursive: true, force: true });
  });

  it('writes and queries generic telemetry events from JSONL logs', () => {
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

    const logPath = resolveAppTelemetryLogPath(rows[0].ts, testDir);
    const logLine = readFileSync(logPath, 'utf-8').trim();
    expect(JSON.parse(logLine)).toMatchObject({ schemaVersion: 1, category: 'navigation', name: 'route_view' });
  });

  it('queries JSONL telemetry when the SQLite index is unavailable', () => {
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'request', route: '/health' });
    closeAppTelemetryDbs();
    rmSync(join(testDir, 'observability'), { recursive: true, force: true });

    const rows = queryAppTelemetryEvents({ since: new Date(Date.now() - 60_000).toISOString() });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'server', category: 'api', name: 'request', route: '/health' });
  });

  it('lists and exports telemetry log files', () => {
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'request', route: '/health' });
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'response', route: '/health' });

    const files = listAppTelemetryLogFiles(testDir);
    const exported = exportAppTelemetryLogBundle({ stateRoot: testDir });
    const exportContent = readFileSync(exported.path, 'utf-8');

    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^app-telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/);
    expect(exported).toMatchObject({ fileCount: 1, eventCount: 2 });
    expect(exportContent).toContain('"name":"request"');
    expect(exportContent).toContain('"name":"response"');
  });

  it('rotates telemetry log files by size', () => {
    process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES = '260';

    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'first', metadata: { payload: 'x'.repeat(80) } });
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'second', metadata: { payload: 'y'.repeat(80) } });

    const files = listAppTelemetryLogFiles(testDir);

    expect(files.map((file) => file.name)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^app-telemetry-\d{4}-\d{2}-\d{2}\.jsonl$/),
        expect.stringMatching(/^app-telemetry-\d{4}-\d{2}-\d{2}\.1\.jsonl$/),
      ]),
    );
  });

  it('runs telemetry database maintenance', () => {
    for (let index = 0; index < 1250; index += 1) {
      writeAppTelemetryEvent({ source: 'server', category: 'test', name: `event-${index}` });
    }
    process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS = '1000';

    const appResult = maintainAppTelemetryDb(testDir);
    const traceResult = maintainTraceDb(testDir);

    expect(appResult).toMatchObject({ maxEvents: 1000, remainingRows: 1000, vacuumed: true });
    expect(appResult.deletedRows).toBeGreaterThanOrEqual(250);
    expect(traceResult.vacuumed).toBe(true);
  });

  it('deletes legacy app telemetry DB after successful import', () => {
    const legacyDir = join(testDir, 'pi-agent', 'state', 'trace');
    mkdirSync(legacyDir, { recursive: true });
    const legacyPath = join(legacyDir, 'app-telemetry.db');
    const legacyDb = openSqliteDatabase(legacyPath);
    legacyDb.exec(`
      CREATE TABLE app_telemetry_events (
        id TEXT PRIMARY KEY, ts TEXT NOT NULL, source TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL,
        session_id TEXT, run_id TEXT, route TEXT, status INTEGER, duration_ms REAL, count INTEGER, value REAL, metadata_json TEXT
      )
    `);
    legacyDb
      .prepare(`INSERT INTO app_telemetry_events (id, ts, source, category, name) VALUES (?, ?, ?, ?, ?)`)
      .run('legacy-event', new Date().toISOString(), 'server', 'legacy', 'imported');
    legacyDb.close();

    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'request' });
    closeAppTelemetryDbs();

    const db = openSqliteDatabase(join(testDir, 'observability', 'observability.db'));
    const row = db.prepare(`SELECT COUNT(*) AS count FROM app_telemetry_events WHERE id = 'legacy-event'`).get() as { count: number };
    db.close();

    expect(row.count).toBe(1);
    expect(existsSync(legacyPath)).toBe(false);
  });

  it('drops events without category or name', () => {
    writeAppTelemetryEvent({ source: 'server', category: '', name: 'request' });
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: '' });

    expect(queryAppTelemetryEvents({ since: new Date(Date.now() - 60_000).toISOString() })).toHaveLength(0);
  });

  it('stores app telemetry and traces in the same observability database', () => {
    writeAppTelemetryEvent({ source: 'server', category: 'api', name: 'request', route: '/health' });
    writeTraceStats({ sessionId: 'shared-db-session', modelId: 'shared-model', tokensInput: 1, tokensOutput: 2, cost: 0.01 });
    closeAppTelemetryDbs();
    closeTraceDbs();

    const db = openSqliteDatabase(join(testDir, 'observability', 'observability.db'));
    const telemetry = db.prepare('SELECT COUNT(*) AS count FROM app_telemetry_events').get() as { count: number };
    const traces = db.prepare('SELECT COUNT(*) AS count FROM trace_stats').get() as { count: number };
    const namespaces = db.prepare('SELECT namespace FROM observability_schema_versions ORDER BY namespace').all() as Array<{
      namespace: string;
    }>;
    db.close();

    expect(telemetry.count).toBe(1);
    expect(traces.count).toBe(1);
    expect(namespaces.map((row) => row.namespace)).toEqual(['trace']);
  });

  it('caps stored telemetry events', () => {
    process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS = '1000';

    for (let index = 0; index < 1250; index += 1) {
      writeAppTelemetryEvent({ source: 'server', category: 'test', name: `event-${index}` });
    }
    closeAppTelemetryDbs();

    const db = openSqliteDatabase(join(testDir, 'observability', 'observability.db'));
    const row = db.prepare('SELECT COUNT(*) AS count FROM app_telemetry_events').get() as { count: number };
    db.close();

    expect(row.count).toBe(1000);
  });
});
