import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import {
  getDurableAgentFilePath,
  getDurableModelsDir as getCanonicalLegacyDurableModelsDir,
  getDurableNodesDir as getCanonicalDurableNodesDir,
  getDurableProfilesDir as getCanonicalDurableProfilesDir,
  getDurableProfileDir,
  getDurableProfileAgentFilePath,
  getDurableProfileModelsFilePath,
  getDurableProfileSettingsFilePath,
  getDurableSettingsDir as getCanonicalLegacyDurableSettingsDir,
  getLocalProfileDir as getCanonicalLocalProfileDir,
  getVaultRoot,
} from './runtime/paths.js';
import { listUnifiedSkillNodeDirs } from './nodes.js';
import { readMachineInstructionFiles, readMachineSkillDirs } from './machine-config.js';
import { homedir } from 'os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { composePromptCatalogDirectory } from './prompt-catalog.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function buildVaultRootAppendSystemChunk(vaultRoot: string = getVaultRoot()): string {
  return [
    '## Durable knowledge vault',
    `The canonical durable knowledge vault root is: ${vaultRoot}`,
    'Use this path when you need to read or write durable notes, projects, skills, or root instruction files.',
    'Treat the vault as the source of truth for durable knowledge; do not assume those files live under the runtime state subtree.',
  ].join('\n');
}

export interface ProfileLayer {
  name: string;
  agentDir: string;
}

export interface ResolvedResourceProfile {
  name: string;
  repoRoot: string;
  profilesRoot: string;
  layers: ProfileLayer[];
  extensionDirs: string[];
  extensionEntries: string[];
  skillDirs: string[];
  promptDirs: string[];
  promptEntries: string[];
  themeDirs: string[];
  themeEntries: string[];
  agentsFiles: string[];
  appendSystemFiles: string[];
  systemPromptFile?: string;
  settingsFiles: string[];
  modelsFiles: string[];
}

export interface ResolveProfileOptions {
  repoRoot?: string;
  localProfileDir?: string;
  profilesRoot?: string;
}

export type PackageInstallTarget = 'profile' | 'local';

export interface ConfiguredPackageSource {
  source: string;
  filtered: boolean;
}

export interface PackageSourceTargetState {
  target: PackageInstallTarget;
  settingsPath: string;
  packages: ConfiguredPackageSource[];
}

export interface InstallPackageSourceOptions extends ResolveProfileOptions {
  source: string;
  target: PackageInstallTarget;
  profileName?: string;
  sourceBaseDir?: string;
}

export interface InstallPackageSourceResult {
  installed: boolean;
  alreadyPresent: boolean;
  source: string;
  target: PackageInstallTarget;
  settingsPath: string;
}

function readJsonFile(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Failed to read JSON file ${path}: ${(error as Error).message}`);
  }
}

const DANGEROUS_MERGE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (DANGEROUS_MERGE_KEYS.has(key)) {
      continue;
    }

    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (value && typeof value === 'object') {
      const current = output[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        output[key] = deepMerge({}, value as Record<string, unknown>);
      }
      continue;
    }

    output[key] = value;
  }

  return output;
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const path of paths) {
    const resolvedPath = resolve(path);
    if (seen.has(resolvedPath)) continue;
    seen.add(resolvedPath);
    output.push(resolvedPath);
  }

  return output;
}

function existingDir(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  if (!statSync(path).isDirectory()) return undefined;
  return resolve(path);
}

function existingFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  if (!statSync(path).isFile()) return undefined;
  return resolve(path);
}

function readSettingsObject(settingsPath: string): Record<string, unknown> {
  if (!existsSync(settingsPath)) {
    return {};
  }

  const parsed = readJsonFile(settingsPath);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Settings file must contain a JSON object: ${settingsPath}`);
  }

  return parsed;
}

function writeSettingsObject(settingsPath: string, settings: Record<string, unknown>): void {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function isRemotePackageSource(value: string): boolean {
  return value.startsWith('npm:')
    || value.startsWith('git:')
    || value.startsWith('https://')
    || value.startsWith('http://')
    || value.startsWith('ssh://')
    || value.startsWith('git://');
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return homedir();
  }

  if (value.startsWith('~/')) {
    return join(homedir(), value.slice(2));
  }

  return value;
}

