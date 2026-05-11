import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import type { DesktopAppPreferences, DesktopConfig } from '../hosts/types.js';
import { normalizeDesktopKeyboardShortcuts, validateDesktopKeyboardShortcuts } from '../keyboard-shortcuts.js';

const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 960,
};

function createDefaultDesktopAppPreferences(): DesktopAppPreferences {
  return {
    autoInstallUpdates: false,
    startOnSystemStart: false,
    keyboardShortcuts: normalizeDesktopKeyboardShortcuts(null),
  };
}

function readSafeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function readPositiveSafeNumber(value: unknown): number | undefined {
  const number = readSafeNumber(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function normalizeDesktopAppPreferences(value: unknown): DesktopAppPreferences {
  if (!value || typeof value !== 'object') {
    return createDefaultDesktopAppPreferences();
  }

  const candidate = value as Record<string, unknown>;
  return {
    autoInstallUpdates: candidate.autoInstallUpdates === true,
    startOnSystemStart: candidate.startOnSystemStart === true,
    keyboardShortcuts: normalizeDesktopKeyboardShortcuts(candidate.keyboardShortcuts),
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

  return {
    version: 2,
    openWindowOnLaunch: input.openWindowOnLaunch !== false,
    windowState:
      input.windowState && typeof input.windowState === 'object'
        ? {
            x: readSafeNumber(input.windowState.x),
            y: readSafeNumber(input.windowState.y),
            width: readPositiveSafeNumber(input.windowState.width) ?? DEFAULT_WINDOW_STATE.width,
            height: readPositiveSafeNumber(input.windowState.height) ?? DEFAULT_WINDOW_STATE.height,
          }
        : { ...DEFAULT_WINDOW_STATE },
    appPreferences: normalizeDesktopAppPreferences(input.appPreferences),
  };
}

function createDefaultDesktopConfig(): DesktopConfig {
  return {
    version: 2,
    openWindowOnLaunch: true,
    windowState: { ...DEFAULT_WINDOW_STATE },
    appPreferences: createDefaultDesktopAppPreferences(),
  };
}

let cachedDesktopConfig: { file: string; mtimeMs: number; config: DesktopConfig } | null = null;

function cacheDesktopConfig(file: string, config: DesktopConfig): DesktopConfig {
  const mtimeMs = existsSync(file) ? statSync(file).mtimeMs : -1;
  cachedDesktopConfig = { file, mtimeMs, config };
  return config;
}

export function loadDesktopConfig(): DesktopConfig {
  const { desktopConfigFile, desktopStateDir } = resolveDesktopRuntimePaths();
  mkdirSync(desktopStateDir, { recursive: true, mode: 0o700 });

  if (existsSync(desktopConfigFile)) {
    const mtimeMs = statSync(desktopConfigFile).mtimeMs;
    if (cachedDesktopConfig?.file === desktopConfigFile && cachedDesktopConfig.mtimeMs === mtimeMs) {
      return cachedDesktopConfig.config;
    }
  }

  if (!existsSync(desktopConfigFile)) {
    const config = createDefaultDesktopConfig();
    saveDesktopConfig(config);
    return config;
  }

  try {
    const parsed = JSON.parse(readFileSync(desktopConfigFile, 'utf-8')) as unknown;
    return cacheDesktopConfig(desktopConfigFile, normalizeDesktopConfig(parsed));
  } catch {
    const config = createDefaultDesktopConfig();
    saveDesktopConfig(config);
    return config;
  }
}

export function saveDesktopConfig(config: DesktopConfig): void {
  const { desktopConfigFile, desktopStateDir } = resolveDesktopRuntimePaths();
  mkdirSync(desktopStateDir, { recursive: true, mode: 0o700 });
  const normalized = normalizeDesktopConfig(config);
  writeFileSync(desktopConfigFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf-8');
  cacheDesktopConfig(desktopConfigFile, normalized);
}

export function readDesktopAppPreferences(config = loadDesktopConfig()): DesktopAppPreferences {
  return normalizeDesktopAppPreferences(config.appPreferences);
}

export function updateDesktopAppPreferences(
  appPreferences: Partial<Omit<DesktopAppPreferences, 'keyboardShortcuts'>> & {
    keyboardShortcuts?: Partial<DesktopAppPreferences['keyboardShortcuts']>;
  },
): DesktopConfig {
  const current = loadDesktopConfig();
  const next: DesktopConfig = {
    ...current,
    appPreferences: {
      ...readDesktopAppPreferences(current),
      ...(appPreferences.autoInstallUpdates !== undefined ? { autoInstallUpdates: appPreferences.autoInstallUpdates } : {}),
      ...(appPreferences.startOnSystemStart !== undefined ? { startOnSystemStart: appPreferences.startOnSystemStart } : {}),
      ...(appPreferences.keyboardShortcuts !== undefined
        ? {
            keyboardShortcuts: validateDesktopKeyboardShortcuts({
              ...readDesktopAppPreferences(current).keyboardShortcuts,
              ...appPreferences.keyboardShortcuts,
            }),
          }
        : {}),
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
