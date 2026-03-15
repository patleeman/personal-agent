import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { composePromptCatalogDirectory } from './prompt-catalog.js';
import { homedir } from 'os';
import { dirname, isAbsolute, join, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

function getDefaultStateRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_STATE_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome && xdgStateHome.trim().length > 0) {
    return join(resolve(expandHomePath(xdgStateHome.trim())), 'personal-agent');
  }

  return join(homedir(), '.local', 'state', 'personal-agent');
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

function hasSharedLayerResources(agentDir: string): boolean {
  const canonicalSharedEntries = [
    'AGENTS.md',
    'APPEND_SYSTEM.md',
    'SYSTEM.md',
    'settings.json',
    'models.json',
    'extensions',
    'skills',
    'prompts',
    'themes',
  ];

  return canonicalSharedEntries.some((entry) => existsSync(join(agentDir, entry)));
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
  const explicit = options.localProfileDir ?? process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR;

  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return join(getDefaultStateRoot(), 'config', 'local');
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

export function resolveProfileSettingsFilePath(profileName: string, options: ResolveProfileOptions = {}): string {
  const resolvedProfile = resolveResourceProfile(profileName, options);
  return join(resolvedProfile.profilesRoot, resolvedProfile.name, 'agent', 'settings.json');
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
    packages: readConfiguredPackageSources(settingsPath),
  };
}

export function installPackageSource(options: InstallPackageSourceOptions): InstallPackageSourceResult {
  const settingsPath = options.target === 'local'
    ? resolveLocalProfileSettingsFilePath(options)
    : resolveProfileSettingsFilePath(options.profileName ?? 'shared', options);
  const normalizedSource = normalizePackageSource(options.source, options.sourceBaseDir ?? process.cwd());
  const configuredPackages = readConfiguredPackageEntries(settingsPath);
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

  const settings = readSettingsObject(settingsPath);
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

export function getProfilesRoot(options: ResolveProfileOptions = {}): string {
  const explicit = options.profilesRoot ?? process.env.PERSONAL_AGENT_PROFILES_ROOT;
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return join(getDefaultStateRoot(), 'profiles');
}

function listProfilesInRoot(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(root, name, 'agent')));
}

export function listProfiles(options: ResolveProfileOptions = {}): string[] {
  const profilesRoot = getProfilesRoot(options);
  const repoRoot = getRepoRoot(options.repoRoot);
  const profiles = new Set<string>([
    ...listProfilesInRoot(profilesRoot),
  ]);

  if (existsSync(join(repoRoot, 'profiles', 'shared', 'agent'))) {
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

function collectRepoInternalSkillDirs(repoRoot: string): string[] {
  const internalSkillsDir = existingDir(join(repoRoot, 'skills'));
  return internalSkillsDir ? [internalSkillsDir] : [];
}

function collectLayerFiles(layers: ProfileLayer[], relativePath: string): string[] {
  const files = layers
    .map((layer) => existingFile(join(layer.agentDir, relativePath)))
    .filter((value): value is string => value !== undefined);

  return dedupe(files);
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

function assertPathWithinRoot(path: string, root: string, label: string): string {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);

  if (resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`)) {
    return resolvedPath;
  }

  throw new Error(`${label} path is outside ${resolvedRoot}: ${resolvedPath}`);
}

export function resolveResourceProfile(
  name: string,
  options: ResolveProfileOptions = {},
): ResolvedResourceProfile {
  const profileName = name || 'shared';
  validateProfileName(profileName);

  const repoRoot = getRepoRoot(options.repoRoot);
  const repoProfilesRoot = join(repoRoot, 'profiles');
  const profilesRoot = getProfilesRoot(options);

  const repoSharedAgentDir = assertPathWithinRoot(join(repoProfilesRoot, 'shared', 'agent'), repoProfilesRoot, 'Shared profile');
  if (!existsSync(repoSharedAgentDir)) {
    throw new Error(`Shared profile not found: ${repoSharedAgentDir}`);
  }

  const sharedAgentDirCandidate = existingDir(join(profilesRoot, 'shared', 'agent'));
  const mutableSharedAgentDir = sharedAgentDirCandidate && hasSharedLayerResources(sharedAgentDirCandidate)
    ? sharedAgentDirCandidate
    : undefined;
  const sharedAgentDir = mutableSharedAgentDir ?? repoSharedAgentDir;

  const layers: ProfileLayer[] = [{ name: 'shared', agentDir: resolve(sharedAgentDir) }];

  if (profileName !== 'shared') {
    const overlayDir = existingDir(join(profilesRoot, profileName, 'agent'));

    if (!overlayDir) {
      throw new Error(
        `Profile not found: ${profileName}. Checked ${join(profilesRoot, profileName, 'agent')}`,
      );
    }

    layers.push({ name: profileName, agentDir: resolve(overlayDir) });
  }

  const localBase = resolveLocalProfileDir(options);
  const localAgentDir = existingDir(join(localBase, 'agent')) ?? existingDir(localBase);
  if (localAgentDir) {
    layers.push({ name: 'local', agentDir: localAgentDir });
  }

  const systemPromptFile = [...layers]
    .reverse()
    .map((layer) => existingFile(join(layer.agentDir, 'SYSTEM.md')))
    .find((file): file is string => file !== undefined);

  const extensionDirs = collectLayerDirs(layers, 'extensions');
  const skillDirs = dedupe([
    ...collectLayerDirs(layers, 'skills'),
    ...collectRepoInternalSkillDirs(repoRoot),
  ]);
  const promptDirs = collectLayerDirs(layers, 'prompts');
  const themeDirs = collectLayerDirs(layers, 'themes');

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
    agentsFiles: collectLayerFiles(layers, 'AGENTS.md'),
    appendSystemFiles: collectLayerFiles(layers, 'APPEND_SYSTEM.md'),
    systemPromptFile,
    settingsFiles: collectLayerFiles(layers, 'settings.json'),
    modelsFiles: collectLayerFiles(layers, 'models.json'),
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
  const merged = mergeJsonFiles(profileSettingsFiles);
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

  if (profile.settingsFiles.length > 0) {
    const targetSettingsPath = join(targetDir, 'settings.json');
    const settings = mergeMaterializedSettings(profile.settingsFiles, targetSettingsPath);
    writeOrRemove('settings.json', JSON.stringify(settings, null, 2));
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