function looksLikeExplicitLocalPath(value: string): boolean {
  return value === '.'
    || value === '..'
    || value.startsWith('./')
    || value.startsWith('../')
    || value.startsWith('~/')
    || value === '~'
    || value.startsWith('/');
}

function normalizePackageSource(value: string, baseDir: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error('Package source must not be empty');
  }

  if (isRemotePackageSource(trimmed)) {
    return trimmed;
  }

  const expanded = expandHomePath(trimmed);
  if (isAbsolute(expanded)) {
    return resolve(expanded);
  }

  const candidate = resolve(baseDir, expanded);
  if (looksLikeExplicitLocalPath(trimmed) || existsSync(candidate)) {
    return candidate;
  }

  return trimmed;
}

function extractPackageSource(entry: unknown): string | undefined {
  if (typeof entry === 'string') {
    return entry;
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return undefined;
  }

  const source = (entry as { source?: unknown }).source;
  return typeof source === 'string' ? source : undefined;
}

export function resolveLocalProfileDir(options: ResolveProfileOptions = {}): string {
  const explicit = options.localProfileDir;

  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return getCanonicalLocalProfileDir();
}

export function resolveLocalProfileSettingsFilePath(options: ResolveProfileOptions = {}): string {
  const localProfileDir = resolveLocalProfileDir(options);
  const nestedAgentDir = join(localProfileDir, 'agent');

  if (existsSync(nestedAgentDir)) {
    if (!statSync(nestedAgentDir).isDirectory()) {
      throw new Error(`Local profile agent path is not a directory: ${nestedAgentDir}`);
    }

    return join(nestedAgentDir, 'settings.json');
  }

  if (existsSync(localProfileDir) && !statSync(localProfileDir).isDirectory()) {
    throw new Error(`Local profile path is not a directory: ${localProfileDir}`);
  }

  return join(localProfileDir, 'settings.json');
}

function legacyScopedFileNameForProfile(profileName: string): string {
  return profileName === 'shared' ? 'global.json' : `${profileName}.json`;
}

function resolveLegacyProfileSettingsFilePath(profileName: string, options: ResolveProfileOptions = {}): string {
  validateProfileName(profileName || 'shared');
  return join(getLegacySettingsRoot(options), legacyScopedFileNameForProfile(profileName || 'shared'));
}

function resolveLegacyProfileAgentFilePath(profileName: string, options: ResolveProfileOptions = {}): string {
  validateProfileName(profileName || 'shared');
  return join(resolveProfilesRoot(options), profileName || 'shared', 'agent', 'AGENTS.md');
}

