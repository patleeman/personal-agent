import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getConfigRoot } from '@personal-agent/core';
import {
  findBadWebUiRelease,
  getWebUiServiceStatus,
  installWebUiService,
  listBadWebUiReleases,
  markWebUiReleaseBad,
  resolveWebUiTailscaleUrl,
  restartWebUiService,
  rollbackWebUiDeployment,
  startWebUiService,
  stopWebUiService,
  syncWebUiTailscaleServe,
  uninstallWebUiService,
  type WebUiBadReleaseSummary,
  type WebUiDeploymentSummary,
} from '@personal-agent/gateway';

interface GatewayLogTail {
  path?: string;
  lines: string[];
}

interface WebUiReleaseSummary {
  slot: 'blue' | 'green';
  slotDir: string;
  distDir: string;
  serverDir: string;
  serverEntryFile: string;
  sourceRepoRoot: string;
  builtAt: string;
  revision?: string;
}

interface WebUiServiceSummary {
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  error?: string;
  repoRoot: string;
  port: number;
  url: string;
  companionPort: number;
  companionUrl: string;
  tailscaleServe: boolean;
  tailscaleUrl?: string;
  resumeFallbackPrompt: string;
  deployment?: {
    stablePort: number;
    activeSlot?: 'blue' | 'green';
    activeRelease?: WebUiReleaseSummary;
    inactiveRelease?: WebUiReleaseSummary;
    activeReleaseBad?: WebUiBadReleaseSummary;
    inactiveReleaseBad?: WebUiBadReleaseSummary;
    badReleases: WebUiBadReleaseSummary[];
  };
}

export interface WebUiStateSnapshot {
  warnings: string[];
  service: WebUiServiceSummary;
  log: GatewayLogTail;
}

const WEB_REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();

interface WebUiConfig {
  port?: unknown;
  companionPort?: unknown;
  useTailscaleServe?: unknown;
  resumeFallbackPrompt?: unknown;
}

interface WebUiConfigState {
  port: number;
  companionPort: number;
  useTailscaleServe: boolean;
  resumeFallbackPrompt: string;
}

const DEFAULT_WEB_UI_PORT = 3741;
const DEFAULT_WEB_UI_COMPANION_PORT = 3742;
const DEFAULT_RESUME_FALLBACK_PROMPT = 'Continue from where you left off.';

function normalizeWebUiConfigPort(value: unknown, fallback = DEFAULT_WEB_UI_PORT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  return parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function normalizeWebUiCompanionPort(value: unknown, fallback = DEFAULT_WEB_UI_COMPANION_PORT): number {
  return normalizeWebUiConfigPort(value, fallback);
}

function finalizeWebUiConfigState(config: WebUiConfigState): WebUiConfigState {
  if (config.companionPort !== config.port) {
    return config;
  }

  return {
    ...config,
    companionPort: config.port === DEFAULT_WEB_UI_COMPANION_PORT ? DEFAULT_WEB_UI_COMPANION_PORT + 1 : config.port + 1,
  };
}

function parseWebUiConfigPort(value: string | undefined): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined;
}

function parseWebUiConfigBool(value: unknown): boolean | undefined {
  if (value === true || value === 'true') {
    return true;
  }

  if (value === false || value === 'false') {
    return false;
  }

  return undefined;
}

function normalizeResumeFallbackPrompt(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_RESUME_FALLBACK_PROMPT;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : DEFAULT_RESUME_FALLBACK_PROMPT;
}

export function resolveWebUiConfigFilePath(): string {
  const explicit = process.env.PERSONAL_AGENT_WEB_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(explicit);
  }

  return join(getConfigRoot(), 'web.json');
}

