import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

export interface ExtensionInstallSummary {
  id: string;
  name: string;
  packageType: ExtensionManifest['packageType'];
  enabled: boolean;
  description?: string;
  version?: string;
  packageRoot?: string;
  manifest: ExtensionManifest;
  permissions: ExtensionManifest['permissions'];
  surfaces: ExtensionSurface[];
  routes: Array<{ route: string; surfaceId: string }>;
}

export interface ExtensionRegistrySnapshot {
  extensions: ExtensionManifest[];
  routes: Array<{ route: string; extensionId: string; surfaceId: string; packageType: ExtensionManifest['packageType'] }>;
  surfaces: Array<ExtensionSurface & { extensionId: string; packageType: ExtensionManifest['packageType'] }>;
}

interface ExtensionRegistryConfig {
  disabledIds?: string[];
}

export function getRuntimeExtensionsRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extensions');
}

function getExtensionRegistryConfigPath(stateRoot: string = getStateRoot()): string {
  return join(getRuntimeExtensionsRoot(stateRoot), 'registry.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readExtensionRegistryConfig(stateRoot: string = getStateRoot()): ExtensionRegistryConfig {
  const configPath = getExtensionRegistryConfigPath(stateRoot);
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const disabledIds = Array.isArray(parsed.disabledIds) ? parsed.disabledIds.filter((id): id is string => typeof id === 'string') : [];
    return { disabledIds };
  } catch {
    return {};
  }
}

function writeExtensionRegistryConfig(config: ExtensionRegistryConfig, stateRoot: string = getStateRoot()): void {
  const extensionsRoot = getRuntimeExtensionsRoot(stateRoot);
  mkdirSync(extensionsRoot, { recursive: true });
  writeFileSync(getExtensionRegistryConfigPath(stateRoot), `${JSON.stringify({ disabledIds: config.disabledIds ?? [] }, null, 2)}\n`);
}

export function isExtensionEnabled(extensionId: string, stateRoot: string = getStateRoot()): boolean {
  return !(readExtensionRegistryConfig(stateRoot).disabledIds ?? []).includes(extensionId);
}

export function setExtensionEnabled(extensionId: string, enabled: boolean, stateRoot: string = getStateRoot()): void {
  const config = readExtensionRegistryConfig(stateRoot);
  const disabledIds = new Set(config.disabledIds ?? []);
  if (enabled) {
    disabledIds.delete(extensionId);
  } else {
    disabledIds.add(extensionId);
  }
  writeExtensionRegistryConfig({ disabledIds: [...disabledIds].sort((left, right) => left.localeCompare(right)) }, stateRoot);
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

export function listExtensionEntries(stateRoot: string = getStateRoot()): ExtensionRegistryEntry[] {
  return [...SYSTEM_EXTENSIONS.map((manifest) => ({ manifest, source: 'system' as const })), ...readRuntimeExtensionEntries(stateRoot)];
}

export function listEnabledExtensionEntries(stateRoot: string = getStateRoot()): ExtensionRegistryEntry[] {
  return listExtensionEntries(stateRoot).filter((entry) => entry.source === 'system' || isExtensionEnabled(entry.manifest.id, stateRoot));
}

export function listExtensions(): ExtensionManifest[] {
  return listEnabledExtensionEntries().map((entry) => entry.manifest);
}

export function listExtensionInstallSummaries(stateRoot: string = getStateRoot()): ExtensionInstallSummary[] {
  return listExtensionEntries(stateRoot).map((entry) => {
    const manifest = entry.manifest;
    const surfaces = manifest.surfaces ?? [];
    return {
      id: manifest.id,
      name: manifest.name,
      packageType: manifest.packageType ?? 'user',
      enabled: entry.source === 'system' || isExtensionEnabled(manifest.id, stateRoot),
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      ...(entry.packageRoot ? { packageRoot: entry.packageRoot } : {}),
      manifest,
      permissions: manifest.permissions ?? [],
      surfaces,
      routes: surfaces.flatMap((surface) =>
        surface.kind === 'page' && 'route' in surface ? [{ route: surface.route, surfaceId: surface.id }] : [],
      ),
    };
  });
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