export function resolveProfileSettingsFilePath(profileName: string, options: ResolveProfileOptions = {}): string {
  validateProfileName(profileName || 'shared');
  return getDurableProfileSettingsFilePath(profileName || 'shared', getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

export function resolveProfileModelsFilePath(profileName: string, options: ResolveProfileOptions = {}): string {
  validateProfileName(profileName || 'shared');
  return getDurableProfileModelsFilePath(profileName || 'shared', getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

export function resolveProfileAgentFilePath(profileName: string, options: ResolveProfileOptions = {}): string {
  validateProfileName(profileName || 'shared');
  return getDurableProfileAgentFilePath(profileName || 'shared', getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

function readConfiguredPackageEntries(settingsPath: string): unknown[] {
  const settings = readSettingsObject(settingsPath);
  const value = settings.packages;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`Expected "packages" in ${settingsPath} to be an array`);
  }

  return [...value];
}

function readWritableProfileSettingsObject(profileName: string, options: ResolveProfileOptions = {}): Record<string, unknown> {
  const canonicalPath = resolveProfileSettingsFilePath(profileName, options);
  if (existsSync(canonicalPath)) {
    return readSettingsObject(canonicalPath);
  }

  const legacyPath = resolveLegacyProfileSettingsFilePath(profileName, options);
  if (existsSync(legacyPath)) {
    return readSettingsObject(legacyPath);
  }

  return {};
}

function readWritableProfilePackageEntries(profileName: string, options: ResolveProfileOptions = {}): unknown[] {
  const canonicalPath = resolveProfileSettingsFilePath(profileName, options);
  if (existsSync(canonicalPath)) {
    return readConfiguredPackageEntries(canonicalPath);
  }

  const legacyPath = resolveLegacyProfileSettingsFilePath(profileName, options);
  if (existsSync(legacyPath)) {
    return readConfiguredPackageEntries(legacyPath);
  }

  return [];
}

export function readConfiguredPackageSources(settingsPath: string): ConfiguredPackageSource[] {
  return readConfiguredPackageEntries(settingsPath)
    .map((entry) => {
      if (typeof entry === 'string') {
        return {
          source: entry,
          filtered: false,
        } satisfies ConfiguredPackageSource;
      }

      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return null;
      }

      const source = extractPackageSource(entry);
      if (!source) {
        return null;
      }

      return {
        source,
        filtered: true,
      } satisfies ConfiguredPackageSource;
    })
    .filter((entry): entry is ConfiguredPackageSource => entry !== null);
}

export function readPackageSourceTargetState(
  target: PackageInstallTarget,
  profileNameOrOptions?: string | ResolveProfileOptions,
  maybeOptions: ResolveProfileOptions = {},
): PackageSourceTargetState {
  const profileName = typeof profileNameOrOptions === 'string' ? profileNameOrOptions : undefined;
  const options = typeof profileNameOrOptions === 'string' ? maybeOptions : (profileNameOrOptions ?? maybeOptions);

  const settingsPath = target === 'local'
    ? resolveLocalProfileSettingsFilePath(options)
    : resolveProfileSettingsFilePath(profileName ?? 'shared', options);

  return {
    target,
    settingsPath,
    packages: target === 'local'
      ? readConfiguredPackageSources(settingsPath)
      : readWritableProfilePackageEntries(profileName ?? 'shared', options)
        .map((entry) => {
          if (typeof entry === 'string') {
            return {
              source: entry,
              filtered: false,
            } satisfies ConfiguredPackageSource;
          }

          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return null;
          }

          const source = extractPackageSource(entry);
          if (!source) {
            return null;
          }

          return {
            source,
            filtered: true,
          } satisfies ConfiguredPackageSource;
        })
        .filter((entry): entry is ConfiguredPackageSource => entry !== null),
  };
}

export function installPackageSource(options: InstallPackageSourceOptions): InstallPackageSourceResult {
  const profileName = options.profileName ?? 'shared';
  const settingsPath = options.target === 'local'
    ? resolveLocalProfileSettingsFilePath(options)
    : resolveProfileSettingsFilePath(profileName, options);
  const normalizedSource = normalizePackageSource(options.source, options.sourceBaseDir ?? process.cwd());
  const configuredPackages = options.target === 'local'
    ? readConfiguredPackageEntries(settingsPath)
    : readWritableProfilePackageEntries(profileName, options);
  const settingsDir = dirname(settingsPath);
  const alreadyPresent = configuredPackages.some((entry) => {
    const source = extractPackageSource(entry);
    if (!source) {
      return false;
    }

    return normalizePackageSource(source, settingsDir) === normalizedSource;
  });

  if (alreadyPresent) {
    return {
      installed: false,
      alreadyPresent: true,
      source: normalizedSource,
      target: options.target,
      settingsPath,
    };
  }

  const settings = options.target === 'local'
    ? readSettingsObject(settingsPath)
    : readWritableProfileSettingsObject(profileName, options);
  settings.packages = [...configuredPackages, normalizedSource];
  writeSettingsObject(settingsPath, settings);

  return {
    installed: true,
    alreadyPresent: false,
    source: normalizedSource,
    target: options.target,
    settingsPath,
  };
}

export function getRepoRoot(explicitRepoRoot?: string): string {
  const value = explicitRepoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? PACKAGE_ROOT;
  return resolve(value);
}

export function getRepoDefaultsAgentDir(explicitRepoRoot?: string): string {
  return join(getRepoRoot(explicitRepoRoot), 'defaults', 'agent');
}

function resolveProfilesRoot(options: ResolveProfileOptions = {}): string {
  const explicit = options.profilesRoot ?? process.env.PERSONAL_AGENT_PROFILES_ROOT;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return getCanonicalDurableProfilesDir();
}

function getSyncRootFromProfilesRoot(profilesRoot: string): string {
  return dirname(resolve(profilesRoot));
}

function getLegacySettingsRoot(options: ResolveProfileOptions = {}): string {
  return getCanonicalLegacyDurableSettingsDir(getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

function getLegacyModelsRoot(options: ResolveProfileOptions = {}): string {
  return getCanonicalLegacyDurableModelsDir(getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

function getProfileDir(profileName: string, options: ResolveProfileOptions = {}): string {
  return getDurableProfileDir(profileName || 'shared', getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

function getNodesRoot(options: ResolveProfileOptions = {}): string {
  return getCanonicalDurableNodesDir(getSyncRootFromProfilesRoot(resolveProfilesRoot(options)));
}

function listProfilesInRoot(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const profiles = new Set<string>();

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory() && /^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(entry.name)) {
      profiles.add(entry.name);
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.json')) {
      const name = entry.name.slice(0, -'.json'.length);
      if (/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(name)) {
        profiles.add(name);
      }
    }
  }

  return [...profiles].sort((left, right) => left.localeCompare(right));
}

function rootHasSharedDurableResources(root: string, extensions: string[]): boolean {
  if (!existsSync(root)) {
    return false;
  }

  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'shared' || entry.name === 'global') {
          return true;
        }
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!extensions.some((extension) => entry.name.endsWith(extension))) {
        continue;
      }

      const baseName = entry.name.replace(/\.[^.]+$/, '');
      if (baseName === 'shared' || baseName === 'global') {
        return true;
      }
    }
  }

  return false;
}

export function listProfiles(options: ResolveProfileOptions = {}): string[] {
  const profilesRoot = resolveProfilesRoot(options);
  const repoRoot = getRepoRoot(options.repoRoot);
  const profiles = new Set<string>([
    ...listProfilesInRoot(profilesRoot),
  ]);

  const repoDefaultsAgentDir = existingDir(getRepoDefaultsAgentDir(repoRoot));
  if (
    repoDefaultsAgentDir
    || Boolean(resolveSharedVaultAgentFile(options))
    || rootHasSharedDurableResources(getLegacySettingsRoot(options), ['.json'])
    || rootHasSharedDurableResources(getLegacyModelsRoot(options), ['.json'])
    || existsSync(getNodesRoot(options))
  ) {
    profiles.add('shared');
  }

  return [...profiles].sort((left, right) => left.localeCompare(right));
}

function collectLayerDirs(layers: ProfileLayer[], relativePath: string): string[] {
  const dirs = layers
    .map((layer) => existingDir(join(layer.agentDir, relativePath)))
    .filter((value): value is string => value !== undefined);

  return dedupe(dirs);
}

function collectRepoInternalExtensionDirs(repoRoot: string): string[] {
  const internalExtensionsDir = existingDir(join(repoRoot, 'extensions'));
  return internalExtensionsDir ? [internalExtensionsDir] : [];
}

function collectRepoInternalThemeDirs(repoRoot: string): string[] {
  const internalThemesDir = existingDir(join(repoRoot, 'themes'));
  return internalThemesDir ? [internalThemesDir] : [];
}

function collectLayerFiles(layers: ProfileLayer[], relativePath: string): string[] {
  const files = layers
    .map((layer) => existingFile(join(layer.agentDir, relativePath)))
    .filter((value): value is string => value !== undefined);

  return dedupe(files);
}

function resolveConfiguredInstructionFiles(): string[] {
  return dedupe(readMachineInstructionFiles().flatMap((path) => {
    const file = existingFile(path);
    return file ? [file] : [];
  }));
}

function collectConfiguredSkillDirs(rootDir: string): string[] {
  const directSkillFiles = [existingFile(join(rootDir, 'SKILL.md')), existingFile(join(rootDir, 'INDEX.md'))]
    .filter((value): value is string => value !== undefined);
  if (directSkillFiles.length > 0) {
    return [rootDir];
  }

  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) {
    return [];
  }

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(rootDir, entry.name))
    .filter((dir) => existingFile(join(dir, 'SKILL.md')) !== undefined || existingFile(join(dir, 'INDEX.md')) !== undefined)
    .sort((left, right) => left.localeCompare(right));
}

