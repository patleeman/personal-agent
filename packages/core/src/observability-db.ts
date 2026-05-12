import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

import { getStateRoot } from './runtime/paths.js';

export function resolveObservabilityDbPath(stateRoot?: string): string {
  return join(stateRoot ?? getStateRoot(), 'observability', 'observability.db');
}

export function ensureObservabilityDbDir(stateRoot?: string): string {
  const dbPath = resolveObservabilityDbPath(stateRoot);
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function resolveLegacyTraceDbPath(stateRoot?: string): string {
  return join(stateRoot ?? getStateRoot(), 'pi-agent', 'state', 'trace', 'trace.db');
}

export function resolveLegacyAppTelemetryDbPath(stateRoot?: string): string {
  return join(stateRoot ?? getStateRoot(), 'pi-agent', 'state', 'trace', 'app-telemetry.db');
}