export function readWebUiConfig(): WebUiConfigState {
  const filePath = resolveWebUiConfigFilePath();
  const fromEnv = parseWebUiConfigBool(process.env.PERSONAL_AGENT_WEB_TAILSCALE_SERVE);
  const companionPortFromEnv = parseWebUiConfigPort(process.env.PA_WEB_COMPANION_PORT);

  if (!existsSync(filePath)) {
    return finalizeWebUiConfigState({
      port: DEFAULT_WEB_UI_PORT,
      companionPort: companionPortFromEnv ?? DEFAULT_WEB_UI_COMPANION_PORT,
      useTailscaleServe: fromEnv ?? false,
      resumeFallbackPrompt: DEFAULT_RESUME_FALLBACK_PROMPT,
    });
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as WebUiConfig;
    return finalizeWebUiConfigState({
      port: normalizeWebUiConfigPort(parsed.port),
      companionPort: companionPortFromEnv ?? normalizeWebUiCompanionPort(parsed.companionPort),
      useTailscaleServe: fromEnv ?? parseWebUiConfigBool(parsed.useTailscaleServe) ?? false,
      resumeFallbackPrompt: normalizeResumeFallbackPrompt(parsed.resumeFallbackPrompt),
    });
  } catch {
    return finalizeWebUiConfigState({
      port: DEFAULT_WEB_UI_PORT,
      companionPort: companionPortFromEnv ?? DEFAULT_WEB_UI_COMPANION_PORT,
      useTailscaleServe: fromEnv ?? false,
      resumeFallbackPrompt: DEFAULT_RESUME_FALLBACK_PROMPT,
    });
  }
}

export function writeWebUiConfig(input: {
  companionPort?: number;
  useTailscaleServe?: boolean;
  resumeFallbackPrompt?: string;
}): WebUiConfigState {
  const filePath = resolveWebUiConfigFilePath();
  const raw = readWebUiConfig();
  const updated = finalizeWebUiConfigState({
    ...raw,
    companionPort: input.companionPort === undefined
      ? raw.companionPort
      : normalizeWebUiCompanionPort(input.companionPort, raw.companionPort),
    useTailscaleServe: input.useTailscaleServe === undefined ? raw.useTailscaleServe : input.useTailscaleServe,
    resumeFallbackPrompt: input.resumeFallbackPrompt === undefined
      ? raw.resumeFallbackPrompt
      : normalizeResumeFallbackPrompt(input.resumeFallbackPrompt),
  });

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf-8');

  return updated;
}

export function syncConfiguredWebUiTailscaleServe(enabled: boolean): void {
  const config = readWebUiConfig();
  syncWebUiTailscaleServe({
    enabled,
    port: config.port,
    companionPort: config.companionPort,
  });
}

