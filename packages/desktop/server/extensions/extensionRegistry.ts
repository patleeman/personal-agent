import type { ExtensionManifest, ExtensionSurface } from './extensionManifest.js';
import {
  EXTENSION_ICON_NAMES,
  EXTENSION_PLACEMENTS,
  EXTENSION_RIGHT_SURFACE_SCOPES,
  EXTENSION_SURFACE_KINDS,
} from './extensionManifest.js';
import { SYSTEM_EXTENSIONS } from './systemExtensions.js';

export interface ExtensionRegistrySnapshot {
  extensions: ExtensionManifest[];
  routes: Array<{ route: string; extensionId: string; surfaceId: string; packageType: ExtensionManifest['packageType'] }>;
  surfaces: Array<ExtensionSurface & { extensionId: string; packageType: ExtensionManifest['packageType'] }>;
}

export function listExtensions(): ExtensionManifest[] {
  return SYSTEM_EXTENSIONS;
}

export function readExtensionSchema() {
  return {
    manifestVersion: 1,
    placements: EXTENSION_PLACEMENTS,
    surfaceKinds: EXTENSION_SURFACE_KINDS,
    rightSurfaceScopes: EXTENSION_RIGHT_SURFACE_SCOPES,
    iconNames: EXTENSION_ICON_NAMES,
  };
}

export function readExtensionRegistrySnapshot(): ExtensionRegistrySnapshot {
  const extensions = listExtensions();
  const surfaces = extensions.flatMap((extension) =>
    (extension.surfaces ?? []).map((surface) => ({ ...surface, extensionId: extension.id, packageType: extension.packageType ?? 'user' })),
  );
  const routes = surfaces.flatMap((surface) =>
    surface.kind === 'page' && 'route' in surface
      ? [{ route: surface.route, extensionId: surface.extensionId, surfaceId: surface.id, packageType: surface.packageType }]
      : [],
  );
  return { extensions, routes, surfaces };
}
