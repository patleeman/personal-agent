import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { getStateRoot } from '@personal-agent/core';

import type {
  ExtensionManifest,
  ExtensionMentionContribution,
  ExtensionSecretBackendContribution,
  ExtensionSecretContribution,
  ExtensionSkillContribution,
  ExtensionSurface,
  ExtensionToolContribution,
  ExtensionViewContribution,
} from './extensionManifest.js';
import {
  EXTENSION_HOST_VIEW_COMPONENTS,
  EXTENSION_ICON_NAMES,
  EXTENSION_PACKAGE_TYPES,
  EXTENSION_PLACEMENTS,
  EXTENSION_RIGHT_SURFACE_SCOPES,
  EXTENSION_ROUTE_CAPABILITIES,
  EXTENSION_SURFACE_KINDS,
  EXTENSION_VIEW_ACTIVATIONS,
  EXTENSION_VIEW_PLACEMENTS,
  EXTENSION_VIEW_SCOPES,
  getHostViewComponentDefinition,
} from './extensionManifest.js';
import { listExtensionPackagePaths } from './extensionPackagePaths.js';
import { EXPERIMENTAL_EXTENSION_ENTRIES, SYSTEM_EXTENSION_ENTRIES } from './systemExtensions.js';

// Per-extension health errors stored in memory. Cleared on successful load/reload.
const buildErrors = new Map<string, string>();
const healthErrors = new Map<string, string>();

export function setBuildError(extensionId: string, error: string): void {
  buildErrors.set(extensionId, error);
}

export function clearBuildError(extensionId: string): void {
  buildErrors.delete(extensionId);
}

export function setExtensionHealthError(extensionId: string, error: string): void {
  healthErrors.set(extensionId, error);
}

export function clearExtensionHealthError(extensionId: string): void {
  healthErrors.delete(extensionId);
}

export interface InvalidExtensionEntry {
  id: string;
  name: string;
  packageType: ExtensionManifest['packageType'];
  packageRoot: string;
  source: 'runtime';
  errors: string[];
}

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
  /** Built-in tool name this tool overrides. */
  replaces?: string;
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
  status: 'enabled' | 'disabled' | 'invalid';
  errors?: string[];
  diagnostics?: string[];
  buildError?: string;
  healthError?: string;
  description?: string;
  version?: string;
  packageRoot?: string;
  manifest: ExtensionManifest;
  permissions: ExtensionManifest['permissions'];
  surfaces: ExtensionSurface[];
  backendActions: NonNullable<ExtensionManifest['backend']>['actions'];
  services: NonNullable<ExtensionManifest['backend']>['services'];
  subscriptions: NonNullable<NonNullable<ExtensionManifest['contributes']>['subscriptions']>;
  dependsOn: NonNullable<ExtensionManifest['dependsOn']>;
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
  args?: unknown;
  icon?: string;
  category?: string;
  description?: string;
  enablement?: string;
}

export interface ExtensionKeybindingRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionManifest['packageType'];
  title: string;
  keys: string[];
  command: string;
  args?: unknown;
  when?: string;
  scope: 'global' | 'surface';
  defaultKeys: string[];
  enabled: boolean;
}

export interface ExtensionSlashCommandRegistration {
  extensionId: string;
  surfaceId: string;
  packageType: ExtensionManifest['packageType'];
  name: string;
  description: string;
  action: string;
}

export interface ExtensionPromptContextProviderRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  handler: string;
  title?: string;
}

export interface ExtensionPromptReferenceRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  handler: string;
  title?: string;
}

export interface ExtensionQuickOpenRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  provider: string;
  title?: string;
  section?: string;
  order?: number;
}

export interface ExtensionComposerShelfRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  title?: string;
  placement: 'top' | 'bottom';
  frontendEntry?: string;
}

export interface ExtensionNewConversationPanelRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  title?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionToolbarActionRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  title: string;
  icon: string;
  action: string;
  when?: string;
  priority?: number;
}

export interface ExtensionComposerButtonRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  title?: string;
  slot?: 'leading' | 'preferences' | 'actions';
  when?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionComposerInputToolRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  title?: string;
  when?: string;
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionConversationDecoratorRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  position: 'before-title' | 'after-title' | 'subtitle';
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionStatusBarItemRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  label: string;
  action?: string;
  component?: string;
  alignment: 'left' | 'right';
  priority?: number;
  frontendEntry?: string;
}

export interface ExtensionConversationHeaderRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  label?: string;
  frontendEntry?: string;
}

export interface ExtensionContextMenuRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  title: string;
  action: string;
  surface: 'message' | 'conversationList' | 'selection' | 'fileSelection' | 'transcriptSelection';
  separator?: boolean;
  when?: string;
}

export interface ExtensionMessageActionRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  title: string;
  action: string;
  when?: string;
  priority?: number;
}

export interface ExtensionSettingsRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  key: string;
  type: string;
  default?: unknown;
  description?: string;
  group: string;
  enum?: string[];
  placeholder?: string;
  order: number;
}

export interface ExtensionSecretRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  id: string;
  key: string;
  label: string;
  description?: string;
  env?: string;
  placeholder?: string;
  order: number;
}

export interface ExtensionSecretBackendRegistration {
  extensionId: string;
  packageType: ExtensionManifest['packageType'];
  id: string;
  label: string;
  description?: string;
  handler: string;
  order: number;
}

export interface ExtensionSettingsComponentRegistration {
  extensionId: string;
  id: string;
  packageType: ExtensionManifest['packageType'];
  component: string;
  sectionId: string;
  label: string;
  description?: string;
  order?: number;
  frontendEntry?: string;
}

