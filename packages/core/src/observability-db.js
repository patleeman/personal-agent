import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getStateRoot } from './runtime/paths.js';
export function resolveObservabilityDbPath(stateRoot) {
  return join(stateRoot ?? getStateRoot(), 'observability', 'observability.db');
}
export function ensureObservabilityDbDir(stateRoot) {
  const dbPath = resolveObservabilityDbPath(stateRoot);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function resolveExistingLegacyDbPath(stateRoot, filename) {
  const root = stateRoot ?? getStateRoot();
  const direct = join(root, 'pi-agent', 'state', 'trace', filename);
  if (existsSync(direct)) return direct;
  const sync = join(root, 'sync', 'pi-agent', 'state', 'trace', filename);
  return existsSync(sync) ? sync : direct;
}
export function resolveLegacyTraceDbPath(stateRoot) {
  return resolveExistingLegacyDbPath(stateRoot, 'trace.db');
}
export function resolveLegacyAppTelemetryDbPath(stateRoot) {
  return resolveExistingLegacyDbPath(stateRoot, 'app-telemetry.db');
}
export function applyObservabilityMigrations(db, namespace, migrations) {
  if (migrations.length === 0) return 0;
  db.exec(`CREATE TABLE IF NOT EXISTS observability_schema_versions (namespace TEXT PRIMARY KEY, version INTEGER NOT NULL)`);
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const latest = sorted[sorted.length - 1].version;
  const row = db.prepare(`SELECT version FROM observability_schema_versions WHERE namespace = ?`).get(namespace);
  const current = typeof row?.version === 'number' ? row.version : 0;
  if (current > latest) {
    throw new Error(`${namespace}: observability schema version ${current} is newer than the latest migration version ${latest}.`);
  }
  let applied = 0;
  for (const migration of sorted) {
    if (migration.version <= current) continue;
    migration.up(db);
    db.prepare(`INSERT OR REPLACE INTO observability_schema_versions (namespace, version) VALUES (?, ?)`).run(namespace, migration.version);
    applied++;
  }
  return applied;
}