function resolveConfiguredSkillDirs(): string[] {
  return dedupe(readMachineSkillDirs().flatMap((path) => {
    const dir = existingDir(path);
    return dir ? collectConfiguredSkillDirs(dir) : [];
  }));
}

function isScopeAlias(value: string): boolean {
  return value === 'shared' || value === 'global';
}

function fileDirectScopeApplies(baseName: string, profileName: string, knownProfiles: Set<string>): boolean | undefined {
  if (isScopeAlias(baseName) || baseName.startsWith('shared-') || baseName.startsWith('global-')) {
    return true;
  }

  if (baseName === profileName || baseName.startsWith(`${profileName}-`)) {
    return true;
  }

  for (const knownProfile of knownProfiles) {
    if (baseName === knownProfile || baseName.startsWith(`${knownProfile}-`)) {
      return false;
    }
  }

  return undefined;
}

function relativePathAppliesToProfile(root: string, filePath: string, profileName: string, knownProfiles: Set<string>): boolean {
  const relativePath = relative(root, filePath).replace(/\\/g, '/');
  const segments = relativePath.split('/').filter((segment) => segment.length > 0);
  const firstSegment = segments[0];

  if (firstSegment && segments.length > 1 && (knownProfiles.has(firstSegment) || isScopeAlias(firstSegment))) {
    return isScopeAlias(firstSegment) || firstSegment === profileName;
  }

  const baseName = basename(filePath).replace(/\.[^.]+$/, '');
  const directScope = fileDirectScopeApplies(baseName, profileName, knownProfiles);
  if (directScope !== undefined) {
    return directScope;
  }

  return true;
}

