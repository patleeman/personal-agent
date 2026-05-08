import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

import { loadExtensionAgentFactory } from './extensionBackend.js';
import { listExtensionAgentRegistrations } from './extensionRegistry.js';

export function createManifestAgentExtensions(
  options: { onError?: (message: string, fields?: Record<string, unknown>) => void } = {},
): ExtensionFactory[] {
  return listExtensionAgentRegistrations().map((registration): ExtensionFactory => {
    let loaded: Promise<ExtensionFactory> | null = null;
    return (pi) => {
      loaded ??= loadExtensionAgentFactory(registration.extensionId, registration.exportName);
      loaded
        .then((factory) => factory(pi))
        .catch((error) => {
          options.onError?.('failed to load extension agent factory', {
            extensionId: registration.extensionId,
            exportName: registration.exportName,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    };
  });
}
