function hostResolved(): never {
  throw new Error('@personal-agent/extensions/backend/telemetry must be resolved by the Personal Agent host runtime.');
}

export type ExtensionTelemetrySource = 'server' | 'renderer' | 'agent' | 'system';

export interface ExtensionTelemetryEventInput {
  source?: ExtensionTelemetrySource;
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
}

export const recordTelemetryEvent = (..._args: unknown[]): unknown => hostResolved();