function collectScopedFiles(root: string, extensions: string[], profileName: string, knownProfiles: Set<string>): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const output: string[] = [];
  const stack = [resolve(root)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (!extensions.some((extension) => entry.name.endsWith(extension))) {
        continue;
      }

      if (relativePathAppliesToProfile(root, fullPath, profileName, knownProfiles)) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return dedupe(output);
}

function isExtensionEntrypointFile(name: string): boolean {
  if (!name.endsWith('.ts') && !name.endsWith('.js')) {
    return false;
  }

  if (name.endsWith('.test.ts') || name.endsWith('.test.js')) {
    return false;
  }

  if (name.endsWith('.spec.ts') || name.endsWith('.spec.js')) {
    return false;
  }

  return true;
}

function discoverExtensionEntries(extensionDir: string): string[] {
  if (!existsSync(extensionDir)) return [];

  const entries = readdirSync(extensionDir, { withFileTypes: true });
  const output: string[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      if (isExtensionEntrypointFile(entry.name)) {
        output.push(join(extensionDir, entry.name));
      }
      continue;
    }

    if (entry.isDirectory()) {
      const indexTs = join(extensionDir, entry.name, 'index.ts');
      const indexJs = join(extensionDir, entry.name, 'index.js');

      if (existsSync(indexTs)) {
        output.push(indexTs);
      } else if (existsSync(indexJs)) {
        output.push(indexJs);
      }
    }
  }

  output.sort();
  return dedupe(output);
}

function discoverFilesWithExtensions(rootDir: string, extensions: string[]): string[] {
  if (!existsSync(rootDir)) return [];

  const output: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return dedupe(output);
}

function validateProfileName(profileName: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-_]*$/.test(profileName)) {
    throw new Error(
      `Invalid profile name "${profileName}". ` +
      'Profile names may only include letters, numbers, dashes, and underscores.',
    );
  }
}

function resolveSharedVaultAgentFile(options: ResolveProfileOptions = {}): string | undefined {
  return existingFile(getDurableAgentFilePath(getSyncRootFromProfilesRoot(resolveProfilesRoot(options))));
}

function resolveDurableAgentFiles(profileName: string, options: ResolveProfileOptions = {}): string[] {
  const output: string[] = [];
  const sharedAgent = resolveSharedVaultAgentFile(options)
    ?? existingFile(resolveProfileAgentFilePath('shared', options))
    ?? existingFile(resolveLegacyProfileAgentFilePath('shared', options));
  const profileAgent = profileName === 'shared'
    ? undefined
    : existingFile(resolveProfileAgentFilePath(profileName, options))
      ?? existingFile(resolveLegacyProfileAgentFilePath(profileName, options));

  if (sharedAgent) {
    output.push(sharedAgent);
  }

  if (profileAgent) {
    output.push(profileAgent);
  }

  return dedupe(output);
}

