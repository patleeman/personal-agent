export type { ExtensionBackendContext } from './index';

/**
 * Backend imports are resolved by the Personal Agent host when building trusted
 * local extensions. This package subpath exists so tooling has a real public
 * contract; runtime implementations are provided by the desktop host alias.
 */
export function assertHostResolvedBackendImport(): never {
  throw new Error('@personal-agent/extensions/backend must be resolved by the Personal Agent host runtime.');
}