interface ExtensionRegistryConfig {
  disabledIds?: string[];
  enabledIds?: string[];
  disabledKeybindings?: string[];
  keybindingOverrides?: Record<string, string[]>;
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
    const enabledIds = Array.isArray(parsed.enabledIds) ? parsed.enabledIds.filter((id): id is string => typeof id === 'string') : [];
    const disabledKeybindings = Array.isArray(parsed.disabledKeybindings)
      ? parsed.disabledKeybindings.filter((id): id is string => typeof id === 'string')
      : [];
    const keybindingOverrides = isRecord(parsed.keybindingOverrides)
      ? Object.fromEntries(
          Object.entries(parsed.keybindingOverrides).flatMap(([id, keys]) =>
            Array.isArray(keys) ? [[id, keys.filter((key): key is string => typeof key === 'string')]] : [],
          ),
        )
      : {};
    return { disabledIds, enabledIds, disabledKeybindings, keybindingOverrides };
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

function readSkillFrontmatterFields(skillPath: string): { name?: string; description?: string } | null {
  const raw = readFileSync(skillPath, 'utf-8').replace(/\r\n/g, '\n');
  if (!raw.startsWith('---\n')) return null;
  const endIndex = raw.indexOf('\n---', 4);
  if (endIndex === -1) return null;
  const frontmatter = raw.slice(4, endIndex);
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  return { ...(name ? { name } : {}), ...(description ? { description } : {}) };
}

function validateExtensionSkillContribution(entry: ExtensionRegistryEntry, skill: string | ExtensionSkillContribution): string | null {
  if (!entry.packageRoot) {
    return 'Extension skill contributions require a package root.';
  }
  const normalized = normalizeExtensionSkillContribution(skill);
  if (!normalized.id?.trim()) {
    return 'Extension skill contribution is missing an id.';
  }
  if (!normalized.path?.trim()) {
    return `Extension skill ${normalized.id} is missing a path.`;
  }
  const skillPath = resolve(entry.packageRoot, normalized.path);
  try {
    assertInside(entry.packageRoot, skillPath);
  } catch {
    return `Extension skill ${normalized.id} path must stay inside the extension package.`;
  }
  if (!existsSync(skillPath)) {
    return `Extension skill ${normalized.id} path does not exist: ${normalized.path}`;
  }
  if (!normalized.path.endsWith('/SKILL.md') && normalized.path !== 'SKILL.md') {
    return `Extension skill ${normalized.id} should use the Agent Skills file name SKILL.md.`;
  }
  const frontmatter = readSkillFrontmatterFields(skillPath);
  if (!frontmatter?.name || !frontmatter.description) {
    return `Extension skill ${normalized.id} must use Agent Skills frontmatter with name and description.`;
  }
  return null;
}

function normalizeExtensionDependency(dependency: string | { id: string; optional?: boolean; version?: string }): {
  id: string;
  optional: boolean;
} {
  return typeof dependency === 'string'
    ? { id: dependency, optional: false }
    : { id: dependency.id, optional: Boolean(dependency.optional) };
}

function listExtensionContributionDiagnostics(entry: ExtensionRegistryEntry): string[] {
  const skillDiagnostics = (entry.manifest.contributes?.skills ?? [])
    .map((skill) => validateExtensionSkillContribution(entry, skill))
    .filter((diagnostic): diagnostic is string => diagnostic !== null);
  const installed = new Set(listExtensionEntries().map((candidate) => candidate.manifest.id));
  const dependencyDiagnostics = (entry.manifest.dependsOn ?? [])
    .map(normalizeExtensionDependency)
    .filter((dependency) => !dependency.optional && !installed.has(dependency.id))
    .map((dependency) => `Missing required extension dependency: ${dependency.id}`);
  return [...skillDiagnostics, ...dependencyDiagnostics];
}

function buildExtensionSkillRegistrations(entry: ExtensionRegistryEntry): ExtensionSkillRegistration[] {
  if (!entry.packageRoot) {
    return [];
  }
  return (entry.manifest.contributes?.skills ?? []).flatMap((skill): ExtensionSkillRegistration[] => {
    const normalized = normalizeExtensionSkillContribution(skill);
    if (validateExtensionSkillContribution(entry, normalized)) {
      return [];
    }
    const skillPath = resolve(entry.packageRoot!, normalized.path);
    const frontmatter = readSkillFrontmatterFields(skillPath);
    const id = normalized.id.trim();
    const name = `${entry.manifest.id}/${id}`;
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        id,
        name,
        title: normalized.title ?? frontmatter?.name,
        description: normalized.description ?? frontmatter?.description,
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

function buildExtensionSettingsRegistrations(entry: ExtensionRegistryEntry): ExtensionSettingsRegistration[] {
  const contributes = entry.manifest.contributes?.settings;
  if (!contributes) {
    return [];
  }
  return Object.entries(contributes).flatMap(([key, setting]) => {
    if (!setting || typeof setting !== 'object') {
      return [];
    }
    const type = typeof setting.type === 'string' ? setting.type : 'string';
    if (!['string', 'boolean', 'number', 'select'].includes(type)) {
      return [];
    }
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        key,
        type,
        default: setting.default,
        description: typeof setting.description === 'string' ? setting.description : undefined,
        group: typeof setting.group === 'string' && setting.group.trim() ? setting.group.trim() : 'General',
        enum: Array.isArray(setting.enum) ? setting.enum.filter((e): e is string => typeof e === 'string') : undefined,
        placeholder: typeof setting.placeholder === 'string' ? setting.placeholder : undefined,
        order: typeof setting.order === 'number' ? setting.order : 0,
      },
    ];
  });
}

function buildExtensionSecretRegistrations(entry: ExtensionRegistryEntry): ExtensionSecretRegistration[] {
  const contributes = entry.manifest.contributes?.secrets;
  if (!contributes) return [];
  return Object.entries(contributes).flatMap(([id, secret]: [string, ExtensionSecretContribution]): ExtensionSecretRegistration[] => {
    const normalizedId = id.trim();
    const label = typeof secret.label === 'string' ? secret.label.trim() : '';
    if (!normalizedId || !label) return [];
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        id: normalizedId,
        key: `${entry.manifest.id}.${normalizedId}`,
        label,
        description: typeof secret.description === 'string' ? secret.description : undefined,
        env: typeof secret.env === 'string' && secret.env.trim() ? secret.env.trim() : undefined,
        placeholder: typeof secret.placeholder === 'string' ? secret.placeholder : undefined,
        order: typeof secret.order === 'number' ? secret.order : 0,
      },
    ];
  });
}

function buildExtensionSecretBackendRegistrations(entry: ExtensionRegistryEntry): ExtensionSecretBackendRegistration[] {
  return (entry.manifest.contributes?.secretBackends ?? []).flatMap(
    (backend: ExtensionSecretBackendContribution): ExtensionSecretBackendRegistration[] => {
      const id = backend.id.trim();
      const label = backend.label.trim();
      const handler = backend.handler.trim();
      if (!id || !label || !handler) return [];
      return [
        {
          extensionId: entry.manifest.id,
          packageType: entry.manifest.packageType ?? 'user',
          id,
          label,
          description: typeof backend.description === 'string' ? backend.description : undefined,
          handler,
          order: typeof backend.order === 'number' ? backend.order : 0,
        },
      ];
    },
  );
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
    const replaces = typeof tool.replaces === 'string' ? tool.replaces.trim() : '';
    if ((!extensionPart || !toolPart) && !explicitName && !replaces) {
      return [];
    }
    return [
      {
        extensionId: entry.manifest.id,
        packageType: entry.manifest.packageType ?? 'user',
        id,
        name: replaces || explicitName || `extension_${extensionPart}_${toolPart}`,
        action: tool.action ?? tool.handler ?? id,
        ...(tool.title ? { title: tool.title } : {}),
        ...(tool.label ? { label: tool.label } : {}),
        description: tool.description,
        inputSchema: tool.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false },
        ...(tool.promptSnippet ? { promptSnippet: tool.promptSnippet } : {}),
        ...(tool.promptGuidelines ? { promptGuidelines: tool.promptGuidelines } : {}),
        ...(replaces ? { replaces } : {}),
      },
    ];
  });
}

function writeExtensionRegistryConfig(config: ExtensionRegistryConfig, stateRoot: string = getStateRoot()): void {
  const extensionsRoot = getRuntimeExtensionsRoot(stateRoot);
  mkdirSync(extensionsRoot, { recursive: true });
  writeFileSync(
    getExtensionRegistryConfigPath(stateRoot),
    `${JSON.stringify(
      {
        disabledIds: config.disabledIds ?? [],
        enabledIds: config.enabledIds ?? [],
        disabledKeybindings: config.disabledKeybindings ?? [],
        keybindingOverrides: config.keybindingOverrides ?? {},
      },
      null,
      2,
    )}\n`,
  );
}

export function isExtensionEnabled(extensionId: string, stateRoot: string = getStateRoot()): boolean {
  const config = readExtensionRegistryConfig(stateRoot);
  if ((config.disabledIds ?? []).includes(extensionId)) return false;
  const entry = listExtensionEntries(stateRoot).find((candidate) => candidate.manifest.id === extensionId);
  if (entry?.manifest.defaultEnabled === false) {
    return (config.enabledIds ?? []).includes(extensionId);
  }
  return true;
}

const LOCKED_EXTENSION_IDS = ['system-extension-manager'];

export function setExtensionEnabled(extensionId: string, enabled: boolean, stateRoot: string = getStateRoot()): void {
  if (!enabled && LOCKED_EXTENSION_IDS.includes(extensionId)) {
    throw new Error(`Cannot disable ${extensionId}: this extension is required by the application.`);
  }
  const config = readExtensionRegistryConfig(stateRoot);
  const disabledIds = new Set(config.disabledIds ?? []);
  const enabledIds = new Set(config.enabledIds ?? []);
  if (enabled) {
    disabledIds.delete(extensionId);
    enabledIds.add(extensionId);
  } else {
    disabledIds.add(extensionId);
    enabledIds.delete(extensionId);
  }
  writeExtensionRegistryConfig(
    {
      ...config,
      disabledIds: [...disabledIds].sort((left, right) => left.localeCompare(right)),
      enabledIds: [...enabledIds].sort((left, right) => left.localeCompare(right)),
    },
    stateRoot,
  );
}

export function setExtensionKeybinding(input: {
  extensionId: string;
  keybindingId: string;
  keys?: string[];
  enabled?: boolean;
  reset?: boolean;
  stateRoot?: string;
}): void {
  const stateRoot = input.stateRoot ?? getStateRoot();
  const config = readExtensionRegistryConfig(stateRoot);
  const key = `${input.extensionId}:${input.keybindingId}`;
  const disabledKeybindings = new Set(config.disabledKeybindings ?? []);
  const keybindingOverrides = { ...(config.keybindingOverrides ?? {}) };

  if (input.reset) {
    delete keybindingOverrides[key];
    disabledKeybindings.delete(key);
  }
  if (input.keys) {
    const keys = input.keys.map((candidate) => candidate.trim()).filter(Boolean);
    if (keys.length > 0) {
      keybindingOverrides[key] = keys;
    }
  }
  if (input.enabled !== undefined) {
    if (input.enabled) {
      disabledKeybindings.delete(key);
    } else {
      disabledKeybindings.add(key);
    }
  }

  writeExtensionRegistryConfig(
    {
      ...config,
      disabledKeybindings: [...disabledKeybindings].sort((left, right) => left.localeCompare(right)),
      keybindingOverrides,
    },
    stateRoot,
  );
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Extension manifest ${path} must be a non-empty string.`);
  }
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    throw new Error(`Extension manifest ${path} must be an array of non-empty strings.`);
  }
  return value;
}

function assertArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Extension manifest ${path} must be an array.`);
  }
  return value;
}