function resolveDurableSettingsFiles(profileName: string, knownProfiles: Set<string>, options: ResolveProfileOptions = {}): string[] {
  const output: string[] = [];
  const sharedSettings = existingFile(resolveProfileSettingsFilePath('shared', options));
  const profileSettings = existingFile(resolveProfileSettingsFilePath(profileName, options));

  if (profileName === 'shared') {
    if (sharedSettings) {
      output.push(sharedSettings);
    }
  } else {
    if (sharedSettings) {
      output.push(sharedSettings);
    }
    if (profileSettings) {
      output.push(profileSettings);
    }
  }

  output.push(...collectScopedFiles(getLegacySettingsRoot(options), ['.json'], profileName, knownProfiles));
  return dedupe(output);
}

function resolveDurableModelsFiles(profileName: string, knownProfiles: Set<string>, options: ResolveProfileOptions = {}): string[] {
  const output: string[] = [];
  const sharedModels = existingFile(resolveProfileModelsFilePath('shared', options));
  const profileModels = existingFile(resolveProfileModelsFilePath(profileName, options));

  if (profileName === 'shared') {
    if (sharedModels) {
      output.push(sharedModels);
    }
  } else {
    if (sharedModels) {
      output.push(sharedModels);
    }
    if (profileModels) {
      output.push(profileModels);
    }
  }

  output.push(...collectScopedFiles(getLegacyModelsRoot(options), ['.json'], profileName, knownProfiles));
  return dedupe(output);
}

export function resolveResourceProfile(
  name: string,
  options: ResolveProfileOptions = {},
): ResolvedResourceProfile {
  const profileName = name || 'shared';
  validateProfileName(profileName);

  const repoRoot = getRepoRoot(options.repoRoot);
  const profilesRoot = resolveProfilesRoot(options);
  const syncRoot = getSyncRootFromProfilesRoot(profilesRoot);
  const declaredProfiles = listProfilesInRoot(profilesRoot);
  if (profileName !== 'shared' && !declaredProfiles.includes(profileName)) {
    throw new Error(
      `Profile not found: ${profileName}. Checked ${join(profilesRoot, profileName)}`,
    );
  }

  const knownProfiles = new Set<string>([
    ...declaredProfiles,
    profileName,
    'shared',
  ]);

  const repoDefaultsAgentDir = existingDir(getRepoDefaultsAgentDir(repoRoot));
  const localBase = resolveLocalProfileDir(options);
  const localAgentDir = existingDir(join(localBase, 'agent')) ?? existingDir(localBase);

  const durableAgentFiles = resolveDurableAgentFiles(profileName, options);
  const configuredInstructionFiles = resolveConfiguredInstructionFiles();
  const configuredSkillDirs = resolveConfiguredSkillDirs();
  const durableSettingsFiles = resolveDurableSettingsFiles(profileName, knownProfiles, options);
  const durableModelsFiles = resolveDurableModelsFiles(profileName, knownProfiles, options);
  const durableSkillDirs = listUnifiedSkillNodeDirs(profileName, { profilesRoot });

  const layers: ProfileLayer[] = [];

  if (repoDefaultsAgentDir) {
    layers.push({ name: 'defaults', agentDir: repoDefaultsAgentDir });
  }

  if (
    durableAgentFiles.length > 0
    || durableSettingsFiles.length > 0
    || durableModelsFiles.length > 0
    || durableSkillDirs.length > 0
    || existsSync(getProfileDir(profileName, options))
    || existsSync(join(profilesRoot, `${profileName}.json`))
    || profileName === 'shared'
  ) {
    layers.push({ name: 'durable', agentDir: syncRoot });
  }

  if (localAgentDir) {
    layers.push({ name: 'local', agentDir: localAgentDir });
  }

  if (layers.length === 0) {
    throw new Error(
      `Shared defaults not found. Checked ${getRepoDefaultsAgentDir(repoRoot)} and ${syncRoot}`,
    );
  }

  const localLayers = layers.filter((layer) => layer.name === 'local');
  const systemPromptFile = [...layers]
    .reverse()
    .map((layer) => existingFile(join(layer.agentDir, 'SYSTEM.md')))
    .find((file): file is string => file !== undefined);

  const extensionDirs = dedupe([
    ...collectLayerDirs(localLayers, 'extensions'),
    ...collectRepoInternalExtensionDirs(repoRoot),
  ]);
  const skillDirs = dedupe([
    ...durableSkillDirs,
    ...configuredSkillDirs,
    ...collectLayerDirs(localLayers, 'skills'),
  ]);
  const promptDirs = collectLayerDirs(localLayers, 'prompts');
  const themeDirs = dedupe([
    ...collectLayerDirs(localLayers, 'themes'),
    ...collectRepoInternalThemeDirs(repoRoot),
  ]);

  const extensionEntries = dedupe(extensionDirs.flatMap((dir) => discoverExtensionEntries(dir)));
  const promptEntries = dedupe(promptDirs.flatMap((dir) => discoverFilesWithExtensions(dir, ['.md'])));
  const themeEntries = dedupe(themeDirs.flatMap((dir) => discoverFilesWithExtensions(dir, ['.json'])));

  return {
    name: profileName,
    repoRoot,
    profilesRoot,
    layers,
    extensionDirs,
    extensionEntries,
    skillDirs,
    promptDirs,
    promptEntries,
    themeDirs,
    themeEntries,
    agentsFiles: dedupe([
      ...collectLayerFiles(repoDefaultsAgentDir ? [{ name: 'defaults', agentDir: repoDefaultsAgentDir }] : [], 'AGENTS.md'),
      ...durableAgentFiles,
      ...configuredInstructionFiles,
      ...collectLayerFiles(localLayers, 'AGENTS.md'),
    ]),
    appendSystemFiles: collectLayerFiles(layers.filter((layer) => layer.name !== 'durable'), 'APPEND_SYSTEM.md'),
    systemPromptFile,
    settingsFiles: dedupe([
      ...collectLayerFiles(repoDefaultsAgentDir ? [{ name: 'defaults', agentDir: repoDefaultsAgentDir }] : [], 'settings.json'),
      ...durableSettingsFiles,
      ...collectLayerFiles(localLayers, 'settings.json'),
    ]),
    modelsFiles: dedupe([
      ...collectLayerFiles(repoDefaultsAgentDir ? [{ name: 'defaults', agentDir: repoDefaultsAgentDir }] : [], 'models.json'),
      ...durableModelsFiles,
      ...collectLayerFiles(localLayers, 'models.json'),
    ]),
  };
}

