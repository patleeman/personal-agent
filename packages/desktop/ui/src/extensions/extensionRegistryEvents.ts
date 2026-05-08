export const EXTENSION_REGISTRY_CHANGED_EVENT = 'pa-extension-registry-changed';

export function notifyExtensionRegistryChanged(): void {
  window.dispatchEvent(new CustomEvent(EXTENSION_REGISTRY_CHANGED_EVENT));
}
