import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DesktopConfig, DesktopHostRecord } from '../hosts/types.js';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';

const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 960,
};

function createDefaultLocalHost(): DesktopHostRecord {
  return {
    id: 'local',
    label: 'Local',
    kind: 'local',
  };
}

function ensureLocalHost(hosts: DesktopHostRecord[]): DesktopHostRecord[] {
  const nextHosts = hosts.filter((host) => host.id !== 'local');
  return [createDefaultLocalHost(), ...nextHosts];
}

function normalizeDesktopConfig(value: unknown): DesktopConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultDesktopConfig();
  }

  const input = value as Partial<DesktopConfig>;
  const hosts = Array.isArray(input.hosts)
    ? ensureLocalHost(input.hosts.filter((host): host is DesktopHostRecord => Boolean(host && typeof host === 'object' && typeof (host as { id?: unknown }).id === 'string')))
    : [createDefaultLocalHost()];

  const defaultHostId = typeof input.defaultHostId === 'string' && hosts.some((host) => host.id === input.defaultHostId)
    ? input.defaultHostId
    : 'local';

  return {
    version: 1,
    defaultHostId,
    openWindowOnLaunch: input.openWindowOnLaunch !== false,
    windowState: input.windowState && typeof input.windowState === 'object'
      ? {
          x: typeof input.windowState.x === 'number' ? input.windowState.x : undefined,
          y: typeof input.windowState.y === 'number' ? input.windowState.y : undefined,
          width: typeof input.windowState.width === 'number' ? input.windowState.width : DEFAULT_WINDOW_STATE.width,
          height: typeof input.windowState.height === 'number' ? input.windowState.height : DEFAULT_WINDOW_STATE.height,
        }
      : { ...DEFAULT_WINDOW_STATE },
    hosts,
  };
}

export function createDefaultDesktopConfig(): DesktopConfig {
  return {
    version: 1,
    defaultHostId: 'local',
    openWindowOnLaunch: true,
    windowState: { ...DEFAULT_WINDOW_STATE },
    hosts: [createDefaultLocalHost()],
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

export function updateDesktopWindowState(windowState: NonNullable<DesktopConfig['windowState']>): DesktopConfig {
  const current = loadDesktopConfig();
  const next: DesktopConfig = {
    ...current,
    windowState,
  };
  saveDesktopConfig(next);
  return next;
}
