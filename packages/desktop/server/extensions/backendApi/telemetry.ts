import type { AppTelemetryEventInput, AppTelemetrySource } from '@personal-agent/core';

export interface ExtensionTelemetryEventInput extends Omit<AppTelemetryEventInput, 'source' | 'stateRoot'> {
  source?: AppTelemetrySource;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

export function recordTelemetryEvent(event: ExtensionTelemetryEventInput): void {
  void (async () => {
    try {
      const appTelemetry = await dynamicImport('../../traces/appTelemetry.js');
      const persist = appTelemetry.persistAppTelemetryEvent;
      if (typeof persist === 'function') {
        persist({ ...event, source: event.source ?? 'server' });
      }
    } catch {
      // Telemetry must never affect app behavior.
    }
  })();
}
