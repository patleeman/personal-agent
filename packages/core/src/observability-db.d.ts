import type { SqliteDatabase } from './sqlite.js';
import type { Migration } from './sqlite-migrations.js';
export declare function resolveObservabilityDbPath(stateRoot?: string): string;
export declare function ensureObservabilityDbDir(stateRoot?: string): string;
export declare function resolveLegacyTraceDbPath(stateRoot?: string): string;
export declare function resolveLegacyAppTelemetryDbPath(stateRoot?: string): string;
export declare function applyObservabilityMigrations(db: SqliteDatabase, namespace: string, migrations: Migration[]): number;
