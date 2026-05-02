import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';

import { getConfigRoot } from './runtime/paths.js';

export const DEFAULT_RESUME_FALLBACK_PROMPT = 'Continue from where you left off.';
export const DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH = 'main';

export type MachineConfigSectionKey = 'daemon' | 'ui';

export interface MachineConfigDocument {
  vaultRoot?: string;
  knowledgeBaseRepoUrl?: string;
  knowledgeBaseBranch?: string;
  instructionFiles?: string[];
  skillDirs?: string[];
  daemon?: Record<string, unknown>;
  ui?: Record<string, unknown>;
}

export interface MachineConfigOptions {
  configRoot?: string;
  filePath?: string;
}

export interface MachineUiConfigState {
  resumeFallbackPrompt: string;
}

export interface MachineKnowledgeBaseState {
  repoUrl: string;
  branch: string;
}

export interface WriteMachineUiConfigInput {
  resumeFallbackPrompt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(overlay)) {
    if (Array.isArray(value)) {
      output[key] = [...value];
      continue;
    }

    if (isRecord(value)) {
      const current = output[key];
      output[key] = isRecord(current) ? deepMerge(current, value) : deepMerge({}, value);
      continue;
    }

    if (value !== undefined) {
      output[key] = value;
    }
  }

  return output;
}

function normalizeSection(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.keys(value).length > 0 ? deepMerge({}, value) : undefined;
}

function readJsonObjectFile(path: string, label: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('root must be an object');
    }

    return parsed;
  } catch (error) {
    console.error(`Failed to read ${label} at ${path}: ${(error as Error).message}. Using defaults.`);
    return undefined;
  }
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  ];

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMachineConfig(value: unknown): MachineConfigDocument {
  const document = isRecord(value) ? value : {};
  const vaultRoot = typeof document.vaultRoot === 'string' && document.vaultRoot.trim().length > 0 ? document.vaultRoot.trim() : undefined;
  const knowledgeBaseRepoUrl =
    typeof document.knowledgeBaseRepoUrl === 'string' && document.knowledgeBaseRepoUrl.trim().length > 0
      ? document.knowledgeBaseRepoUrl.trim()
      : undefined;
  const knowledgeBaseBranch =
    typeof document.knowledgeBaseBranch === 'string' && document.knowledgeBaseBranch.trim().length > 0
      ? document.knowledgeBaseBranch.trim()
      : undefined;
  const instructionFiles = normalizeStringArray(document.instructionFiles);
  const skillDirs = normalizeStringArray(document.skillDirs);
  const daemon = normalizeSection(document.daemon);
  const ui = normalizeSection(document.ui);

  return {
    ...(vaultRoot ? { vaultRoot } : {}),
    ...(knowledgeBaseRepoUrl ? { knowledgeBaseRepoUrl } : {}),
    ...(knowledgeBaseBranch ? { knowledgeBaseBranch } : {}),
    ...(instructionFiles ? { instructionFiles } : {}),
    ...(skillDirs ? { skillDirs } : {}),
    ...(daemon ? { daemon } : {}),
    ...(ui ? { ui } : {}),
  };
}

function resolveConfigDirectory(options: MachineConfigOptions = {}): string {
  if (options.filePath) {
    return dirname(resolve(options.filePath));
  }

  return resolve(options.configRoot ?? getConfigRoot());
}

function readLegacyMachineConfigSections(options: MachineConfigOptions = {}): Record<string, unknown> {
  const configDir = resolveConfigDirectory(options);
  const legacySections: Record<string, unknown> = {};

  const daemon = readJsonObjectFile(join(configDir, 'daemon.json'), 'legacy daemon config');
  if (daemon) {
    legacySections.daemon = daemon;
  }

  return legacySections;
}

function removeLegacyMachineConfigFiles(options: MachineConfigOptions = {}): void {
  const configDir = resolveConfigDirectory(options);
  const currentFilePath = getMachineConfigFilePath(options);

  for (const fileName of ['daemon.json']) {
    const legacyPath = join(configDir, fileName);
    if (legacyPath === currentFilePath) {
      continue;
    }

    rmSync(legacyPath, { force: true });
  }
}

