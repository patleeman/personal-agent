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
  EXTENSION_PACKAGE_TYPES,
  EXTENSION_PLACEMENTS,
  EXTENSION_RIGHT_SURFACE_SCOPES,
  EXTENSION_ROUTE_CAPABILITIES,
  EXTENSION_SURFACE_KINDS,
  EXTENSION_VIEW_ACTIVATIONS,
  EXTENSION_VIEW_PLACEMENTS,
  EXTENSION_VIEW_SCOPES,
} from './extensionManifest.js';
import { listExtensionPackagePaths } from './extensionPackagePaths.js';
import { SYSTEM_EXTENSION_ENTRIES } from './systemExtensions.js';

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
  alignment: 'left' | 'right';
  priority?: number;
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
  surface: 'message' | 'conversationList';
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

interface ExtensionRegistryConfig {
  disabledIds?: string[];
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
    return { disabledIds, disabledKeybindings, keybindingOverrides };
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

function listExtensionContributionDiagnostics(entry: ExtensionRegistryEntry): string[] {
  return (entry.manifest.contributes?.skills ?? [])
    .map((skill) => validateExtensionSkillContribution(entry, skill))
    .filter((diagnostic): diagnostic is string => diagnostic !== null);
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
        disabledKeybindings: config.disabledKeybindings ?? [],
        keybindingOverrides: config.keybindingOverrides ?? {},
      },
      null,
      2,
    )}\n`,
  );
}

export function isExtensionEnabled(extensionId: string, stateRoot: string = getStateRoot()): boolean {
  return !(readExtensionRegistryConfig(stateRoot).disabledIds ?? []).includes(extensionId);
}

const LOCKED_EXTENSION_IDS = ['system-extension-manager'];

export function setExtensionEnabled(extensionId: string, enabled: boolean, stateRoot: string = getStateRoot()): void {
  if (!enabled && LOCKED_EXTENSION_IDS.includes(extensionId)) {
    throw new Error(`Cannot disable ${extensionId}: this extension is required by the application.`);
  }
  const config = readExtensionRegistryConfig(stateRoot);
  const disabledIds = new Set(config.disabledIds ?? []);
  if (enabled) {
    disabledIds.delete(extensionId);
  } else {
    disabledIds.add(extensionId);
  }
  writeExtensionRegistryConfig({ ...config, disabledIds: [...disabledIds].sort((left, right) => left.localeCompare(right)) }, stateRoot);
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

function validateExtensionContributions(contributes: Record<string, unknown>): void {
  if (contributes.views !== undefined) {
    for (const [index, view] of assertRecordArray(contributes.views, 'contributes.views').entries()) {
      requireString(view.id, `contributes.views[${index}].id`);
      requireString(view.title, `contributes.views[${index}].title`);
      validateEnum(view.location, ['main', 'rightRail', 'workbench'], `contributes.views[${index}].location`);
      requireString(view.component, `contributes.views[${index}].component`);
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
      validateEnum(menu.surface, ['message', 'conversationList'], `contributes.contextMenus[${index}].surface`);
      if (menu.separator !== undefined && typeof menu.separator !== 'boolean') {
        throw new Error(`Extension manifest contributes.contextMenus[${index}].separator must be a boolean.`);
      }
      validateOptionalString(menu.when, `contributes.contextMenus[${index}].when`);
    }
  }

  if (contributes.statusBarItems !== undefined) {
    for (const [index, item] of assertRecordArray(contributes.statusBarItems, 'contributes.statusBarItems').entries()) {
      requireString(item.id, `contributes.statusBarItems[${index}].id`);
      requireString(item.label, `contributes.statusBarItems[${index}].label`);
      validateOptionalString(item.action, `contributes.statusBarItems[${index}].action`);
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
}

function validateExtensionBackend(backend: Record<string, unknown>): void {
  requireString(backend.entry, 'backend.entry');
  validateOptionalString(backend.agentExtension, 'backend.agentExtension');
  if (backend.actions !== undefined) {
    for (const [index, action] of assertRecordArray(backend.actions, 'backend.actions').entries()) {
      requireString(action.id, `backend.actions[${index}].id`);
      requireString(action.handler, `backend.actions[${index}].handler`);
      validateOptionalString(action.title, `backend.actions[${index}].title`);
      validateOptionalString(action.description, `backend.actions[${index}].description`);
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
  validateOptionalString(value.description, 'description');
  validateOptionalString(value.version, 'version');
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
    .filter((entry) => entry.source === 'external')
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
    return {
      id: manifest.id,
      name: manifest.name,
      packageType: manifest.packageType ?? 'user',
      enabled,
      status: enabled ? ('enabled' as const) : ('disabled' as const),
      ...(diagnostics.length > 0 ? { diagnostics } : {}),
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
      'skills',
      'tools',
      'promptReferences',
      'quickOpen',
      'themes',
      'topBarElements',
      'messageActions',
      'composerShelves',
      'toolbarActions',
      'conversationDecorators',
      'contextMenus',
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
      ...(command.icon ? { icon: command.icon } : {}),
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
          ...(keybinding.when ? { when: keybinding.when } : {}),
          scope: keybinding.scope ?? 'global',
          defaultKeys,
          enabled: !disabledKeybindings.has(registryKey),
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
          alignment: item.alignment ?? 'right',
          ...(typeof item.priority === 'number' ? { priority: item.priority } : {}),
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

export function findExtensionEntry(extensionId: string): ExtensionRegistryEntry | null {
  return listExtensionEntries().find((entry) => entry.manifest.id === extensionId) ?? null;
}
