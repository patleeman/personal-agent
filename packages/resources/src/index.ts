import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_LOCAL_PROFILE_DIR = join(homedir(), '.config', 'personal-agent', 'local');

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
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (value && typeof value === 'object') {
      const current = output[key];
      if (current && typeof current === 'object' && !Array.isArray(current)) {
        output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      } else {
        output[key] = { ...(value as Record<string, unknown>) };
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

export function getRepoRoot(explicitRepoRoot?: string): string {
  const value = explicitRepoRoot ?? process.env.PERSONAL_AGENT_REPO_ROOT ?? PACKAGE_ROOT;
  return resolve(value);
}

export function getProfilesRoot(options: ResolveProfileOptions = {}): string {
  return join(getRepoRoot(options.repoRoot), 'profiles');
}

export function listProfiles(options: ResolveProfileOptions = {}): string[] {
  const profilesRoot = getProfilesRoot(options);
  if (!existsSync(profilesRoot)) return [];

  const entries = readdirSync(profilesRoot, { withFileTypes: true });
  const profiles = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(profilesRoot, name, 'agent')));

  profiles.sort();
  return profiles;
}

function collectLayerDirs(layers: ProfileLayer[], relativePath: string): string[] {
  const dirs = layers
    .map((layer) => existingDir(join(layer.agentDir, relativePath)))
    .filter((value): value is string => value !== undefined);

  return dedupe(dirs);
}

function collectLayerFiles(layers: ProfileLayer[], relativePath: string): string[] {
  const files = layers
    .map((layer) => existingFile(join(layer.agentDir, relativePath)))
    .filter((value): value is string => value !== undefined);

  return dedupe(files);
}

function discoverExtensionEntries(extensionDir: string): string[] {
  if (!existsSync(extensionDir)) return [];

  const entries = readdirSync(extensionDir, { withFileTypes: true });
  const output: string[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.js')) {
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

export function resolveResourceProfile(
  name: string,
  options: ResolveProfileOptions = {},
): ResolvedResourceProfile {
  const profileName = name || 'shared';
  const repoRoot = getRepoRoot(options.repoRoot);
  const profilesRoot = join(repoRoot, 'profiles');
  const sharedAgentDir = join(profilesRoot, 'shared', 'agent');

  if (!existsSync(sharedAgentDir)) {
    throw new Error(`Shared profile not found: ${sharedAgentDir}`);
  }

  const layers: ProfileLayer[] = [{ name: 'shared', agentDir: resolve(sharedAgentDir) }];

  if (profileName !== 'shared') {
    const overlayDir = join(profilesRoot, profileName, 'agent');
    if (!existsSync(overlayDir)) {
      throw new Error(`Profile not found: ${profileName} (${overlayDir})`);
    }
    layers.push({ name: profileName, agentDir: resolve(overlayDir) });
  }

  const localBase = options.localProfileDir ?? process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR ?? DEFAULT_LOCAL_PROFILE_DIR;
  const localAgentDir = existingDir(join(localBase, 'agent')) ?? existingDir(localBase);
  if (localAgentDir) {
    layers.push({ name: 'local', agentDir: localAgentDir });
  }

  const systemPromptFile = [...layers]
    .reverse()
    .map((layer) => existingFile(join(layer.agentDir, 'SYSTEM.md')))
    .find((file): file is string => file !== undefined);

  const extensionDirs = collectLayerDirs(layers, 'extensions');
  const skillDirs = collectLayerDirs(layers, 'skills');
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

function combineMarkdownFiles(paths: string[]): string {
  const chunks = paths.map((path) => readFileSync(path, 'utf-8').trim()).filter((text) => text.length > 0);
  return chunks.join('\n\n---\n\n');
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
    const settings = mergeJsonFiles(profile.settingsFiles);
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

  if (profile.appendSystemFiles.length > 0) {
    const appendContent = combineMarkdownFiles(profile.appendSystemFiles);
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
  return profile.extensionDirs.filter((dir) => existsSync(join(dir, 'package.json')));
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
