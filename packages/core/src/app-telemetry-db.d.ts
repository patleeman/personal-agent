/**
 * Application telemetry database.
 *
 * Generic event sink for low-cardinality runtime signals that are useful later
 * but not yet first-class trace metrics.
 */
export declare function closeAppTelemetryDbs(): void;
export type AppTelemetrySource = 'server' | 'renderer' | 'agent' | 'system';
export interface AppTelemetryEventInput {
  source: AppTelemetrySource;
  category: string;
  name: string;
  sessionId?: string;
  runId?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  count?: number;
  value?: number;
  metadata?: Record<string, unknown>;
  stateRoot?: string;
}
export interface AppTelemetryEventRow {
  id: string;
  ts: string;
  source: AppTelemetrySource;
  category: string;
  name: string;
  sessionId: string | null;
  runId: string | null;
  route: string | null;
  status: number | null;
  durationMs: number | null;
  count: number | null;
  value: number | null;
  metadataJson: string | null;
}
export declare function writeAppTelemetryEvent(input: AppTelemetryEventInput): void;
export declare function queryAppTelemetryEvents(input: { since: string; limit?: number; stateRoot?: string }): AppTelemetryEventRow[];
