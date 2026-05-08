import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

import type {
  ExtensionManifest,
  ExtensionMentionContribution,
  ExtensionSkillContribution,
  ExtensionSurface,
  ExtensionToolContribution,
  ExtensionViewContribution,
} from './extensionManifest.js';
import {
  EXTENSION_ICON_NAMES,
  EXTENSION_PLACEMENTS,
  EXTENSION_RIGHT_SURFACE_SCOPES,
  EXTENSION_ROUTE_CAPABILITIES,
  EXTENSION_SURFACE_KINDS,
} from './extensionManifest.js';
import { listExtensionPackagePaths } from './extensionPackagePaths.js';
import { SYSTEM_EXTENSION_ENTRIES } from './systemExtensions.js';

export interface ExtensionRegistryEntry {
  manifest: ExtensionManifest;
  packageRoot?: string;
  source: 'system' | 'runtime';
}

export interface ExtensionSkillRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  id: string;
  name: string;
  title?: string;
  description?: string;
  path: string;
  packageRoot: string;
}

export interface ExtensionMentionRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  id: string;
  title: string;
  description?: string;
  kinds: string[];
  provider: string;
}

export interface ExtensionToolRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  id: string;
  name: string;
  action: string;
  title?: string;
  label?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  promptSnippet?: string;
  promptGuidelines?: string[];
  systemFactory?: string;
}

export interface ExtensionAgentRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  exportName: string;
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
  backendActions: NonNullable<ExtensionManifest['backend']>['actions'];
  skills: ExtensionSkillRegistration[];
  mentions: ExtensionMentionRegistration[];
  tools: ExtensionToolRegistration[];
  routes: Array<{ route: string; surfaceId: string }>;
}

export interface ExtensionRegistrySnapshot {
  extensions: ExtensionManifest[];
  routes: Array<{ route: string; extensionId: string; surfaceId: string; packageType: ExtensionManifest['packageType'] }>;
  surfaces: Array<ExtensionSurface & { extensionId: string; packageType: ExtensionManifest['packageType'] }>;
  views: Array<
    ExtensionViewContribution & {
      extensionId: string;
      packageType: ExtensionManifest['packageType'];
      frontend?: ExtensionManifest['frontend'];
    }
  >;
}

export interface ExtensionCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionManifest['packageType'];
  title: string;
  action: string;
  icon?: string;
}

export interface ExtensionKeybindingRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionManifest['packageType'];
  title: string;
  keys: string[];
  command: string;
  when?: string;
  scope: 'global' | 'surface';
}

export interface ExtensionSlashCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionManifest['packageType'];
  name: string;
  description: string;
  action: string;
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

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes extension root.');
  }
}

function normalizeToolNamePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeExtensionSkillContribution(skill: string | ExtensionSkillContribution): ExtensionSkillContribution {
  if (typeof skill === 'string') {
    const segments = skill.split(/[\\/]/).filter(Boolean);
    const parent = segments.length > 1 ? segments[segments.length - 2] : undefined;
    const basename = segments.at(-1)?.replace(/\.md$/i, '') ?? 'skill';
    return { id: parent && basename.toUpperCase() === 'SKILL' ? parent : basename, path: skill };
  }
  return skill;
}

function buildExtensionSkillRegistrations(entry: ExtensionRegistryEntry): ExtensionSkillRegistration[] {
  if (!entry.packageRoot) {
    return [];
  }
  return (entry.manifest.contributes?.skills ?? []).flatMap((skill): ExtensionSkillRegistration[] => {
    const normalized = normalizeExtensionSkillContribution(skill);
    if (!normalized.id || !normalized.path) {
      return [];
    }
    const skillPath = resolve(entry.packageRoot!, normalized.path);
    try {
      assertInside(entry.packageRoot!, skillPath);
    } catch {
      return [];
    }
    if (!existsSync(skillPath)) {
      return [];
    }
    const id = normalized.id.trim();
    const name = `${entry.manifest.id}/${id}`;
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        id,
        name,
        ...(normalized.title ? { title: normalized.title } : {}),
        ...(normalized.description ? { description: normalized.description } : {}),
        path: skillPath,
        packageRoot: entry.packageRoot!,
      },
    ];
  });
}

function buildExtensionMentionRegistrations(entry: ExtensionRegistryEntry): ExtensionMentionRegistration[] {
  return (entry.manifest.contributes?.mentions ?? []).flatMap((mention: ExtensionMentionContribution): ExtensionMentionRegistration[] => {
    const id = mention.id.trim();
    const provider = mention.provider.trim();
    if (!id || !mention.title.trim() || !provider) {
      return [];
    }
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        id,
        title: mention.title,
        ...(mention.description ? { description: mention.description } : {}),
        kinds: mention.kinds,
        provider,
      },
    ];
  });
}

