import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  getDefaultStateRoot,
  getPiAgentRuntimeDir,
  readPortOverride,
  resolvePersonalAgentRuntimeChannel,
  resolvePersonalAgentRuntimeChannelConfig,
} from '@personal-agent/core';

function resolveDefaultStateRootForEnv(env: NodeJS.ProcessEnv): string {
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  return xdgStateHome ? join(xdgStateHome, 'personal-agent') : getDefaultStateRoot();
}

function resolveVariantStateRoot(defaultStateRoot: string, suffix: string): string {
  return suffix ? join(dirname(defaultStateRoot), `${basename(defaultStateRoot)}${suffix}`) : defaultStateRoot;
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
  const channelConfig = resolvePersonalAgentRuntimeChannelConfig(env, options);

  if (!channelConfig.stateRootSuffix) {
    return {};
  }

  return {
    ...(env.PERSONAL_AGENT_STATE_ROOT?.trim()
      ? {}
      : {
          stateRoot: resolveVariantStateRoot(options.defaultStateRoot ?? resolveDefaultStateRootForEnv(env), channelConfig.stateRootSuffix),
        }),
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
  const channel = resolvePersonalAgentRuntimeChannel(env, options);
  if (channel !== 'rc' && channel !== 'dev' && channel !== 'test') {
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

  const channelConfig = resolvePersonalAgentRuntimeChannelConfig(env, options);
  const codexPort = readPortOverride(env.PERSONAL_AGENT_CODEX_PORT) ?? channelConfig.codexPort;
  const companionPort = readPortOverride(env.PERSONAL_AGENT_COMPANION_PORT) ?? channelConfig.companionPort;
  if (!env.CODEX_PORT && codexPort > 0) {
    env.CODEX_PORT = String(codexPort);
  }
  if (!env.PERSONAL_AGENT_COMPANION_PORT && companionPort >= 0) {
    env.PERSONAL_AGENT_COMPANION_PORT = String(companionPort);
  }
  env.PERSONAL_AGENT_RUNTIME_CHANNEL = channelConfig.channel;

  seedTestingRuntimeState(env, options);
}
