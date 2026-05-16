import { logError, logInfo } from '../shared/logging.js';
import type { ExtensionBackendServerContext } from './extensionBackend.js';
import { createBackendContext, loadExtensionBackend } from './extensionBackend.js';
import { type ExtensionEvent, publishExtensionEvent, subscribeExtensionEvents } from './extensionEventBus.js';
import { findExtensionEntry, listExtensionInstallSummaries } from './extensionRegistry.js';

const installedSubscriptionKeys = new Set<string>();
const sourceEventName = (source: string) => (source.includes(':') ? source : `host:${source}`);

export async function publishExtensionHostEvent(source: string, payload: unknown): Promise<void> {
  await publishExtensionEvent('host', sourceEventName(source), payload);
  if (!source.includes(':') && payload && typeof payload === 'object') {
    const type = (payload as { type?: unknown }).type;
    if (typeof type === 'string' && type.trim()) {
      await publishExtensionEvent('host', `${sourceEventName(source)}:${type.trim()}`, payload);
    }
  }
}

export async function installExtensionSubscriptions(serverContext?: ExtensionBackendServerContext): Promise<void> {
  for (const summary of listExtensionInstallSummaries()) {
    if (summary.status !== 'enabled') continue;
    const entry = findExtensionEntry(summary.id);
    for (const subscription of entry?.manifest.contributes?.subscriptions ?? []) {
      const key = `${summary.id}:${subscription.id}`;
      if (installedSubscriptionKeys.has(key)) continue;
      installedSubscriptionKeys.add(key);
      const pattern = subscription.pattern
        ? `${sourceEventName(subscription.source)}:${subscription.pattern}`
        : sourceEventName(subscription.source);
      subscribeExtensionEvents(summary.id, pattern, async (event: ExtensionEvent) => {
        try {
          const backend = await loadExtensionBackend(summary.id);
          const handler = backend[subscription.handler];
          if (typeof handler !== 'function') throw new Error(`Missing subscription handler export "${subscription.handler}".`);
          await (handler as (input: unknown, ctx: unknown) => unknown | Promise<unknown>)(
            { subscriptionId: subscription.id, event: event.event, payload: event.payload, sourceExtensionId: event.sourceExtensionId },
            createBackendContext(summary.id, serverContext),
          );
        } catch (error) {
          logError('extension subscription handler failed', {
            extensionId: summary.id,
            subscriptionId: subscription.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      });
      logInfo('extension subscription installed', {
        extensionId: summary.id,
        subscriptionId: subscription.id,
        source: subscription.source,
      });
    }
  }
}
