import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { getDefaultStateRoot, getPiAgentRuntimeDir } from '@personal-agent/core';

import { resolveDesktopLaunchPresentation } from './launch-mode.js';

export const TESTING_DESKTOP_COMPANION_PORT = 3844;

function resolveDefaultStateRootForEnv(env: NodeJS.ProcessEnv): string {
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  return xdgStateHome ? join(xdgStateHome, 'personal-agent') : getDefaultStateRoot();
}

function resolveTestingStateRoot(defaultStateRoot: string): string {
  return join(dirname(defaultStateRoot), `${basename(defaultStateRoot)}-testing`);
}

export function resolveDesktopRuntimeEnvironmentOverrides(
  env: NodeJS.ProcessEnv = process.env,
  options: { defaultStateRoot?: string } = {},
): {
  stateRoot?: string;
  companionPort?: string;
} {
  const launchPresentation = resolveDesktopLaunchPresentation(env);

  if (launchPresentation.mode !== 'testing') {
    return {};
  }

  return {
    ...(env.PERSONAL_AGENT_STATE_ROOT?.trim()
      ? {}
      : { stateRoot: resolveTestingStateRoot(options.defaultStateRoot ?? resolveDefaultStateRootForEnv(env)) }),
    ...(env.PERSONAL_AGENT_COMPANION_PORT?.trim() ? {} : { companionPort: String(TESTING_DESKTOP_COMPANION_PORT) }),
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

export function seedTestingRuntimeState(env: NodeJS.ProcessEnv = process.env): void {
  if (resolveDesktopLaunchPresentation(env).mode !== 'testing') {
    return;
  }

  const testingStateRoot = env.PERSONAL_AGENT_STATE_ROOT?.trim();
  if (!testingStateRoot) {
    return;
  }

  const stableAgentDir = getPiAgentRuntimeDir(resolveDefaultStateRootForEnv(env));
  const testingAgentDir = getPiAgentRuntimeDir(testingStateRoot);
  if (stableAgentDir === testingAgentDir) {
    return;
  }

  seedTestingAgentRuntimeFile(join(stableAgentDir, 'auth.json'), join(testingAgentDir, 'auth.json'), { overwrite: true });
  seedTestingAgentRuntimeFile(join(stableAgentDir, 'models.json'), join(testingAgentDir, 'models.json'));
}

export function applyDesktopRuntimeEnvironmentOverrides(env: NodeJS.ProcessEnv = process.env): void {
  const overrides = resolveDesktopRuntimeEnvironmentOverrides(env);

  if (overrides.stateRoot) {
    env.PERSONAL_AGENT_STATE_ROOT = overrides.stateRoot;
  }

  if (overrides.companionPort) {
    env.PERSONAL_AGENT_COMPANION_PORT = overrides.companionPort;
  }

  seedTestingRuntimeState(env);
}