function buildExtensionToolRegistrations(entry: ExtensionRegistryEntry): ExtensionToolRegistration[] {
  return (entry.manifest.contributes?.tools ?? []).flatMap((tool: ExtensionToolContribution): ExtensionToolRegistration[] => {
    const id = tool.id.trim();
    if (!id || !tool.description?.trim()) {
      return [];
    }
    const extensionPart = normalizeToolNamePart(entry.manifest.id);
    const toolPart = normalizeToolNamePart(id);
    const explicitName = typeof tool.name === 'string' ? tool.name.trim() : '';
    if ((!extensionPart || !toolPart) && !explicitName) {
      return [];
    }
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        id,
        name: explicitName || `extension_${extensionPart}_${toolPart}`,
        action: tool.action ?? tool.handler ?? id,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.label ? { label: tool.label } : {}),
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
        ...(tool.promptSnippet ? { promptSnippet: tool.promptSnippet } : {}),
        ...(tool.promptGuidelines ? { promptGuidelines: tool.promptGuidelines } : {}),
        ...(tool.systemFactory ? { systemFactory: tool.systemFactory } : {}),
      },
    ];
  });
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
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new Error('Extension manifest schemaVersion must be 1 or 2.');
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
  return listExtensionPackagePaths({ runtimeRoot: getRuntimeExtensionsRoot(stateRoot) })
    .filter((entry) => entry.source === 'external')
    .flatMap((entry): ExtensionRegistryEntry[] => {
      const manifestPath = join(entry.packageRoot, 'extension.json');
      try {
        const manifest = parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')));
        return [
          { manifest: { ...manifest, packageType: manifest.packageType ?? 'user' }, packageRoot: entry.packageRoot, source: 'runtime' },
        ];
      } catch {
        return [];
      }
    });
}

export function listExtensionEntries(stateRoot: string = getStateRoot()): ExtensionRegistryEntry[] {
  const entries = [
    ...SYSTEM_EXTENSION_ENTRIES.map((entry) => ({ manifest: entry.manifest, packageRoot: entry.packageRoot, source: 'system' as const })),
    ...readRuntimeExtensionEntries(stateRoot),
  ];
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.manifest.id)) return false;
    seen.add(entry.manifest.id);
    return true;
  });
}

export function listEnabledExtensionEntries(stateRoot: string = getStateRoot()): ExtensionRegistryEntry[] {
  return listExtensionEntries(stateRoot).filter((entry) => isExtensionEnabled(entry.manifest.id, stateRoot));
}

export function listExtensions(): ExtensionManifest[] {
  return listEnabledExtensionEntries().map((entry) => entry.manifest);
}

export function listExtensionInstallSummaries(stateRoot: string = getStateRoot()): ExtensionInstallSummary[] {
  return listExtensionEntries(stateRoot).map((entry) => {
    const manifest = entry.manifest;
    const surfaces = manifest.surfaces ?? [];
    const views = manifest.contributes?.views ?? [];
    return {
      id: manifest.id,
      name: manifest.name,
      packageType: manifest.packageType ?? 'user',
      enabled: isExtensionEnabled(manifest.id, stateRoot),
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      ...(entry.packageRoot ? { packageRoot: entry.packageRoot } : {}),
      manifest,
      permissions: manifest.permissions ?? [],
      surfaces,
      backendActions: manifest.backend?.actions ?? [],
      skills: isExtensionEnabled(manifest.id, stateRoot) ? buildExtensionSkillRegistrations(entry) : [],
      mentions: isExtensionEnabled(manifest.id, stateRoot) ? buildExtensionMentionRegistrations(entry) : [],
      tools: isExtensionEnabled(manifest.id, stateRoot) ? buildExtensionToolRegistrations(entry) : [],
      routes: [
        ...surfaces.flatMap((surface) =>
          surface.kind === 'page' && 'route' in surface ? [{ route: surface.route, surfaceId: surface.id }] : [],
        ),
        ...views.flatMap((view) => (view.location === 'main' && view.route ? [{ route: view.route, surfaceId: view.id }] : [])),
      ],
    };
  });
}

export function readExtensionSchema() {
  return {
    manifestVersion: 2,
    placements: EXTENSION_PLACEMENTS,
    surfaceKinds: EXTENSION_SURFACE_KINDS,
    rightSurfaceScopes: EXTENSION_RIGHT_SURFACE_SCOPES,
    routeCapabilities: EXTENSION_ROUTE_CAPABILITIES,
    iconNames: EXTENSION_ICON_NAMES,
    contributions: ['views', 'nav', 'commands', 'keybindings', 'slashCommands', 'mentions', 'settings', 'skills', 'tools'],
  };
}

