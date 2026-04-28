import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DesktopAppPreferences, DesktopConfig, DesktopHostRecord } from '../hosts/types.js';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';

const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 960,
};

function createDefaultDesktopAppPreferences(): DesktopAppPreferences {
  return {
    autoInstallUpdates: false,
    startOnSystemStart: false,
  };
}

function readSafeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function readPositiveSafeNumber(value: unknown): number | undefined {
  const number = readSafeNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function normalizeSshHostRecord(host: unknown): Extract<DesktopHostRecord, { kind: 'ssh' }> | null {
  if (!host || typeof host !== 'object') {
    return null;
  }

  const candidate = host as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  if (!id || !label) {
    return null;
  }

  const kind = candidate.kind;
  if (kind !== 'ssh') {
    return null;
  }

  const sshTarget = typeof candidate.sshTarget === 'string' ? candidate.sshTarget.trim() : '';
  if (!sshTarget) {
    return null;
  }

  return {
    id,
    label,
    kind: 'ssh',
    sshTarget,
  };
}

function normalizeDesktopAppPreferences(value: unknown): DesktopAppPreferences {
  if (!value || typeof value !== 'object') {
    return createDefaultDesktopAppPreferences();
  }

  const candidate = value as Record<string, unknown>;
  return {
    autoInstallUpdates: candidate.autoInstallUpdates === true,
    startOnSystemStart: candidate.startOnSystemStart === true,
  };
}

function normalizeDesktopConfig(value: unknown): DesktopConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultDesktopConfig();
  }

  const input = value as Partial<DesktopConfig> & {
    hosts?: unknown[];
    appPreferences?: unknown;
    windowState?: Record<string, unknown>;
    openWindowOnLaunch?: boolean;
  };

  const hosts = Array.isArray(input.hosts)
    ? input.hosts
      .map((host) => normalizeSshHostRecord(host))
      .filter((host): host is Extract<DesktopHostRecord, { kind: 'ssh' }> => host !== null)
    : [];

  return {
    version: 2,
    openWindowOnLaunch: input.openWindowOnLaunch !== false,
    windowState: input.windowState && typeof input.windowState === 'object'
      ? {
          x: readSafeNumber(input.windowState.x),
          y: readSafeNumber(input.windowState.y),
          width: readPositiveSafeNumber(input.windowState.width) ?? DEFAULT_WINDOW_STATE.width,
          height: readPositiveSafeNumber(input.windowState.height) ?? DEFAULT_WINDOW_STATE.height,
        }
      : { ...DEFAULT_WINDOW_STATE },
    hosts,
    appPreferences: normalizeDesktopAppPreferences(input.appPreferences),
  };
}

export function createDefaultDesktopConfig(): DesktopConfig {
  return {
    version: 2,
    openWindowOnLaunch: true,
    windowState: { ...DEFAULT_WINDOW_STATE },
    hosts: [],
    appPreferences: createDefaultDesktopAppPreferences(),
  };
}

export function loadDesktopConfig(): DesktopConfig {
  const { desktopConfigFile, desktopStateDir } = resolveDesktopRuntimePaths();
  mkdirSync(desktopStateDir, { recursive: true, mode: 0o700 });

  if (!existsSync(desktopConfigFile)) {
    const config = createDefaultDesktopConfig();
    saveDesktopConfig(config);
    return config;
  }

  try {
    const parsed = JSON.parse(readFileSync(desktopConfigFile, 'utf-8')) as unknown;
    const config = normalizeDesktopConfig(parsed);
    saveDesktopConfig(config);
    return config;
  } catch {
    const config = createDefaultDesktopConfig();
    saveDesktopConfig(config);
    return config;
  }
}

export function saveDesktopConfig(config: DesktopConfig): void {
  const { desktopConfigFile, desktopStateDir } = resolveDesktopRuntimePaths();
  mkdirSync(desktopStateDir, { recursive: true, mode: 0o700 });
  writeFileSync(desktopConfigFile, `${JSON.stringify(normalizeDesktopConfig(config), null, 2)}\n`, 'utf-8');
}

export function readDesktopAppPreferences(config = loadDesktopConfig()): DesktopAppPreferences {
  return normalizeDesktopAppPreferences(config.appPreferences);
}

export function updateDesktopAppPreferences(appPreferences: Partial<DesktopAppPreferences>): DesktopConfig {
  const current = loadDesktopConfig();
  const next: DesktopConfig = {
    ...current,
    appPreferences: {
      ...readDesktopAppPreferences(current),
      ...(appPreferences.autoInstallUpdates !== undefined ? { autoInstallUpdates: appPreferences.autoInstallUpdates } : {}),
      ...(appPreferences.startOnSystemStart !== undefined ? { startOnSystemStart: appPreferences.startOnSystemStart } : {}),
    },
  };
  saveDesktopConfig(next);
  return next;
}

export function updateDesktopWindowState(windowState: NonNullable<DesktopConfig['windowState']>): DesktopConfig {
  const current = loadDesktopConfig();
  const next: DesktopConfig = {
    ...current,
    windowState,
  };
  saveDesktopConfig(next);
  return next;
}