function assertRecordArray(value: unknown, path: string): Record<string, unknown>[] {
  return assertArray(value, path).map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Extension manifest ${path}[${index}] must be an object.`);
    }
    return item;
  });
}

function validateOptionalString(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`Extension manifest ${path} must be a string.`);
  }
}

function validateEnum(value: unknown, allowed: readonly string[], path: string): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`Extension manifest ${path} must be one of: ${allowed.join(', ')}.`);
  }
}

function validateThemeTokens(value: unknown, path: string): void {
  if (!isRecord(value)) {
    throw new Error(`Extension manifest ${path} must be an object.`);
  }

  for (const [key, tokenValue] of Object.entries(value)) {
    if (!/^--color-[a-z0-9-]+$/.test(key)) {
      throw new Error(`Extension manifest ${path}.${key} must be a --color-* CSS variable.`);
    }
    if (typeof tokenValue !== 'string' || !/^\d{1,3}\s+\d{1,3}\s+\d{1,3}$/.test(tokenValue.trim())) {
      throw new Error(`Extension manifest ${path}.${key} must be an RGB triplet string like "187 154 247".`);
    }
  }
}

function validateViewComponent(value: unknown, path: string): void {
  if (typeof value === 'string' && value.trim().length > 0) return;
  if (!isRecord(value)) throw new Error(`Extension manifest ${path} must be a component export string or host component object.`);
  const host = requireString(value.host, `${path}.host`);
  validateEnum(host, EXTENSION_HOST_VIEW_COMPONENTS, `${path}.host`);
  const definition = getHostViewComponentDefinition(host);
  const allowedOverrideSlots = Object.keys(definition?.overrideSlots ?? {});
  validateOptionalString(value.override, `${path}.override`);
  if (value.props !== undefined && !isRecord(value.props)) throw new Error(`Extension manifest ${path}.props must be an object.`);
  if (value.overrides !== undefined) {
    if (!isRecord(value.overrides)) throw new Error(`Extension manifest ${path}.overrides must be an object.`);
    for (const [slot, exportName] of Object.entries(value.overrides)) {
      if (!allowedOverrideSlots.includes(slot)) {
        throw new Error(`Extension manifest ${path}.overrides.${slot} must be one of: ${allowedOverrideSlots.join(', ')}.`);
      }
      requireString(exportName, `${path}.overrides.${slot}`);
    }
  }
  if (value.override !== undefined && !allowedOverrideSlots.includes('wrapper')) {
    throw new Error(`Extension manifest ${path}.override is only supported by host components with a wrapper slot.`);
  }
}

function validateExtensionContributions(contributes: Record<string, unknown>): void {
  if (contributes.views !== undefined) {
    for (const [index, view] of assertRecordArray(contributes.views, 'contributes.views').entries()) {
      requireString(view.id, `contributes.views[${index}].id`);
      requireString(view.title, `contributes.views[${index}].title`);
      validateEnum(view.location, ['main', 'rightRail', 'workbench'], `contributes.views[${index}].location`);
      validateViewComponent(view.component, `contributes.views[${index}].component`);
      validateOptionalString(view.route, `contributes.views[${index}].route`);
      if (view.scope !== undefined) validateEnum(view.scope, EXTENSION_RIGHT_SURFACE_SCOPES, `contributes.views[${index}].scope`);
      if (view.placement !== undefined) validateEnum(view.placement, EXTENSION_VIEW_PLACEMENTS, `contributes.views[${index}].placement`);
      if (view.placement !== undefined && view.scope !== undefined) {
        validateEnum(view.scope, EXTENSION_VIEW_SCOPES, `contributes.views[${index}].scope`);
      }
      if (view.activation !== undefined)
        validateEnum(view.activation, EXTENSION_VIEW_ACTIVATIONS, `contributes.views[${index}].activation`);
      if (view.icon !== undefined) validateEnum(view.icon, EXTENSION_ICON_NAMES, `contributes.views[${index}].icon`);
      validateOptionalString(view.detailView, `contributes.views[${index}].detailView`);
      validateOptionalString(view.toolSlot, `contributes.views[${index}].toolSlot`);
      if (view.routeCapabilities !== undefined) {
        for (const [capabilityIndex, capability] of requireStringArray(
          view.routeCapabilities,
          `contributes.views[${index}].routeCapabilities`,
        ).entries()) {
          validateEnum(capability, EXTENSION_ROUTE_CAPABILITIES, `contributes.views[${index}].routeCapabilities[${capabilityIndex}]`);
        }
      }
    }
  }

  if (contributes.nav !== undefined) {
    for (const [index, nav] of assertRecordArray(contributes.nav, 'contributes.nav').entries()) {
      requireString(nav.id, `contributes.nav[${index}].id`);
      requireString(nav.label, `contributes.nav[${index}].label`);
      requireString(nav.route, `contributes.nav[${index}].route`);
      if (nav.icon !== undefined) validateEnum(nav.icon, EXTENSION_ICON_NAMES, `contributes.nav[${index}].icon`);
      validateOptionalString(nav.badgeAction, `contributes.nav[${index}].badgeAction`);
      if (nav.section !== undefined) validateEnum(nav.section, ['primary', 'settings'], `contributes.nav[${index}].section`);
    }
  }

  if (contributes.commands !== undefined) {
    for (const [index, command] of assertRecordArray(contributes.commands, 'contributes.commands').entries()) {
      requireString(command.id, `contributes.commands[${index}].id`);
      requireString(command.title, `contributes.commands[${index}].title`);
      requireString(command.action, `contributes.commands[${index}].action`);
      if (command.icon !== undefined) validateEnum(command.icon, EXTENSION_ICON_NAMES, `contributes.commands[${index}].icon`);
      validateOptionalString(command.category, `contributes.commands[${index}].category`);
      validateOptionalString(command.description, `contributes.commands[${index}].description`);
      validateOptionalString(command.enablement, `contributes.commands[${index}].enablement`);
    }
  }

  if (contributes.keybindings !== undefined) {
    for (const [index, keybinding] of assertRecordArray(contributes.keybindings, 'contributes.keybindings').entries()) {
      requireString(keybinding.id, `contributes.keybindings[${index}].id`);
      requireString(keybinding.title, `contributes.keybindings[${index}].title`);
      requireStringArray(keybinding.keys, `contributes.keybindings[${index}].keys`);
      requireString(keybinding.command, `contributes.keybindings[${index}].command`);
      validateOptionalString(keybinding.when, `contributes.keybindings[${index}].when`);
      if (keybinding.scope !== undefined) validateEnum(keybinding.scope, ['global', 'surface'], `contributes.keybindings[${index}].scope`);
    }
  }

  if (contributes.slashCommands !== undefined) {
    for (const [index, command] of assertRecordArray(contributes.slashCommands, 'contributes.slashCommands').entries()) {
      requireString(command.name, `contributes.slashCommands[${index}].name`);
      requireString(command.description, `contributes.slashCommands[${index}].description`);
      requireString(command.action, `contributes.slashCommands[${index}].action`);
    }
  }

  if (contributes.mentions !== undefined) {
    for (const [index, mention] of assertRecordArray(contributes.mentions, 'contributes.mentions').entries()) {
      requireString(mention.id, `contributes.mentions[${index}].id`);
      requireString(mention.title, `contributes.mentions[${index}].title`);
      validateOptionalString(mention.description, `contributes.mentions[${index}].description`);
      requireStringArray(mention.kinds, `contributes.mentions[${index}].kinds`);
      requireString(mention.provider, `contributes.mentions[${index}].provider`);
    }
  }

  if (contributes.promptReferences !== undefined) {
    for (const [index, resolver] of assertRecordArray(contributes.promptReferences, 'contributes.promptReferences').entries()) {
      requireString(resolver.id, `contributes.promptReferences[${index}].id`);
      requireString(resolver.handler, `contributes.promptReferences[${index}].handler`);
      validateOptionalString(resolver.title, `contributes.promptReferences[${index}].title`);
    }
  }

  if (contributes.quickOpen !== undefined) {
    for (const [index, provider] of assertRecordArray(contributes.quickOpen, 'contributes.quickOpen').entries()) {
      requireString(provider.id, `contributes.quickOpen[${index}].id`);
      requireString(provider.provider, `contributes.quickOpen[${index}].provider`);
      validateOptionalString(provider.title, `contributes.quickOpen[${index}].title`);
      validateOptionalString(provider.section, `contributes.quickOpen[${index}].section`);
      if (provider.order !== undefined && !Number.isInteger(provider.order)) {
        throw new Error(`Extension manifest contributes.quickOpen[${index}].order must be an integer.`);
      }
    }
  }

  if (contributes.skills !== undefined) {
    for (const [index, skill] of assertArray(contributes.skills, 'contributes.skills').entries()) {
      if (typeof skill === 'string') {
        requireString(skill, `contributes.skills[${index}]`);
        continue;
      }
      if (!isRecord(skill)) throw new Error(`Extension manifest contributes.skills[${index}] must be a string or object.`);
      requireString(skill.id, `contributes.skills[${index}].id`);
      requireString(skill.path, `contributes.skills[${index}].path`);
      validateOptionalString(skill.title, `contributes.skills[${index}].title`);
      validateOptionalString(skill.description, `contributes.skills[${index}].description`);
    }
  }

  if (contributes.tools !== undefined) {
    for (const [index, tool] of assertRecordArray(contributes.tools, 'contributes.tools').entries()) {
      requireString(tool.id, `contributes.tools[${index}].id`);
      requireString(tool.description, `contributes.tools[${index}].description`);
      validateOptionalString(tool.title, `contributes.tools[${index}].title`);
      validateOptionalString(tool.label, `contributes.tools[${index}].label`);
      validateOptionalString(tool.action, `contributes.tools[${index}].action`);
      validateOptionalString(tool.handler, `contributes.tools[${index}].handler`);
      validateOptionalString(tool.name, `contributes.tools[${index}].name`);
      validateOptionalString(tool.replaces, `contributes.tools[${index}].replaces`);
      if (tool.promptGuidelines !== undefined) requireStringArray(tool.promptGuidelines, `contributes.tools[${index}].promptGuidelines`);
    }
  }

  if (contributes.transcriptRenderers !== undefined) {
    for (const [index, renderer] of assertRecordArray(contributes.transcriptRenderers, 'contributes.transcriptRenderers').entries()) {
      requireString(renderer.id, `contributes.transcriptRenderers[${index}].id`);
      requireString(renderer.tool, `contributes.transcriptRenderers[${index}].tool`);
      requireString(renderer.component, `contributes.transcriptRenderers[${index}].component`);
    }
  }

  if (contributes.themes !== undefined) {
    for (const [index, theme] of assertRecordArray(contributes.themes, 'contributes.themes').entries()) {
      requireString(theme.id, `contributes.themes[${index}].id`);
      requireString(theme.label, `contributes.themes[${index}].label`);
      validateEnum(theme.appearance, ['light', 'dark'], `contributes.themes[${index}].appearance`);
      validateThemeTokens(theme.tokens, `contributes.themes[${index}].tokens`);
    }
  }

  if (contributes.topBarElements !== undefined) {
    for (const [index, element] of assertRecordArray(contributes.topBarElements, 'contributes.topBarElements').entries()) {
      requireString(element.id, `contributes.topBarElements[${index}].id`);
      requireString(element.component, `contributes.topBarElements[${index}].component`);
      validateOptionalString(element.label, `contributes.topBarElements[${index}].label`);
    }
  }

  if (contributes.messageActions !== undefined) {
    for (const [index, action] of assertRecordArray(contributes.messageActions, 'contributes.messageActions').entries()) {
      requireString(action.id, `contributes.messageActions[${index}].id`);
      requireString(action.title, `contributes.messageActions[${index}].title`);
      requireString(action.action, `contributes.messageActions[${index}].action`);
      validateOptionalString(action.when, `contributes.messageActions[${index}].when`);
      if (action.priority !== undefined && (typeof action.priority !== 'number' || !Number.isInteger(action.priority))) {
        throw new Error(`Extension manifest contributes.messageActions[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.composerShelves !== undefined) {
    for (const [index, shelf] of assertRecordArray(contributes.composerShelves, 'contributes.composerShelves').entries()) {
      requireString(shelf.id, `contributes.composerShelves[${index}].id`);
      requireString(shelf.component, `contributes.composerShelves[${index}].component`);
      validateOptionalString(shelf.title, `contributes.composerShelves[${index}].title`);
      if (shelf.placement !== undefined)
        validateEnum(shelf.placement, ['top', 'bottom'], `contributes.composerShelves[${index}].placement`);
    }
  }

  if (contributes.newConversationPanels !== undefined) {
    for (const [index, panel] of assertRecordArray(contributes.newConversationPanels, 'contributes.newConversationPanels').entries()) {
      requireString(panel.id, `contributes.newConversationPanels[${index}].id`);
      requireString(panel.component, `contributes.newConversationPanels[${index}].component`);
      validateOptionalString(panel.title, `contributes.newConversationPanels[${index}].title`);
      if (panel.priority !== undefined && (typeof panel.priority !== 'number' || !Number.isInteger(panel.priority))) {
        throw new Error(`Extension manifest contributes.newConversationPanels[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.composerControls !== undefined) {
    for (const [index, control] of assertRecordArray(contributes.composerControls, 'contributes.composerControls').entries()) {
      requireString(control.id, `contributes.composerControls[${index}].id`);
      requireString(control.component, `contributes.composerControls[${index}].component`);
      validateOptionalString(control.title, `contributes.composerControls[${index}].title`);
      validateOptionalString(control.when, `contributes.composerControls[${index}].when`);
      if (control.slot !== undefined)
        validateEnum(control.slot, ['leading', 'preferences', 'actions'], `contributes.composerControls[${index}].slot`);
      if (control.priority !== undefined && (typeof control.priority !== 'number' || !Number.isInteger(control.priority))) {
        throw new Error(`Extension manifest contributes.composerControls[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.composerButtons !== undefined) {
    for (const [index, button] of assertRecordArray(contributes.composerButtons, 'contributes.composerButtons').entries()) {
      requireString(button.id, `contributes.composerButtons[${index}].id`);
      requireString(button.component, `contributes.composerButtons[${index}].component`);
      validateOptionalString(button.title, `contributes.composerButtons[${index}].title`);
      validateOptionalString(button.when, `contributes.composerButtons[${index}].when`);
      if (button.priority !== undefined && (typeof button.priority !== 'number' || !Number.isInteger(button.priority))) {
        throw new Error(`Extension manifest contributes.composerButtons[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.composerInputTools !== undefined) {
    for (const [index, tool] of assertRecordArray(contributes.composerInputTools, 'contributes.composerInputTools').entries()) {
      requireString(tool.id, `contributes.composerInputTools[${index}].id`);
      requireString(tool.component, `contributes.composerInputTools[${index}].component`);
      validateOptionalString(tool.title, `contributes.composerInputTools[${index}].title`);
      validateOptionalString(tool.when, `contributes.composerInputTools[${index}].when`);
      if (tool.priority !== undefined && (typeof tool.priority !== 'number' || !Number.isInteger(tool.priority))) {
        throw new Error(`Extension manifest contributes.composerInputTools[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.toolbarActions !== undefined) {
    for (const [index, action] of assertRecordArray(contributes.toolbarActions, 'contributes.toolbarActions').entries()) {
      requireString(action.id, `contributes.toolbarActions[${index}].id`);
      requireString(action.title, `contributes.toolbarActions[${index}].title`);
      validateEnum(action.icon, EXTENSION_ICON_NAMES, `contributes.toolbarActions[${index}].icon`);
      requireString(action.action, `contributes.toolbarActions[${index}].action`);
      validateOptionalString(action.when, `contributes.toolbarActions[${index}].when`);
      if (action.priority !== undefined && (typeof action.priority !== 'number' || !Number.isInteger(action.priority))) {
        throw new Error(`Extension manifest contributes.toolbarActions[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.contextMenus !== undefined) {
    for (const [index, menu] of assertRecordArray(contributes.contextMenus, 'contributes.contextMenus').entries()) {
      requireString(menu.id, `contributes.contextMenus[${index}].id`);
      requireString(menu.title, `contributes.contextMenus[${index}].title`);
      requireString(menu.action, `contributes.contextMenus[${index}].action`);
      validateEnum(
        menu.surface,
        ['message', 'conversationList', 'selection', 'fileSelection', 'transcriptSelection'],
        `contributes.contextMenus[${index}].surface`,
      );
      if (menu.separator !== undefined && typeof menu.separator !== 'boolean') {
        throw new Error(`Extension manifest contributes.contextMenus[${index}].separator must be a boolean.`);
      }
      validateOptionalString(menu.when, `contributes.contextMenus[${index}].when`);
    }
  }

  if (contributes.selectionActions !== undefined) {
    for (const [index, action] of assertRecordArray(contributes.selectionActions, 'contributes.selectionActions').entries()) {
      requireString(action.id, `contributes.selectionActions[${index}].id`);
      requireString(action.title, `contributes.selectionActions[${index}].title`);
      requireString(action.action, `contributes.selectionActions[${index}].action`);
      const kinds = requireStringArray(action.kinds, `contributes.selectionActions[${index}].kinds`);
      for (const [kindIndex, kind] of kinds.entries()) {
        validateEnum(kind, ['text', 'messages', 'files', 'transcriptRange'], `contributes.selectionActions[${index}].kinds[${kindIndex}]`);
      }
      validateOptionalString(action.when, `contributes.selectionActions[${index}].when`);
      if (action.priority !== undefined && (typeof action.priority !== 'number' || !Number.isInteger(action.priority))) {
        throw new Error(`Extension manifest contributes.selectionActions[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.transcriptBlocks !== undefined) {
    for (const [index, block] of assertRecordArray(contributes.transcriptBlocks, 'contributes.transcriptBlocks').entries()) {
      requireString(block.id, `contributes.transcriptBlocks[${index}].id`);
      requireString(block.component, `contributes.transcriptBlocks[${index}].component`);
      validateOptionalString(block.title, `contributes.transcriptBlocks[${index}].title`);
      if (block.schemaVersion !== undefined && (typeof block.schemaVersion !== 'number' || !Number.isInteger(block.schemaVersion))) {
        throw new Error(`Extension manifest contributes.transcriptBlocks[${index}].schemaVersion must be an integer.`);
      }
    }
  }

  if (contributes.subscriptions !== undefined) {
    for (const [index, subscription] of assertRecordArray(contributes.subscriptions, 'contributes.subscriptions').entries()) {
      requireString(subscription.id, `contributes.subscriptions[${index}].id`);
      requireString(subscription.handler, `contributes.subscriptions[${index}].handler`);
      requireString(subscription.source, `contributes.subscriptions[${index}].source`);
      validateOptionalString(subscription.pattern, `contributes.subscriptions[${index}].pattern`);
      if (
        subscription.debounceMs !== undefined &&
        (typeof subscription.debounceMs !== 'number' || !Number.isInteger(subscription.debounceMs))
      ) {
        throw new Error(`Extension manifest contributes.subscriptions[${index}].debounceMs must be an integer.`);
      }
    }
  }

  if (contributes.threadHeaderActions !== undefined) {
    for (const [index, action] of assertRecordArray(contributes.threadHeaderActions, 'contributes.threadHeaderActions').entries()) {
      requireString(action.id, `contributes.threadHeaderActions[${index}].id`);
      requireString(action.component, `contributes.threadHeaderActions[${index}].component`);
      validateOptionalString(action.title, `contributes.threadHeaderActions[${index}].title`);
      if (action.priority !== undefined && (typeof action.priority !== 'number' || !Number.isInteger(action.priority))) {
        throw new Error(`Extension manifest contributes.threadHeaderActions[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.statusBarItems !== undefined) {
    for (const [index, item] of assertRecordArray(contributes.statusBarItems, 'contributes.statusBarItems').entries()) {
      requireString(item.id, `contributes.statusBarItems[${index}].id`);
      requireString(item.label, `contributes.statusBarItems[${index}].label`);
      validateOptionalString(item.action, `contributes.statusBarItems[${index}].action`);
      validateOptionalString(item.component, `contributes.statusBarItems[${index}].component`);
      if (item.alignment !== undefined) validateEnum(item.alignment, ['left', 'right'], `contributes.statusBarItems[${index}].alignment`);
      if (item.priority !== undefined && (typeof item.priority !== 'number' || !Number.isInteger(item.priority))) {
        throw new Error(`Extension manifest contributes.statusBarItems[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.conversationHeaderElements !== undefined) {
    for (const [index, element] of assertRecordArray(
      contributes.conversationHeaderElements,
      'contributes.conversationHeaderElements',
    ).entries()) {
      requireString(element.id, `contributes.conversationHeaderElements[${index}].id`);
      requireString(element.component, `contributes.conversationHeaderElements[${index}].component`);
      validateOptionalString(element.label, `contributes.conversationHeaderElements[${index}].label`);
    }
  }

  if (contributes.conversationDecorators !== undefined) {
    for (const [index, decorator] of assertRecordArray(
      contributes.conversationDecorators,
      'contributes.conversationDecorators',
    ).entries()) {
      requireString(decorator.id, `contributes.conversationDecorators[${index}].id`);
      requireString(decorator.component, `contributes.conversationDecorators[${index}].component`);
      validateEnum(
        decorator.position,
        ['before-title', 'after-title', 'subtitle'],
        `contributes.conversationDecorators[${index}].position`,
      );
      if (decorator.priority !== undefined && (typeof decorator.priority !== 'number' || !Number.isInteger(decorator.priority))) {
        throw new Error(`Extension manifest contributes.conversationDecorators[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.activityTreeItemElements !== undefined) {
    for (const [index, element] of assertRecordArray(
      contributes.activityTreeItemElements,
      'contributes.activityTreeItemElements',
    ).entries()) {
      requireString(element.id, `contributes.activityTreeItemElements[${index}].id`);
      requireString(element.component, `contributes.activityTreeItemElements[${index}].component`);
      validateEnum(
        element.slot,
        ['leading', 'before-title', 'after-title', 'subtitle', 'trailing'],
        `contributes.activityTreeItemElements[${index}].slot`,
      );
      if (element.priority !== undefined && (typeof element.priority !== 'number' || !Number.isInteger(element.priority))) {
        throw new Error(`Extension manifest contributes.activityTreeItemElements[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.activityTreeItemStyles !== undefined) {
    for (const [index, style] of assertRecordArray(contributes.activityTreeItemStyles, 'contributes.activityTreeItemStyles').entries()) {
      requireString(style.id, `contributes.activityTreeItemStyles[${index}].id`);
      requireString(style.provider, `contributes.activityTreeItemStyles[${index}].provider`);
      if (style.priority !== undefined && (typeof style.priority !== 'number' || !Number.isInteger(style.priority))) {
        throw new Error(`Extension manifest contributes.activityTreeItemStyles[${index}].priority must be an integer.`);
      }
    }
  }

  if (contributes.settingsComponent !== undefined) {
    if (!isRecord(contributes.settingsComponent)) {
      throw new Error('Extension manifest contributes.settingsComponent must be an object.');
    }
    const panel = contributes.settingsComponent as Record<string, unknown>;
    requireString(panel.id, 'contributes.settingsComponent.id');
    requireString(panel.component, 'contributes.settingsComponent.component');
    requireString(panel.sectionId, 'contributes.settingsComponent.sectionId');
    requireString(panel.label, 'contributes.settingsComponent.label');
    validateOptionalString(panel.description, 'contributes.settingsComponent.description');
    if (panel.order !== undefined && (typeof panel.order !== 'number' || !Number.isInteger(panel.order))) {
      throw new Error('Extension manifest contributes.settingsComponent.order must be an integer.');
    }
  }

  if (contributes.settings !== undefined) {
    if (!isRecord(contributes.settings)) {
      throw new Error('Extension manifest contributes.settings must be an object.');
    }
    for (const [key, setting] of Object.entries(contributes.settings)) {
      if (!isRecord(setting)) {
        throw new Error(`Extension manifest contributes.settings.${key} must be an object.`);
      }
      const allowedTypes = ['string', 'boolean', 'number', 'select'];
      if (typeof setting.type === 'string' && !allowedTypes.includes(setting.type)) {
        throw new Error(`Extension manifest contributes.settings.${key}.type must be one of: ${allowedTypes.join(', ')}.`);
      }
      if (setting.enum !== undefined && !Array.isArray(setting.enum)) {
        throw new Error(`Extension manifest contributes.settings.${key}.enum must be an array.`);
      }
    }
  }

  if (contributes.secrets !== undefined) {
    if (!isRecord(contributes.secrets)) {
      throw new Error('Extension manifest contributes.secrets must be an object.');
    }
    for (const [key, secret] of Object.entries(contributes.secrets)) {
      if (!isRecord(secret)) {
        throw new Error(`Extension manifest contributes.secrets.${key} must be an object.`);
      }
      requireString(secret.label, `contributes.secrets.${key}.label`);
      validateOptionalString(secret.description, `contributes.secrets.${key}.description`);
      validateOptionalString(secret.env, `contributes.secrets.${key}.env`);
      validateOptionalString(secret.placeholder, `contributes.secrets.${key}.placeholder`);
      if (secret.order !== undefined && !Number.isInteger(secret.order)) {
        throw new Error(`Extension manifest contributes.secrets.${key}.order must be an integer.`);
      }
    }
  }

  if (contributes.secretBackends !== undefined) {
    if (!Array.isArray(contributes.secretBackends)) {
      throw new Error('Extension manifest contributes.secretBackends must be an array.');
    }
    contributes.secretBackends.forEach((backend, index) => {
      if (!isRecord(backend)) {
        throw new Error(`Extension manifest contributes.secretBackends[${index}] must be an object.`);
      }
      requireString(backend.id, `contributes.secretBackends[${index}].id`);
      requireString(backend.label, `contributes.secretBackends[${index}].label`);
      requireString(backend.handler, `contributes.secretBackends[${index}].handler`);
      validateOptionalString(backend.description, `contributes.secretBackends[${index}].description`);
      if (backend.order !== undefined && !Number.isInteger(backend.order)) {
        throw new Error(`Extension manifest contributes.secretBackends[${index}].order must be an integer.`);
      }
    });
  }
}

function validateExtensionBackend(backend: Record<string, unknown>): void {
  requireString(backend.entry, 'backend.entry');
  validateOptionalString(backend.agentExtension, 'backend.agentExtension');
  validateOptionalString(backend.startupAction, 'backend.startupAction');
  validateOptionalString(backend.onEnableAction, 'backend.onEnableAction');
  validateOptionalString(backend.onDisableAction, 'backend.onDisableAction');
  validateOptionalString(backend.onUninstallAction, 'backend.onUninstallAction');
  if (backend.services !== undefined) {
    for (const [index, service] of assertRecordArray(backend.services, 'backend.services').entries()) {
      requireString(service.id, `backend.services[${index}].id`);
      requireString(service.handler, `backend.services[${index}].handler`);
      validateOptionalString(service.title, `backend.services[${index}].title`);
      validateOptionalString(service.description, `backend.services[${index}].description`);
      validateOptionalString(service.healthCheck, `backend.services[${index}].healthCheck`);
      if (service.restart !== undefined)
        validateEnum(service.restart, ['never', 'on-failure', 'always'], `backend.services[${index}].restart`);
    }
  }
  if (backend.actions !== undefined) {
    for (const [index, action] of assertRecordArray(backend.actions, 'backend.actions').entries()) {
      requireString(action.id, `backend.actions[${index}].id`);
      requireString(action.handler, `backend.actions[${index}].handler`);
      validateOptionalString(action.title, `backend.actions[${index}].title`);
      validateOptionalString(action.description, `backend.actions[${index}].description`);
    }
  }
  if (backend.protocolEntrypoints !== undefined) {
    for (const [index, entrypoint] of assertRecordArray(backend.protocolEntrypoints, 'backend.protocolEntrypoints').entries()) {
      requireString(entrypoint.id, `backend.protocolEntrypoints[${index}].id`);
      requireString(entrypoint.handler, `backend.protocolEntrypoints[${index}].handler`);
      validateOptionalString(entrypoint.title, `backend.protocolEntrypoints[${index}].title`);
      validateOptionalString(entrypoint.description, `backend.protocolEntrypoints[${index}].description`);
    }
  }
  if (backend.routes !== undefined) {
    for (const [index, route] of assertRecordArray(backend.routes, 'backend.routes').entries()) {
      validateEnum(route.method, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], `backend.routes[${index}].method`);
      requireString(route.path, `backend.routes[${index}].path`);
      requireString(route.handler, `backend.routes[${index}].handler`);
      validateOptionalString(route.title, `backend.routes[${index}].title`);
      validateOptionalString(route.description, `backend.routes[${index}].description`);
      if (!(route.path as string).startsWith('/')) throw new Error(`backend.routes[${index}].path must start with /.`);
      if ((route.path as string).includes('..')) throw new Error(`backend.routes[${index}].path must not contain ..`);
    }
  }
}

function validateExtensionSurfaces(surfaces: unknown): void {
  for (const [index, surface] of assertRecordArray(surfaces, 'surfaces').entries()) {
    requireString(surface.id, `surfaces[${index}].id`);
    validateEnum(surface.placement, EXTENSION_PLACEMENTS, `surfaces[${index}].placement`);
    validateEnum(surface.kind, EXTENSION_SURFACE_KINDS, `surfaces[${index}].kind`);
    validateOptionalString(surface.title, `surfaces[${index}].title`);
    validateOptionalString(surface.label, `surfaces[${index}].label`);
    if (surface.icon !== undefined) validateEnum(surface.icon, EXTENSION_ICON_NAMES, `surfaces[${index}].icon`);
    validateOptionalString(surface.action, `surfaces[${index}].action`);
  }
}

export function parseExtensionManifest(value: unknown): ExtensionManifest {
  if (!isRecord(value)) {
    throw new Error('Extension manifest must be an object.');
  }
  if (value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new Error('Extension manifest schemaVersion must be 1 or 2.');
  }
  requireString(value.id, 'id');
  requireString(value.name, 'name');
  if (value.packageType !== undefined) validateEnum(value.packageType, EXTENSION_PACKAGE_TYPES, 'packageType');
  if (value.defaultEnabled !== undefined && typeof value.defaultEnabled !== 'boolean') {
    throw new Error('Extension manifest defaultEnabled must be a boolean.');
  }
  validateOptionalString(value.description, 'description');
  validateOptionalString(value.version, 'version');
  if (value.dependsOn !== undefined) {
    for (const [index, dependency] of assertArray(value.dependsOn, 'dependsOn').entries()) {
      if (typeof dependency === 'string') {
        requireString(dependency, `dependsOn[${index}]`);
        continue;
      }
      if (!isRecord(dependency)) throw new Error(`Extension manifest dependsOn[${index}] must be a string or object.`);
      requireString(dependency.id, `dependsOn[${index}].id`);
      if (dependency.optional !== undefined && typeof dependency.optional !== 'boolean') {
        throw new Error(`Extension manifest dependsOn[${index}].optional must be a boolean.`);
      }
      validateOptionalString(dependency.version, `dependsOn[${index}].version`);
    }
  }
  if (value.frontend !== undefined) {
    if (!isRecord(value.frontend)) throw new Error('Extension manifest frontend must be an object.');
    requireString(value.frontend.entry, 'frontend.entry');
    if (value.frontend.styles !== undefined) requireStringArray(value.frontend.styles, 'frontend.styles');
  }
  if (value.contributes !== undefined) {
    if (!isRecord(value.contributes)) throw new Error('Extension manifest contributes must be an object.');
    validateExtensionContributions(value.contributes);
  }
  if (value.backend !== undefined) {
    if (!isRecord(value.backend)) throw new Error('Extension manifest backend must be an object.');
    validateExtensionBackend(value.backend);
  }
  if (value.surfaces !== undefined) validateExtensionSurfaces(value.surfaces);
  if (value.permissions !== undefined) requireStringArray(value.permissions, 'permissions');

  return value as unknown as ExtensionManifest;
}

function fallbackInvalidExtensionId(packageRoot: string): string {
  return packageRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? 'invalid-extension';
}

export function readInvalidRuntimeExtensionEntries(stateRoot: string = getStateRoot()): InvalidExtensionEntry[] {
  return listExtensionPackagePaths({ runtimeRoot: getRuntimeExtensionsRoot(stateRoot) })
    .filter((entry) => entry.source === 'external' || entry.source === 'experimental')
    .flatMap((entry): InvalidExtensionEntry[] => {
      const manifestPath = join(entry.packageRoot, 'extension.json');
      try {
        parseExtensionManifest(JSON.parse(readFileSync(manifestPath, 'utf-8')));
        return [];
      } catch (error) {
        let id = fallbackInvalidExtensionId(entry.packageRoot);
        let name = id;
        try {
          const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as unknown;
          if (isRecord(raw)) {
            if (typeof raw.id === 'string' && raw.id.trim()) id = raw.id.trim();
            if (typeof raw.name === 'string' && raw.name.trim()) name = raw.name.trim();
          }
        } catch {
          // Keep path-derived fallback metadata.
        }
        return [
          {
            id,
            name,
            packageType: 'user',
            packageRoot: entry.packageRoot,
            source: 'runtime',
            errors: [error instanceof Error ? error.message : String(error)],
          },
        ];
      }
    });
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
    ...EXPERIMENTAL_EXTENSION_ENTRIES.map((entry) => ({
      manifest: entry.manifest,
      packageRoot: entry.packageRoot,
      source: 'runtime' as const,
    })),
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
  const valid = listExtensionEntries(stateRoot).map((entry) => {
    const manifest = entry.manifest;
    const surfaces = manifest.surfaces ?? [];
    const views = manifest.contributes?.views ?? [];
    const enabled = isExtensionEnabled(manifest.id, stateRoot);
    const diagnostics = listExtensionContributionDiagnostics(entry);
    const buildError = buildErrors.get(manifest.id);
    const healthError = healthErrors.get(manifest.id);
    return {
      id: manifest.id,
      name: manifest.name,
      packageType: manifest.packageType ?? 'user',
      enabled,
      status: enabled ? ('enabled' as const) : ('disabled' as const),
      ...(buildError ? { buildError } : {}),
      ...(healthError
        ? { healthError, diagnostics: [...diagnostics, `Backend health check failed: ${healthError}`] }
        : diagnostics.length > 0
          ? { diagnostics }
          : {}),
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.version ? { version: manifest.version } : {}),
      ...(entry.packageRoot ? { packageRoot: entry.packageRoot } : {}),
      manifest,
      permissions: manifest.permissions ?? [],
      surfaces,
      backendActions: manifest.backend?.actions ?? [],
      services: manifest.backend?.services ?? [],
      subscriptions: manifest.contributes?.subscriptions ?? [],
      dependsOn: manifest.dependsOn ?? [],
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
  const validIds = new Set(valid.map((extension) => extension.id));
  const invalid = readInvalidRuntimeExtensionEntries(stateRoot)
    .filter((entry) => !validIds.has(entry.id))
    .map(
      (entry): ExtensionInstallSummary => ({
        id: entry.id,
        name: entry.name,
        packageType: entry.packageType,
        enabled: false,
        status: 'invalid',
        errors: entry.errors,
        packageRoot: entry.packageRoot,
        manifest: { schemaVersion: 2, id: entry.id, name: entry.name, packageType: entry.packageType },
        permissions: [],
        surfaces: [],
        backendActions: [],
        services: [],
        subscriptions: [],
        dependsOn: [],
        skills: [],
        mentions: [],
        tools: [],
        routes: [],
      }),
    );
  return [...valid, ...invalid];
}

export function readExtensionSchema() {
  return {
    manifestVersion: 2,
    placements: EXTENSION_PLACEMENTS,
    surfaceKinds: EXTENSION_SURFACE_KINDS,
    rightSurfaceScopes: EXTENSION_RIGHT_SURFACE_SCOPES,
    routeCapabilities: EXTENSION_ROUTE_CAPABILITIES,
    iconNames: EXTENSION_ICON_NAMES,
    contributions: [
      'views',
      'nav',
      'commands',
      'keybindings',
      'slashCommands',
      'mentions',
      'settings',
      'settingsComponent',
      'skills',
      'tools',
      'promptReferences',
      'promptContextProviders',
      'quickOpen',
      'themes',
      'topBarElements',
      'messageActions',
      'composerShelves',
      'newConversationPanels',
      'composerControls',
      'composerButtons',
      'composerInputTools',
      'toolbarActions',
      'selectionActions',
      'transcriptBlocks',
      'subscriptions',
      'conversationDecorators',
      'activityTreeItemElements',
      'activityTreeItemStyles',
      'contextMenus',
      'threadHeaderActions',
      'statusBarItems',
      'conversationHeaderElements',
    ],
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
      ...(command.args !== undefined ? { args: command.args } : {}),
      ...(command.icon ? { icon: command.icon } : {}),
      ...(command.category ? { category: command.category } : {}),
      ...(command.description ? { description: command.description } : {}),
      ...(command.enablement ? { enablement: command.enablement } : {}),
    })),
  );
  return [...legacy, ...native];
}

export function listExtensionKeybindingRegistrations(stateRoot: string = getStateRoot()): ExtensionKeybindingRegistration[] {
  const snapshot = readExtensionRegistrySnapshot();
  const config = readExtensionRegistryConfig(stateRoot);
  const disabledKeybindings = new Set(config.disabledKeybindings ?? []);
  const keybindingOverrides = config.keybindingOverrides ?? {};
  return snapshot.extensions.flatMap((extension) =>
    (extension.contributes?.keybindings ?? []).flatMap((keybinding) => {
      const id = keybinding.id.trim();
      const title = keybinding.title.trim();
      const command = keybinding.command.trim();
      const registryKey = `${extension.id}:${id}`;
      const defaultKeys = keybinding.keys.map((key) => key.trim()).filter(Boolean);
      const keys = keybindingOverrides[registryKey] ?? defaultKeys;
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
          ...(keybinding.args !== undefined ? { args: keybinding.args } : {}),
          ...(keybinding.when ? { when: keybinding.when } : {}),
          scope: keybinding.scope ?? 'global',
          defaultKeys,
          enabled: !disabledKeybindings.has(registryKey),
        },
      ];
    }),
  );
}

export function findExtensionCommandRegistration(commandId: string): ExtensionCommandRegistration | undefined {
  return listExtensionCommandRegistrations().find(
    (command) => `${command.extensionId}.${command.surfaceId}` === commandId || command.surfaceId === commandId,
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

export function listExtensionPromptContextProviderRegistrations(
  stateRoot: string = getStateRoot(),
): ExtensionPromptContextProviderRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.promptContextProviders ?? []).flatMap((provider): ExtensionPromptContextProviderRegistration[] => {
      const id = provider.id.trim();
      const handler = provider.handler.trim();
      if (!id || !handler) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          handler,
          ...(provider.title ? { title: provider.title } : {}),
        },
      ];
    }),
  );
}

export function listExtensionPromptReferenceRegistrations(stateRoot: string = getStateRoot()): ExtensionPromptReferenceRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.promptReferences ?? []).flatMap((resolver): ExtensionPromptReferenceRegistration[] => {
      const id = resolver.id.trim();
      const handler = resolver.handler.trim();
      if (!id || !handler) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          handler,
          ...(resolver.title ? { title: resolver.title } : {}),
        },
      ];
    }),
  );
}

export function listExtensionQuickOpenRegistrations(stateRoot: string = getStateRoot()): ExtensionQuickOpenRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.quickOpen ?? []).flatMap((provider): ExtensionQuickOpenRegistration[] => {
      const id = provider.id.trim();
      const resolvedProvider = provider.provider.trim();
      if (!id || !resolvedProvider) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          provider: resolvedProvider,
          ...(provider.title ? { title: provider.title } : {}),
          ...(provider.section ? { section: provider.section } : {}),
          ...(Number.isInteger(provider.order) ? { order: provider.order } : {}),
        },
      ];
    }),
  );
}

export function listExtensionComposerShelfRegistrations(stateRoot: string = getStateRoot()): ExtensionComposerShelfRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.composerShelves ?? []).flatMap((shelf): ExtensionComposerShelfRegistration[] => {
      const id = shelf.id.trim();
      const component = shelf.component.trim();
      if (!id || !component) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          component,
          ...(shelf.title ? { title: shelf.title } : {}),
          placement: shelf.placement ?? 'bottom',
        },
      ];
    }),
  );
}