export function readExtensionRegistrySnapshot(): ExtensionRegistrySnapshot {
  const extensions = listExtensions();
  const surfaces = extensions.flatMap((extension) =>
    (extension.surfaces ?? []).map((surface) => ({ ...surface, extensionId: extension.id, packageType: extension.packageType ?? 'user' })),
  );
  const views = extensions.flatMap((extension) =>
    (extension.contributes?.views ?? []).map((view) => ({
      ...view,
      extensionId: extension.id,
      packageType: extension.packageType ?? 'user',
      ...(extension.frontend ? { frontend: extension.frontend } : {}),
    })),
  );
  const routes = [
    ...surfaces.flatMap((surface) =>
      surface.kind === 'page' && 'route' in surface
        ? [{ route: surface.route, extensionId: surface.extensionId, surfaceId: surface.id, packageType: surface.packageType }]
        : [],
    ),
    ...views.flatMap((view) =>
      view.location === 'main' && view.route
        ? [{ route: view.route, extensionId: view.extensionId, surfaceId: view.id, packageType: view.packageType }]
        : [],
    ),
  ];
  return { extensions, routes, surfaces, views };
}

export function listExtensionMentionRegistrations(): ExtensionMentionRegistration[] {
  return listEnabledExtensionEntries().flatMap(buildExtensionMentionRegistrations);
}

export function listExtensionCommandRegistrations(): ExtensionCommandRegistration[] {
  const snapshot = readExtensionRegistrySnapshot();
  const legacy = snapshot.surfaces.flatMap((surface) =>
    surface.kind === 'command'
      ? [
          {
            extensionId: surface.extensionId,
            surfaceId: surface.id,
            packageType: surface.packageType,
            title: surface.title,
            action: surface.action,
            ...(surface.icon ? { icon: surface.icon } : {}),
          },
        ]
      : [],
  );
  const native = snapshot.extensions.flatMap((extension) =>
    (extension.contributes?.commands ?? []).map((command) => ({
      extensionId: extension.id,
      surfaceId: command.id,
      packageType: extension.packageType ?? 'user',
      title: command.title,
      action: command.action,
      ...(command.icon ? { icon: command.icon } : {}),
    })),
  );
  return [...legacy, ...native];
}

export function listExtensionKeybindingRegistrations(): ExtensionKeybindingRegistration[] {
  const snapshot = readExtensionRegistrySnapshot();
  return snapshot.extensions.flatMap((extension) =>
    (extension.contributes?.keybindings ?? []).flatMap((keybinding) => {
      const id = keybinding.id.trim();
      const title = keybinding.title.trim();
      const command = keybinding.command.trim();
      const keys = keybinding.keys.map((key) => key.trim()).filter(Boolean);
      if (!id || !title || !command || keys.length === 0) {
        return [];
      }
      return [
        {
          extensionId: extension.id,
          surfaceId: id,
          packageType: extension.packageType ?? 'user',
          title,
          keys,
          command,
          ...(keybinding.when ? { when: keybinding.when } : {}),
          scope: keybinding.scope ?? 'global',
        },
      ];
    }),
  );
}

export function listExtensionSlashCommandRegistrations(): ExtensionSlashCommandRegistration[] {
  const snapshot = readExtensionRegistrySnapshot();
  const legacy = snapshot.surfaces.flatMap((surface) =>
    surface.kind === 'slashCommand'
      ? [
          {
            extensionId: surface.extensionId,
            surfaceId: surface.id,
            packageType: surface.packageType,
            name: surface.name,
            description: surface.description,
            action: surface.action,
          },
        ]
      : [],
  );
  const native = snapshot.extensions.flatMap((extension) =>
    (extension.contributes?.slashCommands ?? []).map((command) => ({
      extensionId: extension.id,
      surfaceId: command.name,
      packageType: extension.packageType ?? 'user',
      name: command.name,
      description: command.description,
      action: command.action,
    })),
  );
  return [...legacy, ...native];
}

export function listExtensionSkillRegistrations(stateRoot: string = getStateRoot()): ExtensionSkillRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap(buildExtensionSkillRegistrations);
}

export function listExtensionToolRegistrations(stateRoot: string = getStateRoot()): ExtensionToolRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap(buildExtensionToolRegistrations);
}

export function listExtensionAgentRegistrations(stateRoot: string = getStateRoot()): ExtensionAgentRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry): ExtensionAgentRegistration[] => {
    const exportName = entry.manifest.backend?.agentExtension;
    if (!exportName) return [];
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        exportName,
      },
    ];
  });
}

export function findExtensionEntry(extensionId: string): ExtensionRegistryEntry | null {
  return listExtensionEntries().find((entry) => entry.manifest.id === extensionId) ?? null;
}
