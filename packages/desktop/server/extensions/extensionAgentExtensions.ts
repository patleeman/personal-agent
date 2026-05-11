import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { loadExtensionAgentFactory } from './extensionBackend.js';
import { listExtensionAgentRegistrations } from './extensionRegistry.js';

export function createManifestAgentExtensions(options: { onError?: (message: string, fields?: Record<string, unknown>) => void } = {}): {
  factories: ExtensionFactory[];
  errors: Array<{ extensionId: string; message: string }>;
} {
  const registrations = listExtensionAgentRegistrations();
  const errors: Array<{ extensionId: string; message: string }> = [];

  // Eagerly preload all agent extension backends so tool registration is
  // synchronous when the factory is invoked. Without preloading the factory
  // must await import() via .then(), which registers tools on a later
  // microtask — after the model has already queried the tool registry.
  const preloaded = new Array<ExtensionFactory | null>(registrations.length);
  for (const [index, reg] of registrations.entries()) {
    loadExtensionAgentFactory(reg.extensionId, reg.exportName)
      .then((factory) => {
        preloaded[index] = factory;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ extensionId: reg.extensionId, message });
        options.onError?.('failed to load extension agent factory', {
          extensionId: reg.extensionId,
          exportName: reg.exportName,
          message,
        });
      });
  }

  return {
    factories: registrations.map((reg, index): ExtensionFactory => {
      return async (pi) => {
        const factory = preloaded[index];
        if (factory) {
          // Preloaded — call synchronously. Since this function is async,
          // await factory(api) in the SDK will still await the returned
          // promise, which resolves on the next microtask.
          factory(pi);
        } else {
          // Edge case: session starts before preload finishes.
          try {
            const f = await loadExtensionAgentFactory(reg.extensionId, reg.exportName);
            f(pi);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push({ extensionId: reg.extensionId, message });
            options.onError?.('failed to load extension agent factory', {
              extensionId: reg.extensionId,
              exportName: reg.exportName,
              message,
            });
          }
        }
      };
    }),
    errors,
  };
}