export function listExtensionNewConversationPanelRegistrations(
  stateRoot: string = getStateRoot(),
): ExtensionNewConversationPanelRegistration[] {
  return listEnabledExtensionEntries(stateRoot)
    .flatMap((entry) =>
      (entry.manifest.contributes?.newConversationPanels ?? []).flatMap((panel): ExtensionNewConversationPanelRegistration[] => {
        const id = panel.id.trim();
        const component = panel.component.trim();
        if (!id || !component) return [];
        return [
          {
            extensionId: entry.manifest.id,
            id,
            packageType: entry.manifest.packageType ?? 'user',
            component,
            ...(panel.title ? { title: panel.title } : {}),
            ...(typeof panel.priority === 'number' ? { priority: panel.priority } : {}),
            frontendEntry: entry.manifest.frontend?.entry,
          },
        ];
      }),
    )
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function listExtensionComposerButtonRegistrations(stateRoot: string = getStateRoot()): ExtensionComposerButtonRegistration[] {
  return listEnabledExtensionEntries(stateRoot)
    .flatMap((entry) => {
      const controls = (entry.manifest.contributes?.composerControls ?? []).flatMap((control): ExtensionComposerButtonRegistration[] => {
        const id = control.id.trim();
        const component = control.component.trim();
        if (!id || !component) return [];
        return [
          {
            extensionId: entry.manifest.id,
            id,
            packageType: entry.manifest.packageType ?? 'user',
            component,
            slot: control.slot ?? 'preferences',
            ...(control.title ? { title: control.title } : {}),
            ...(control.when ? { when: control.when } : {}),
            ...(typeof control.priority === 'number' ? { priority: control.priority } : {}),
            frontendEntry: entry.manifest.frontend?.entry,
          },
        ];
      });
      const buttons = (entry.manifest.contributes?.composerButtons ?? []).flatMap((button): ExtensionComposerButtonRegistration[] => {
        const id = button.id.trim();
        const component = button.component.trim();
        if (!id || !component) return [];
        return [
          {
            extensionId: entry.manifest.id,
            id,
            packageType: entry.manifest.packageType ?? 'user',
            component,
            slot: button.placement === 'actions' ? 'actions' : 'preferences',
            ...(button.title ? { title: button.title } : {}),
            ...(button.when ? { when: button.when } : {}),
            ...(typeof button.priority === 'number' ? { priority: button.priority } : {}),
            frontendEntry: entry.manifest.frontend?.entry,
          },
        ];
      });
      return [...controls, ...buttons];
    })
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.extensionId.localeCompare(b.extensionId) || a.id.localeCompare(b.id));
}