export function getMachineConfigFilePath(options: MachineConfigOptions = {}): string {
  if (options.filePath) {
    return resolve(options.filePath);
  }

  if (options.configRoot) {
    return join(resolve(options.configRoot), 'config.json');
  }

  const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(explicit.trim());
  }

  return join(resolve(getConfigRoot()), 'config.json');
}

function resolveSectionOptions(section: MachineConfigSectionKey, options: MachineConfigOptions = {}): MachineConfigOptions {
  if (options.filePath || options.configRoot) {
    return options;
  }

  if (section === 'daemon') {
    const explicit = process.env.PERSONAL_AGENT_DAEMON_CONFIG;
    if (explicit && explicit.trim().length > 0) {
      return { filePath: explicit.trim() };
    }
  }

  return options;
}

function getLegacySingleSection(options: MachineConfigOptions = {}): {
  section: MachineConfigSectionKey;
  filePath: string;
} | null {
  const filePath = getMachineConfigFilePath(options);
  const fileName = basename(filePath);

  if (fileName === 'daemon.json') {
    return { section: 'daemon', filePath };
  }

  return null;
}

export function readMachineConfig(options: MachineConfigOptions = {}): MachineConfigDocument {
  const filePath = getMachineConfigFilePath(options);
  const legacySingleSection = getLegacySingleSection(options);
  if (legacySingleSection) {
    const sectionValue = readJsonObjectFile(legacySingleSection.filePath, `legacy ${legacySingleSection.section} config`);
    return normalizeMachineConfig(sectionValue ? { [legacySingleSection.section]: sectionValue } : {});
  }

  const legacySections = readLegacyMachineConfigSections(options);
  const document = readJsonObjectFile(filePath, 'machine config') ?? {};
  return normalizeMachineConfig(deepMerge(legacySections, document));
}

export function writeMachineConfig(document: MachineConfigDocument, options: MachineConfigOptions = {}): MachineConfigDocument {
  const filePath = getMachineConfigFilePath(options);
  const normalized = normalizeMachineConfig(document);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  removeLegacyMachineConfigFiles(options);

  return normalized;
}

export function updateMachineConfig(
  updater: (current: MachineConfigDocument) => MachineConfigDocument,
  options: MachineConfigOptions = {},
): MachineConfigDocument {
  return writeMachineConfig(updater(readMachineConfig(options)), options);
}

export function readMachineConfigSection(
  section: MachineConfigSectionKey,
  options: MachineConfigOptions = {},
): Record<string, unknown> | undefined {
  const sectionOptions = resolveSectionOptions(section, options);
  const legacySingleSection = getLegacySingleSection(sectionOptions);
  if (legacySingleSection) {
    if (legacySingleSection.section !== section) {
      return undefined;
    }

    return normalizeSection(readJsonObjectFile(legacySingleSection.filePath, `legacy ${section} config`));
  }

  return readMachineConfig(sectionOptions)[section];
}

