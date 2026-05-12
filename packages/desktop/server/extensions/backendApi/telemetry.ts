import type { AppTelemetryEventInput, AppTelemetrySource } from '@personal-agent/core';

import { persistAppTelemetryEvent } from '../../traces/appTelemetry.js';

export interface ExtensionTelemetryEventInput extends Omit<AppTelemetryEventInput, 'source' | 'stateRoot'> {
  source?: AppTelemetrySource;
}

export function recordTelemetryEvent(event: ExtensionTelemetryEventInput): void {
  persistAppTelemetryEvent({ ...event, source: event.source ?? 'server' });
}
