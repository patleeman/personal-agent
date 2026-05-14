import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { getDefaultStateRoot, getPiAgentRuntimeDir } from '@personal-agent/core';

import { resolveDesktopLaunchPresentation } from './launch-mode.js';

function resolveDefaultStateRootForEnv(env: NodeJS.ProcessEnv): string {
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  return xdgStateHome ? join(xdgStateHome, 'personal-agent') : getDefaultStateRoot();
}

function resolveVariantStateRoot(defaultStateRoot: string, variant: 'rc' | 'testing'): string {
  return join(dirname(defaultStateRoot), `${basename(defaultStateRoot)}-${variant}`);
}

interface DesktopRuntimeEnvironmentOptions {
  defaultStateRoot?: string;
  version?: string;
  packaged?: boolean;
}

export function resolveDesktopRuntimeEnvironmentOverrides(
  env: NodeJS.ProcessEnv = process.env,
  options: DesktopRuntimeEnvironmentOptions = {},
): {
  stateRoot?: string;
} {
  const launchPresentation = resolveDesktopLaunchPresentation(env, options);

  if (launchPresentation.mode !== 'rc' && launchPresentation.mode !== 'testing') {
    return {};
  }

  return {
    ...(env.PERSONAL_AGENT_STATE_ROOT?.trim()
      ? {}
      : { stateRoot: resolveVariantStateRoot(options.defaultStateRoot ?? resolveDefaultStateRootForEnv(env), launchPresentation.mode) }),
  };
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isEmptyJsonRecord(filePath: string): boolean {
  const record = readJsonRecord(filePath);
  return !record || Object.keys(record).length === 0;
}

function seedTestingAgentRuntimeFile(sourceFile: string, targetFile: string, options: { overwrite?: boolean } = {}): void {
  if (!existsSync(sourceFile)) {
    return;
  }

  if (!options.overwrite && existsSync(targetFile) && !isEmptyJsonRecord(targetFile)) {
    return;
  }

  mkdirSync(dirname(targetFile), { recursive: true });
  copyFileSync(sourceFile, targetFile);
}

function seedTestingAuthFile(sourceFile: string, targetFile: string): void {
  const stableAuth = readJsonRecord(sourceFile);
  if (!stableAuth) {
    return;
  }

  const testingAuth = readJsonRecord(targetFile) ?? {};
  mkdirSync(dirname(targetFile), { recursive: true });
  writeJsonRecord(targetFile, { ...testingAuth, ...stableAuth });
}

function writeJsonRecord(filePath: string, record: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`);
}

export function seedTestingRuntimeState(env: NodeJS.ProcessEnv = process.env, options: DesktopRuntimeEnvironmentOptions = {}): void {
  const launchPresentation = resolveDesktopLaunchPresentation(env, options);
  if (launchPresentation.mode !== 'rc' && launchPresentation.mode !== 'testing') {
    return;
  }

  const variantStateRoot = env.PERSONAL_AGENT_STATE_ROOT?.trim();
  if (!variantStateRoot) {
    return;
  }

  const stableAgentDir = getPiAgentRuntimeDir(resolveDefaultStateRootForEnv(env));
  const variantAgentDir = getPiAgentRuntimeDir(variantStateRoot);
  if (stableAgentDir === variantAgentDir) {
    return;
  }

  seedTestingAuthFile(join(stableAgentDir, 'auth.json'), join(variantAgentDir, 'auth.json'));
  seedTestingAgentRuntimeFile(join(stableAgentDir, 'models.json'), join(variantAgentDir, 'models.json'));
}

export function applyDesktopRuntimeEnvironmentOverrides(
  env: NodeJS.ProcessEnv = process.env,
  options: DesktopRuntimeEnvironmentOptions = {},
): void {
  const overrides = resolveDesktopRuntimeEnvironmentOverrides(env, options);

  if (overrides.stateRoot) {
    env.PERSONAL_AGENT_STATE_ROOT = overrides.stateRoot;
  }

  // Use separate codex ports for packaged variants to avoid conflicts between
  // stable, testing, and RC companion-protocol servers.
  const launchMode = resolveDesktopLaunchPresentation(env, options).mode;
  if (!env.CODEX_PORT && launchMode === 'testing') {
    env.CODEX_PORT = '3846';
  }
  if (!env.CODEX_PORT && launchMode === 'rc') {
    env.CODEX_PORT = '3847';
  }

  seedTestingRuntimeState(env, options);
}