export function listExtensionComposerInputToolRegistrations(stateRoot: string = getStateRoot()): ExtensionComposerInputToolRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.composerInputTools ?? []).flatMap((tool): ExtensionComposerInputToolRegistration[] => {
      const id = tool.id.trim();
      const component = tool.component.trim();
      if (!id || !component) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          component,
          ...(tool.title ? { title: tool.title } : {}),
          ...(tool.when ? { when: tool.when } : {}),
          ...(typeof tool.priority === 'number' ? { priority: tool.priority } : {}),
          frontendEntry: entry.manifest.frontend?.entry,
        },
      ];
    }),
  );
}

export function listExtensionToolbarActionRegistrations(stateRoot: string = getStateRoot()): ExtensionToolbarActionRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.toolbarActions ?? []).flatMap((action): ExtensionToolbarActionRegistration[] => {
      const id = action.id.trim();
      const title = action.title.trim();
      const icon = action.icon.trim();
      const resolvedAction = action.action.trim();
      if (!id || !title || !icon || !resolvedAction) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          title,
          icon,
          action: resolvedAction,
          ...(action.when ? { when: action.when } : {}),
          ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
        },
      ];
    }),
  );
}

export function listExtensionStatusBarItemRegistrations(stateRoot: string = getStateRoot()): ExtensionStatusBarItemRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.statusBarItems ?? []).flatMap((item): ExtensionStatusBarItemRegistration[] => {
      const id = item.id.trim();
      const label = item.label.trim();
      if (!id || !label) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          label,
          ...(item.action ? { action: item.action } : {}),
          ...(item.component ? { component: item.component } : {}),
          alignment: item.alignment ?? 'right',
          ...(typeof item.priority === 'number' ? { priority: item.priority } : {}),
          frontendEntry: entry.manifest.frontend?.entry,
        },
      ];
    }),
  );
}

