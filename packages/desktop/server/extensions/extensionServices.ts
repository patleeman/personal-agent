import { publishAppEvent } from '../shared/appEvents.js';
import { logError, logInfo } from '../shared/logging.js';
import type { ExtensionBackendServerContext } from './extensionBackend.js';
import { createBackendContext, loadExtensionBackend } from './extensionBackend.js';
import { findExtensionEntry, listExtensionInstallSummaries, setExtensionHealthError } from './extensionRegistry.js';

interface RunningExtensionService {
  extensionId: string;
  serviceId: string;
  stop?: () => unknown | Promise<unknown>;
  startedAt: string;
}

const runningServices = new Map<string, RunningExtensionService>();
const serviceKey = (extensionId: string, serviceId: string) => `${extensionId}:${serviceId}`;

export function listRunningExtensionServices(): RunningExtensionService[] {
  return [...runningServices.values()];
}

export async function stopExtensionServices(extensionId: string): Promise<void> {
  for (const service of [...runningServices.values()].filter((candidate) => candidate.extensionId === extensionId)) {
    runningServices.delete(serviceKey(service.extensionId, service.serviceId));
    if (service.stop) await service.stop();
    logInfo('extension service stopped', { extensionId: service.extensionId, serviceId: service.serviceId });
  }
}

export async function startExtensionServices(
  serverContext?: ExtensionBackendServerContext,
): Promise<Array<{ extensionId: string; serviceId: string; ok: boolean; error?: string }>> {
  const results: Array<{ extensionId: string; serviceId: string; ok: boolean; error?: string }> = [];
  for (const summary of listExtensionInstallSummaries()) {
    if (summary.status !== 'enabled') continue;
    const entry = findExtensionEntry(summary.id);
    for (const service of entry?.manifest.backend?.services ?? []) {
      const key = serviceKey(summary.id, service.id);
      if (runningServices.has(key)) {
        results.push({ extensionId: summary.id, serviceId: service.id, ok: true });
        continue;
      }
      try {
        const backend = await loadExtensionBackend(summary.id);
        const handler = backend[service.handler];
        if (typeof handler !== 'function') throw new Error(`Missing service handler export "${service.handler}".`);
        const result = await (handler as (input: unknown, ctx: unknown) => unknown | Promise<unknown>)(
          { serviceId: service.id },
          createBackendContext(summary.id, serverContext),
        );
        const stop = typeof result === 'function' ? (result as () => unknown | Promise<unknown>) : undefined;
        runningServices.set(key, { extensionId: summary.id, serviceId: service.id, stop, startedAt: new Date().toISOString() });
        logInfo('extension service started', { extensionId: summary.id, serviceId: service.id });
        results.push({ extensionId: summary.id, serviceId: service.id, ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setExtensionHealthError(summary.id, message);
        logError('extension service failed', { extensionId: summary.id, serviceId: service.id, message });
        publishAppEvent({
          type: 'notification',
          extensionId: summary.id,
          message: `Extension service failed: ${message}`,
          severity: 'error',
        });
        results.push({ extensionId: summary.id, serviceId: service.id, ok: false, error: message });
      }
    }
  }
  return results;
}