export function mergeJsonFiles(paths: string[]): Record<string, unknown> {
  let merged: Record<string, unknown> = {};
  for (const path of paths) {
    merged = deepMerge(merged, readJsonFile(path));
  }
  return merged;
}

function combineMarkdownChunks(chunks: string[], separator = '\n\n---\n\n'): string {
  return chunks.map((chunk) => chunk.trim()).filter((text) => text.length > 0).join(separator);
}

function combineMarkdownFiles(paths: string[]): string {
  return combineMarkdownChunks(paths.map((path) => readFileSync(path, 'utf-8')));
}

function readRuntimeLastChangelogVersion(settingsPath: string): string | undefined {
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, 'utf-8')) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const value = (parsed as Record<string, unknown>).lastChangelogVersion;
    if (typeof value !== 'string' || value.length === 0) {
      return undefined;
    }

    return value;
  } catch {
    return undefined;
  }
}

function mergeMaterializedSettings(profileSettingsFiles: string[], targetSettingsPath: string): Record<string, unknown> {
  let merged: Record<string, unknown> = {};

  for (const path of profileSettingsFiles) {
    const layerSettings = readJsonFile(path);
    merged = deepMerge(merged, layerSettings);
  }

  const runtimeLastChangelogVersion = readRuntimeLastChangelogVersion(targetSettingsPath);

  if (runtimeLastChangelogVersion) {
    merged.lastChangelogVersion = runtimeLastChangelogVersion;
  } else {
    delete merged.lastChangelogVersion;
  }

  return merged;
}

export interface MaterializeProfileResult {
  agentDir: string;
  writtenFiles: string[];
}