export function updateMachineConfigSection(
  section: MachineConfigSectionKey,
  updater: (current: Record<string, unknown> | undefined, document: MachineConfigDocument) => Record<string, unknown> | undefined,
  options: MachineConfigOptions = {},
): MachineConfigDocument {
  const sectionOptions = resolveSectionOptions(section, options);
  const legacySingleSection = getLegacySingleSection(sectionOptions);
  if (legacySingleSection) {
    if (legacySingleSection.section !== section) {
      return readMachineConfig(sectionOptions);
    }

    const currentSection = normalizeSection(readJsonObjectFile(legacySingleSection.filePath, `legacy ${section} config`));
    const currentDocument = normalizeMachineConfig(currentSection ? { [section]: currentSection } : {});
    const updated = normalizeSection(updater(currentSection, currentDocument));
    const filePath = legacySingleSection.filePath;

    if (updated) {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`);
      return normalizeMachineConfig({ [section]: updated });
    }

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, '{}\n');
    return {};
  }

  return updateMachineConfig((current) => {
    const next = { ...current };
    const updated = normalizeSection(updater(current[section], current));

    if (updated) {
      next[section] = updated;
    } else {
      delete next[section];
    }

    return next;
  }, sectionOptions);
}

export function readMachineInstructionFiles(options: MachineConfigOptions = {}): string[] {
  return [...(readMachineConfig(options).instructionFiles ?? [])];
}

export function writeMachineInstructionFiles(instructionFiles: string[], options: MachineConfigOptions = {}): MachineConfigDocument {
  const normalizedInstructionFiles = [...new Set(instructionFiles.map((value) => value.trim()).filter((value) => value.length > 0))];
  return updateMachineConfig((current) => {
    const next: MachineConfigDocument = { ...current };
    if (normalizedInstructionFiles.length > 0) {
      next.instructionFiles = normalizedInstructionFiles;
    } else {
      delete next.instructionFiles;
    }
    return next;
  }, options);
}

export function readMachineSkillDirs(options: MachineConfigOptions = {}): string[] {
  return [...(readMachineConfig(options).skillDirs ?? [])];
}

export function writeMachineSkillDirs(skillDirs: string[], options: MachineConfigOptions = {}): MachineConfigDocument {
  const normalizedSkillDirs = [...new Set(skillDirs.map((value) => value.trim()).filter((value) => value.length > 0))];
  return updateMachineConfig((current) => {
    const next: MachineConfigDocument = { ...current };
    if (normalizedSkillDirs.length > 0) {
      next.skillDirs = normalizedSkillDirs;
    } else {
      delete next.skillDirs;
    }
    return next;
  }, options);
}

export function readMachineKnowledgeBaseRepoUrl(options: MachineConfigOptions = {}): string {
  return readMachineConfig(options).knowledgeBaseRepoUrl ?? '';
}

export function readMachineKnowledgeBaseBranch(options: MachineConfigOptions = {}): string {
  return readMachineConfig(options).knowledgeBaseBranch ?? DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH;
}

export function readMachineKnowledgeBase(options: MachineConfigOptions = {}): MachineKnowledgeBaseState {
  return {
    repoUrl: readMachineKnowledgeBaseRepoUrl(options),
    branch: readMachineKnowledgeBaseBranch(options),
  };
}

export function writeMachineKnowledgeBase(
  input: {
    repoUrl?: string | null;
    branch?: string | null;
  },
  options: MachineConfigOptions = {},
): MachineConfigDocument {
  const normalizedRepoUrl = typeof input.repoUrl === 'string' ? input.repoUrl.trim() : '';
  const normalizedBranch = typeof input.branch === 'string' ? input.branch.trim() : DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH;

  return updateMachineConfig((current) => {
    const next: MachineConfigDocument = { ...current };
    if (normalizedRepoUrl.length > 0) {
      next.knowledgeBaseRepoUrl = normalizedRepoUrl;
      next.knowledgeBaseBranch = normalizedBranch.length > 0 ? normalizedBranch : DEFAULT_MACHINE_KNOWLEDGE_BASE_BRANCH;
    } else {
      delete next.knowledgeBaseRepoUrl;
      delete next.knowledgeBaseBranch;
    }
    return next;
  }, options);
}

export function finalizeMachineUiConfigState(config: MachineUiConfigState): MachineUiConfigState {
  return config;
}

function normalizeResumeFallbackPrompt(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_RESUME_FALLBACK_PROMPT;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : DEFAULT_RESUME_FALLBACK_PROMPT;
}

export function readMachineUiConfig(options: MachineConfigOptions = {}): MachineUiConfigState {
  const section = readMachineConfigSection('ui', options) ?? {};

  return finalizeMachineUiConfigState({
    resumeFallbackPrompt: normalizeResumeFallbackPrompt(section.resumeFallbackPrompt),
  });
}

export function writeMachineUiConfig(input: WriteMachineUiConfigInput, options: MachineConfigOptions = {}): MachineUiConfigState {
  const currentState = readMachineUiConfig(options);
  const currentSection = readMachineConfigSection('ui', options) ?? {};

  const updated = finalizeMachineUiConfigState({
    resumeFallbackPrompt:
      input.resumeFallbackPrompt === undefined
        ? currentState.resumeFallbackPrompt
        : normalizeResumeFallbackPrompt(input.resumeFallbackPrompt),
  });

  updateMachineConfigSection(
    'ui',
    () => ({
      ...currentSection,
      resumeFallbackPrompt: updated.resumeFallbackPrompt,
    }),
    options,
  );

  return updated;
}
