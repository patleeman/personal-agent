import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

import type { ExtensionManifest, ExtensionSurface } from './extensionManifest.js';
import {
  EXTENSION_ICON_NAMES,
  EXTENSION_PLACEMENTS,
  EXTENSION_RIGHT_SURFACE_SCOPES,
  EXTENSION_SURFACE_KINDS,
} from './extensionManifest.js';
import { SYSTEM_EXTENSIONS } from './systemExtensions.js';

export interface ExtensionRegistryEntry {
  manifest: ExtensionManifest;
  packageRoot?: string;
  source: 'system' | 'runtime';
}

export interface ExtensionRegistrySnapshot {
  extensions: ExtensionManifest[];
  routes: Array<{ route: string; extensionId: string; surfaceId: string; packageType: ExtensionManifest['packageType'] }>;
  surfaces: Array<ExtensionSurface & { extensionId: string; packageType: ExtensionManifest['packageType'] }>;
}

export function getRuntimeExtensionsRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extensions');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  if (!isRecord(value)) {
    throw new Error('Extension manifest must be an object.');
  }
  if (value.schemaVersion !== 1) {
    throw new Error('Extension manifest schemaVersion must be 1.');
  }
  if (typeof value.id !== 'string' || value.id.trim().length === 0) {
    throw new Error('Extension manifest id is required.');
  }
  if (typeof value.name !== 'string' || value.name.trim().length === 0) {
    throw new Error('Extension manifest name is required.');
  }

  return value as unknown as ExtensionManifest;
}

export function readRuntimeExtensionEntries(stateRoot: string = getStateRoot()): ExtensionRegistryEntry[] {
  const extensionsRoot = getRuntimeExtensionsRoot(stateRoot);
  if (!existsSync(extensionsRoot)) {
    return [];
  }

  return readdirSync(extensionsRoot)
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entryName): ExtensionRegistryEntry[] => {
      const packageRoot = join(extensionsRoot, entryName);
      if (!statSync(packageRoot).isDirectory()) {
        return [];
      }

      const manifestPath = join(packageRoot, 'extension.json');
      if (!existsSync(manifestPath)) {
        return [];
      }

      const manifest = parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')));
      return [{ manifest: { ...manifest, packageType: manifest.packageType ?? 'user' }, packageRoot, source: 'runtime' }];
    });
}

export function listExtensionEntries(): ExtensionRegistryEntry[] {
  return [...SYSTEM_EXTENSIONS.map((manifest) => ({ manifest, source: 'system' as const })), ...readRuntimeExtensionEntries()];
}

export function listExtensions(): ExtensionManifest[] {
  return listExtensionEntries().map((entry) => entry.manifest);
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

export function findExtensionEntry(extensionId: string): ExtensionRegistryEntry | null {
  return listExtensionEntries().find((entry) => entry.manifest.id === extensionId) ?? null;
}