export function listExtensionContextMenuRegistrations(stateRoot: string = getStateRoot()): ExtensionContextMenuRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.contextMenus ?? []).flatMap((menu): ExtensionContextMenuRegistration[] => {
      const id = menu.id.trim();
      const title = menu.title.trim();
      const action = menu.action.trim();
      if (!id || !title || !action) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          title,
          action,
          surface: menu.surface,
          ...(menu.separator ? { separator: true } : {}),
          ...(menu.when ? { when: menu.when } : {}),
        },
      ];
    }),
  );
}

export function listExtensionConversationHeaderRegistrations(
  stateRoot: string = getStateRoot(),
): ExtensionConversationHeaderRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.conversationHeaderElements ?? []).flatMap((element): ExtensionConversationHeaderRegistration[] => {
      const id = element.id.trim();
      const component = element.component.trim();
      if (!id || !component) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          component,
          ...(element.label ? { label: element.label } : {}),
        },
      ];
    }),
  );
}

export function listExtensionConversationDecoratorRegistrations(
  stateRoot: string = getStateRoot(),
): ExtensionConversationDecoratorRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.conversationDecorators ?? []).flatMap((decorator): ExtensionConversationDecoratorRegistration[] => {
      const id = decorator.id.trim();
      const component = decorator.component.trim();
      if (!id || !component) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          component,
          position: decorator.position,
          ...(typeof decorator.priority === 'number' ? { priority: decorator.priority } : {}),
        },
      ];
    }),
  );
}