function readTailLines(filePath: string | undefined, maxLines = 160, maxBytes = 192 * 1024): string[] {
  if (!filePath || !existsSync(filePath)) {
    return [];
  }

  let fd: number | undefined;

  try {
    const stats = statSync(filePath);
    const readLength = Math.min(maxBytes, stats.size);
    if (readLength <= 0) {
      return [];
    }

    const buffer = Buffer.alloc(readLength);
    fd = openSync(filePath, 'r');
    readSync(fd, buffer, 0, readLength, stats.size - readLength);

    const text = buffer.toString('utf-8');
    return text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .slice(-maxLines);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}

function toDeploymentSummary(summary: WebUiDeploymentSummary | undefined): WebUiServiceSummary['deployment'] | undefined {
  if (!summary) {
    return undefined;
  }

  return {
    stablePort: summary.stablePort,
    activeSlot: summary.activeSlot,
    activeRelease: summary.activeRelease,
    inactiveRelease: summary.inactiveRelease,
    activeReleaseBad: findBadWebUiRelease({ release: summary.activeRelease, stablePort: summary.stablePort }),
    inactiveReleaseBad: findBadWebUiRelease({ release: summary.inactiveRelease, stablePort: summary.stablePort }),
    badReleases: listBadWebUiReleases({ stablePort: summary.stablePort }),
  };
}

function readWebUiServiceSummary(): WebUiServiceSummary {
  const config = readWebUiConfig();
  const tailscaleUrl = config.useTailscaleServe ? resolveWebUiTailscaleUrl() : undefined;

  try {
    const status = getWebUiServiceStatus({ repoRoot: WEB_REPO_ROOT });
    return {
      platform: status.platform,
      identifier: status.identifier,
      manifestPath: status.manifestPath,
      installed: status.installed,
      running: status.running,
      logFile: status.logFile,
      repoRoot: status.repoRoot,
      port: status.port,
      url: status.url,
      companionPort: config.companionPort,
      companionUrl: `http://127.0.0.1:${config.companionPort}`,
      tailscaleServe: config.useTailscaleServe,
      tailscaleUrl,
      resumeFallbackPrompt: config.resumeFallbackPrompt,
      deployment: toDeploymentSummary(status.deployment),
    };
  } catch (error) {
    return {
      platform: process.platform,
      identifier: 'personal-agent-web-ui',
      manifestPath: '',
      installed: false,
      running: false,
      repoRoot: process.cwd(),
      port: DEFAULT_WEB_UI_PORT,
      url: `http://127.0.0.1:${DEFAULT_WEB_UI_PORT}`,
      companionPort: config.companionPort,
      companionUrl: `http://127.0.0.1:${config.companionPort}`,
      tailscaleServe: config.useTailscaleServe,
      tailscaleUrl,
      resumeFallbackPrompt: config.resumeFallbackPrompt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function readWebUiState(): WebUiStateSnapshot {
  const service = readWebUiServiceSummary();
  const warnings: string[] = [];

  if (service.error) {
    warnings.push(`Could not inspect web UI service status: ${service.error}`);
  } else if (service.installed && !service.running) {
    warnings.push('Web UI service is installed but not running.');
  } else if (!service.installed) {
    warnings.push('Web UI service is not installed. Install it from this page or run `pa ui service install`.');
  }

  if (service.installed && !service.deployment?.activeRelease) {
    warnings.push('No active blue/green web UI release is staged yet. Reinstall the web UI service to materialize one.');
  }

  if (service.tailscaleServe && !service.tailscaleUrl) {
    warnings.push('Tailscale Serve is enabled, but a Tailnet URL could not be resolved from `tailscale status --json`. Ensure Tailscale is running and authenticated on this machine.');
  }

  if (service.deployment?.activeReleaseBad) {
    warnings.push(
      `Active web UI release ${service.deployment.activeReleaseBad.revision} is marked bad.${service.deployment.activeReleaseBad.reason ? ` Reason: ${service.deployment.activeReleaseBad.reason}` : ''}`,
    );
  }

  return {
    warnings,
    service,
    log: {
      path: service.logFile,
      lines: readTailLines(service.logFile),
    },
  };
}

export function installWebUiServiceAndReadState(): WebUiStateSnapshot {
  installWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function startWebUiServiceAndReadState(): WebUiStateSnapshot {
  startWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function restartWebUiServiceAndReadState(): WebUiStateSnapshot {
  restartWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function rollbackWebUiServiceAndReadState(input: { reason?: string } = {}): WebUiStateSnapshot {
  const service = getWebUiServiceStatus({ repoRoot: WEB_REPO_ROOT });
  if (!service.installed) {
    throw new Error('Managed web UI service is not installed. Install it before rolling back.');
  }

  rollbackWebUiDeployment({
    stablePort: service.port,
    reason: input.reason,
  });
  installWebUiService({ repoRoot: WEB_REPO_ROOT, port: service.port });
  return readWebUiState();
}

export function markBadWebUiReleaseAndReadState(input: { slot?: 'blue' | 'green'; reason?: string } = {}): WebUiStateSnapshot {
  const service = getWebUiServiceStatus({ repoRoot: WEB_REPO_ROOT });
  markWebUiReleaseBad({
    slot: input.slot,
    stablePort: service.port,
    reason: input.reason,
  });
  return readWebUiState();
}

export function stopWebUiServiceAndReadState(): WebUiStateSnapshot {
  stopWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function uninstallWebUiServiceAndReadState(): WebUiStateSnapshot {
  uninstallWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}
