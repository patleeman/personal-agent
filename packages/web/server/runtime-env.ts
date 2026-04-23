import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { getDefaultStateRoot, getPiAgentRuntimeDir } from '@personal-agent/core';

export const DEFAULT_WEB_RUNTIME_PORT = 3741;

function resolveDefaultStateRootForEnv(env: NodeJS.ProcessEnv): string {
  const xdgStateHome = env.XDG_STATE_HOME?.trim();
  return xdgStateHome ? join(xdgStateHome, 'personal-agent') : getDefaultStateRoot();
}

function parseWebPort(value: string | undefined, fallback = DEFAULT_WEB_RUNTIME_PORT): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveTestingStateRoot(defaultStateRoot: string, port: number): string {
  return join(dirname(defaultStateRoot), `${basename(defaultStateRoot)}-testing`, `web-${port}`);
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

function seedTestingAgentRuntimeFile(sourceFile: string, targetFile: string): void {
  if (!existsSync(sourceFile)) {
    return;
  }

  if (existsSync(targetFile) && !isEmptyJsonRecord(targetFile)) {
    return;
  }

  mkdirSync(dirname(targetFile), { recursive: true });
  copyFileSync(sourceFile, targetFile);
}

export function resolveWebRuntimeEnvironmentOverrides(
  env: NodeJS.ProcessEnv = process.env,
  options: { defaultStateRoot?: string; defaultPort?: number } = {},
): { stateRoot?: string } {
  const rawVariant = env.PERSONAL_AGENT_WEB_VARIANT?.trim().toLowerCase();
  if (rawVariant === 'stable' || rawVariant === 'production') {
    return {};
  }

  const defaultPort = options.defaultPort ?? DEFAULT_WEB_RUNTIME_PORT;
  const port = parseWebPort(env.PA_WEB_PORT, defaultPort);
  const testingVariant = rawVariant === 'testing' || port !== defaultPort;
  if (!testingVariant) {
    return {};
  }

  if (env.PERSONAL_AGENT_STATE_ROOT?.trim() || env.PERSONAL_AGENT_CONFIG_ROOT?.trim() || env.PERSONAL_AGENT_CONFIG_FILE?.trim()) {
    return {};
  }

  return {
    stateRoot: resolveTestingStateRoot(options.defaultStateRoot ?? resolveDefaultStateRootForEnv(env), port),
  };
}

export function seedTestingRuntimeState(env: NodeJS.ProcessEnv = process.env): void {
  const overrides = resolveWebRuntimeEnvironmentOverrides(env);
  const testingStateRoot = env.PERSONAL_AGENT_STATE_ROOT?.trim() || overrides.stateRoot;
  if (!testingStateRoot) {
    return;
  }

  const stableAgentDir = getPiAgentRuntimeDir(resolveDefaultStateRootForEnv(env));
  const testingAgentDir = getPiAgentRuntimeDir(testingStateRoot);
  if (stableAgentDir === testingAgentDir) {
    return;
  }

  seedTestingAgentRuntimeFile(join(stableAgentDir, 'auth.json'), join(testingAgentDir, 'auth.json'));
  seedTestingAgentRuntimeFile(join(stableAgentDir, 'models.json'), join(testingAgentDir, 'models.json'));
}

export function applyWebRuntimeEnvironmentOverrides(env: NodeJS.ProcessEnv = process.env): void {
  const overrides = resolveWebRuntimeEnvironmentOverrides(env);
  if (overrides.stateRoot) {
    env.PERSONAL_AGENT_STATE_ROOT = overrides.stateRoot;
  }

  seedTestingRuntimeState(env);
}