export function materializeProfileToAgentDir(
  profile: ResolvedResourceProfile,
  agentDir: string,
): MaterializeProfileResult {
  const targetDir = resolve(agentDir);
  mkdirSync(targetDir, { recursive: true });

  const writtenFiles: string[] = [];

  const writeOrRemove = (fileName: string, content: string | undefined) => {
    const targetPath = join(targetDir, fileName);

    if (content === undefined) {
      if (existsSync(targetPath)) {
        rmSync(targetPath, { force: true });
      }
      return;
    }

    writeFileSync(targetPath, content);
    writtenFiles.push(targetPath);
  };

  const materializedSettings = profile.settingsFiles.length > 0
    ? mergeMaterializedSettings(profile.settingsFiles, join(targetDir, 'settings.json'))
    : null;

  if (materializedSettings) {
    writeOrRemove('settings.json', JSON.stringify(materializedSettings, null, 2));
  } else {
    writeOrRemove('settings.json', undefined);
  }

  if (profile.modelsFiles.length > 0) {
    const models = mergeJsonFiles(profile.modelsFiles);
    writeOrRemove('models.json', JSON.stringify(models, null, 2));
  } else {
    writeOrRemove('models.json', undefined);
  }

  if (profile.agentsFiles.length > 0) {
    const agentsContent = combineMarkdownFiles(profile.agentsFiles);
    writeOrRemove('AGENTS.md', `${agentsContent}\n`);
  } else {
    writeOrRemove('AGENTS.md', undefined);
  }

  if (profile.systemPromptFile) {
    const systemContent = readFileSync(profile.systemPromptFile, 'utf-8');
    writeOrRemove('SYSTEM.md', systemContent);
  } else {
    writeOrRemove('SYSTEM.md', undefined);
  }

  const generatedAppendContent = composePromptCatalogDirectory('system', { repoRoot: profile.repoRoot, separator: '\n\n' });
  const fileAppendContent = profile.appendSystemFiles.length > 0
    ? combineMarkdownFiles(profile.appendSystemFiles)
    : undefined;
  const appendContent = combineMarkdownChunks([
    generatedAppendContent ?? '',
    buildVaultRootAppendSystemChunk(getSyncRootFromProfilesRoot(profile.profilesRoot)),
    fileAppendContent ?? '',
  ]);

  if (appendContent.length > 0) {
    writeOrRemove('APPEND_SYSTEM.md', `${appendContent}\n`);
  } else {
    writeOrRemove('APPEND_SYSTEM.md', undefined);
  }

  return { agentDir: targetDir, writtenFiles };
}

export interface BuildPiArgsOptions {
  includeNoDiscoveryFlags?: boolean;
}

export function getExtensionDependencyDirs(profile: ResolvedResourceProfile): string[] {
  const dependencyDirs: string[] = [];

  for (const extensionDir of profile.extensionDirs) {
    if (!existsSync(extensionDir)) {
      continue;
    }

    if (existsSync(join(extensionDir, 'package.json'))) {
      dependencyDirs.push(extensionDir);
    }

    const entries = readdirSync(extensionDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const candidate = join(extensionDir, entry.name);
      if (existsSync(join(candidate, 'package.json'))) {
        dependencyDirs.push(candidate);
      }
    }
  }

  return dedupe(dependencyDirs);
}

export function buildPiResourceArgs(
  profile: ResolvedResourceProfile,
  options: BuildPiArgsOptions = {},
): string[] {
  const args: string[] = [];

  if (options.includeNoDiscoveryFlags !== false) {
    args.push('--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes');
  }

  for (const extensionEntry of profile.extensionEntries) {
    args.push('-e', extensionEntry);
  }

  for (const skillDir of profile.skillDirs) {
    args.push('--skill', skillDir);
  }

  for (const promptEntry of profile.promptEntries) {
    args.push('--prompt-template', promptEntry);
  }

  for (const themeEntry of profile.themeEntries) {
    args.push('--theme', themeEntry);
  }

  return args;
}

export {
  composePromptCatalogDirectory,
  composePromptCatalogEntries,
  getPromptCatalogRoot,
  listPromptCatalogEntries,
  readPromptCatalogEntry,
  renderPromptCatalogTemplate,
  requirePromptCatalogEntry,
} from './prompt-catalog.js';
