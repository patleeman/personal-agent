export const EXTENSION_REGISTRY_CHANGED_EVENT = 'pa-extension-registry-changed';

let extensionRegistryRevision = 0;

export function getExtensionRegistryRevision(): number {
  return extensionRegistryRevision;
}

export function notifyExtensionRegistryChanged(): void {
  extensionRegistryRevision += 1;
  window.dispatchEvent(new CustomEvent(EXTENSION_REGISTRY_CHANGED_EVENT, { detail: { revision: extensionRegistryRevision } }));
}
