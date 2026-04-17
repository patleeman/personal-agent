import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DesktopAppPreferences, DesktopConfig, DesktopHostRecord, DesktopWorkspaceServerConfig } from '../hosts/types.js';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';

const DEFAULT_WINDOW_STATE = {
  width: 1440,
  height: 960,
};

export const DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT = 8390;

function createDefaultWorkspaceServerConfig(): DesktopWorkspaceServerConfig {
  return {
    enabled: false,
    port: DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT,
    useTailscaleServe: false,
  };
}

function createDefaultDesktopAppPreferences(): DesktopAppPreferences {
  return {
    autoInstallUpdates: false,
    startOnSystemStart: false,
  };
}

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

function normalizeTailnetWorkspaceWebsocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return trimmed;
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return trimmed;
  }

  if (!parsed.hostname.endsWith('.ts.net')) {
    return trimmed;
  }

  const normalizedPath = parsed.pathname.length > 1
    ? parsed.pathname.replace(/\/+$/, '')
    : parsed.pathname;
  if (normalizedPath !== '/codex') {
    return trimmed;
  }

  parsed.pathname = '/codex/codex';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function normalizeHostRecord(host: unknown): DesktopHostRecord | null {
  if (!host || typeof host !== 'object') {
    return null;
  }

  const candidate = host as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
  const kind = candidate.kind;
  if (!id || !label || (kind !== 'local' && kind !== 'ssh' && kind !== 'web')) {
    return null;
  }

  if (kind === 'local') {
    return { id, label, kind: 'local' };
  }

  if (kind === 'ssh') {
    const rawRemotePort = typeof candidate.remotePort === 'number' ? candidate.remotePort : undefined;
    const normalizedRemotePort = rawRemotePort === 3741
      ? DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT
      : rawRemotePort;

    return {
      id,
      label,
      kind: 'ssh',
      sshTarget: typeof candidate.sshTarget === 'string' ? candidate.sshTarget : '',
      workspaceRoot: typeof candidate.workspaceRoot === 'string' ? candidate.workspaceRoot : undefined,
      remoteRepoRoot: typeof candidate.remoteRepoRoot === 'string' ? candidate.remoteRepoRoot : undefined,
      remotePort: normalizedRemotePort,
      autoConnect: candidate.autoConnect === true,
    };
  }

  const websocketUrl = normalizeTailnetWorkspaceWebsocketUrl(typeof candidate.websocketUrl === 'string'
    ? candidate.websocketUrl
    : typeof candidate.baseUrl === 'string'
      ? candidate.baseUrl
      : '');
  return {
    id,
    label,
    kind: 'web',
    websocketUrl,
    workspaceRoot: typeof candidate.workspaceRoot === 'string' ? candidate.workspaceRoot : undefined,
    autoConnect: candidate.autoConnect === true,
  };
}

function normalizeWorkspaceServerConfig(value: unknown): DesktopWorkspaceServerConfig {
  if (!value || typeof value !== 'object') {
    return createDefaultWorkspaceServerConfig();
  }

  const candidate = value as Record<string, unknown>;
  const parsedPort = typeof candidate.port === 'number' && Number.isFinite(candidate.port)
    ? Math.floor(candidate.port)
    : DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT;

  return {
    enabled: candidate.enabled === true,
    port: parsedPort > 0 && parsedPort <= 65535 ? parsedPort : DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT,
    useTailscaleServe: candidate.useTailscaleServe === true,
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

  const input = value as Partial<DesktopConfig>;
  const hosts = Array.isArray(input.hosts)
    ? ensureLocalHost(input.hosts.map((host) => normalizeHostRecord(host)).filter((host): host is DesktopHostRecord => host !== null))
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
    workspaceServer: normalizeWorkspaceServerConfig(input.workspaceServer),
    appPreferences: normalizeDesktopAppPreferences(input.appPreferences),
  };
}

export function createDefaultDesktopConfig(): DesktopConfig {
  return {
    version: 1,
    defaultHostId: 'local',
    openWindowOnLaunch: true,
    windowState: { ...DEFAULT_WINDOW_STATE },
    hosts: [createDefaultLocalHost()],
    workspaceServer: createDefaultWorkspaceServerConfig(),
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