export function listExtensionMessageActionRegistrations(stateRoot: string = getStateRoot()): ExtensionMessageActionRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry) =>
    (entry.manifest.contributes?.messageActions ?? []).flatMap((action): ExtensionMessageActionRegistration[] => {
      const id = action.id.trim();
      const title = action.title.trim();
      const resolvedAction = action.action.trim();
      if (!id || !title || !resolvedAction) return [];
      return [
        {
          extensionId: entry.manifest.id,
          id,
          packageType: entry.manifest.packageType ?? 'user',
          title,
          action: resolvedAction,
          ...(action.when ? { when: action.when } : {}),
          ...(typeof action.priority === 'number' ? { priority: action.priority } : {}),
        },
      ];
    }),
  );
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

export function listExtensionSettingsRegistrations(stateRoot: string = getStateRoot()): ExtensionSettingsRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap(buildExtensionSettingsRegistrations);
}

export function listExtensionSecretRegistrations(stateRoot: string = getStateRoot()): ExtensionSecretRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap(buildExtensionSecretRegistrations);
}

export function listExtensionSecretBackendRegistrations(stateRoot: string = getStateRoot()): ExtensionSecretBackendRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap(buildExtensionSecretBackendRegistrations);
}

export function listExtensionSettingsComponentRegistrations(stateRoot: string = getStateRoot()): ExtensionSettingsComponentRegistration[] {
  return listEnabledExtensionEntries(stateRoot).flatMap((entry): ExtensionSettingsComponentRegistration[] => {
    const panel = entry.manifest.contributes?.settingsComponent;
    if (!panel) return [];
    const id = panel.id.trim();
    const component = panel.component.trim();
    const sectionId = panel.sectionId.trim();
    const label = panel.label.trim();
    if (!id || !component || !sectionId || !label) return [];
    return [
      {
        extensionId: entry.manifest.id,
        id,
        packageType: entry.manifest.packageType ?? 'user',
        component,
        sectionId,
        label,
        ...(panel.description ? { description: panel.description } : {}),
        ...(typeof panel.order === 'number' ? { order: panel.order } : {}),
        frontendEntry: entry.manifest.frontend?.entry,
      },
    ];
  });
}

export function findExtensionEntry(extensionId: string): ExtensionRegistryEntry | null {
  return listExtensionEntries().find((entry) => entry.manifest.id === extensionId) ?? null;
}
