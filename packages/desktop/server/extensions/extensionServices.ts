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
  lastError?: string;
}

const runningServices = new Map<string, RunningExtensionService>();
const serviceKey = (extensionId: string, serviceId: string) => `${extensionId}:${serviceId}`;

export function listRunningExtensionServices(): RunningExtensionService[] {
  return [...runningServices.values()];
}

export function isExtensionServiceRunning(extensionId: string, serviceId: string): boolean {
  return runningServices.has(serviceKey(extensionId, serviceId));
}

export async function stopExtensionServices(extensionId: string): Promise<void> {
  for (const service of [...runningServices.values()].filter((candidate) => candidate.extensionId === extensionId)) {
    runningServices.delete(serviceKey(service.extensionId, service.serviceId));
    if (service.stop) await service.stop();
    logInfo('extension service stopped', { extensionId: service.extensionId, serviceId: service.serviceId });
  }
}

export async function stopAllExtensionServices(): Promise<void> {
  for (const extensionId of new Set([...runningServices.values()].map((service) => service.extensionId))) {
    await stopExtensionServices(extensionId);
  }
}

async function startOneExtensionService(
  extensionId: string,
  service: { id: string; handler: string },
  serverContext?: ExtensionBackendServerContext,
): Promise<{ extensionId: string; serviceId: string; ok: boolean; error?: string }> {
  const key = serviceKey(extensionId, service.id);
  if (runningServices.has(key)) return { extensionId, serviceId: service.id, ok: true };
  try {
    const backend = await loadExtensionBackend(extensionId);
    const handler = backend[service.handler];
    if (typeof handler !== 'function') throw new Error(`Missing service handler export "${service.handler}".`);
    const result = await (handler as (input: unknown, ctx: unknown) => unknown | Promise<unknown>)(
      { serviceId: service.id },
      createBackendContext(extensionId, serverContext),
    );
    const stop = typeof result === 'function' ? (result as () => unknown | Promise<unknown>) : undefined;
    runningServices.set(key, { extensionId, serviceId: service.id, stop, startedAt: new Date().toISOString() });
    logInfo('extension service started', { extensionId, serviceId: service.id });
    return { extensionId, serviceId: service.id, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setExtensionHealthError(extensionId, message);
    logError('extension service failed', { extensionId, serviceId: service.id, message });
    publishAppEvent({ type: 'notification', extensionId, message: `Extension service failed: ${message}`, severity: 'error' });
    return { extensionId, serviceId: service.id, ok: false, error: message };
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
      results.push(await startOneExtensionService(summary.id, service, serverContext));
    }
  }
  return results;
}

export async function runExtensionServiceHealthChecks(serverContext?: ExtensionBackendServerContext): Promise<void> {
  for (const summary of listExtensionInstallSummaries()) {
    if (summary.status !== 'enabled') continue;
    const entry = findExtensionEntry(summary.id);
    for (const service of entry?.manifest.backend?.services ?? []) {
      if (!service.healthCheck) continue;
      const key = serviceKey(summary.id, service.id);
      try {
        const backend = await loadExtensionBackend(summary.id);
        const healthCheck = backend[service.healthCheck];
        if (typeof healthCheck !== 'function') throw new Error(`Missing service healthCheck export "${service.healthCheck}".`);
        const result = await (healthCheck as (input: unknown, ctx: unknown) => unknown | Promise<unknown>)(
          { serviceId: service.id },
          createBackendContext(summary.id, serverContext),
        );
        if (result && typeof result === 'object' && 'running' in result && (result as { running?: unknown }).running === false) {
          throw new Error('Service health check reported stopped.');
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const running = runningServices.get(key);
        if (running) running.lastError = message;
        setExtensionHealthError(summary.id, message);
        if (service.restart === 'always' || service.restart === 'on-failure') {
          await stopExtensionServices(summary.id);
          await startOneExtensionService(summary.id, service, serverContext);
        }
      }
    }
  }
}
