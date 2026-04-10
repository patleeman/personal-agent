import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_WEB_UI_PORT,
  getStateRoot,
  readMachineWebUiConfig,
  writeMachineWebUiConfig,
  type MachineWebUiConfigState,
  type WriteMachineWebUiConfigInput,
} from '@personal-agent/core';
import {
  getWebUiDeploymentSummary,
  getWebUiServiceStatus,
  installWebUiService,
  resolveWebUiTailscaleUrl,
  restartWebUiService,
  startWebUiService,
  stopWebUiService,
  syncWebUiTailscaleServe,
  uninstallWebUiService,
  type WebUiDeploymentSummary,
} from '@personal-agent/services';
import { filterSystemLogTailLines } from '../shared/systemLogTail.js';

interface LogTail {
  path?: string;
  lines: string[];
}

interface WebUiReleaseSummary {
  distDir: string;
  serverDir: string;
  serverEntryFile: string;
  sourceRepoRoot: string;
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
    activeRelease?: WebUiReleaseSummary;
  };
}

export interface WebUiStateSnapshot {
  warnings: string[];
  service: WebUiServiceSummary;
  log: LogTail;
}

const WEB_REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
const DESKTOP_SHELL_URL = 'personal-agent://app/';
const DESKTOP_WEB_UI_SERVICE_MESSAGE = 'Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.';

function isDesktopRuntime(): boolean {
  return process.env.PERSONAL_AGENT_DESKTOP_RUNTIME === '1';
}

function assertManagedWebUiServiceLifecycleAvailable(): void {
  if (isDesktopRuntime()) {
    throw new Error(DESKTOP_WEB_UI_SERVICE_MESSAGE);
  }
}

export type WebUiConfigState = MachineWebUiConfigState;

export function readWebUiConfig(): WebUiConfigState {
  return readMachineWebUiConfig();
}

export function writeWebUiConfig(input: WriteMachineWebUiConfigInput): WebUiConfigState {
  return writeMachineWebUiConfig(input);
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
    return filterSystemLogTailLines(
      text
        .split(/\r?\n/)
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0),
    ).slice(-maxLines);
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
    activeRelease: summary.activeRelease,
  };
}

function readDesktopWebUiServiceSummary(config: WebUiConfigState): WebUiServiceSummary {
  return {
    platform: 'desktop',
    identifier: 'desktop-app-shell',
    manifestPath: 'desktop app bundle',
    installed: true,
    running: true,
    logFile: join(getStateRoot(), 'desktop', 'logs', 'main.log'),
    repoRoot: WEB_REPO_ROOT,
    port: 0,
    url: DESKTOP_SHELL_URL,
    companionPort: config.companionPort,
    companionUrl: DESKTOP_SHELL_URL,
    tailscaleServe: config.useTailscaleServe,
    tailscaleUrl: undefined,
    resumeFallbackPrompt: config.resumeFallbackPrompt,
    deployment: toDeploymentSummary(getWebUiDeploymentSummary({ repoRoot: WEB_REPO_ROOT, stablePort: DEFAULT_WEB_UI_PORT })),
  };
}

function readWebUiServiceSummary(): WebUiServiceSummary {
  const config = readWebUiConfig();
  const tailscaleUrl = config.useTailscaleServe ? resolveWebUiTailscaleUrl() : undefined;

  if (isDesktopRuntime()) {
    return readDesktopWebUiServiceSummary(config);
  }

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
  } else if (!isDesktopRuntime() && service.installed && !service.running) {
    warnings.push('Web UI service is installed but not running.');
  } else if (!isDesktopRuntime() && !service.installed) {
    warnings.push('Web UI service is not installed. Install it from this page or run `pa ui service install`.');
  }

  if (isDesktopRuntime() && service.tailscaleServe) {
    warnings.push('The packaged desktop shell does not expose the companion or full web UI over Tailnet HTTPS. Run a managed web UI separately if you need remote browser or companion access.');
  } else if (service.tailscaleServe && !service.tailscaleUrl) {
    warnings.push('Tailscale Serve is enabled, but a Tailnet URL could not be resolved from `tailscale status --json`. Ensure Tailscale is running and authenticated on this machine.');
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
  assertManagedWebUiServiceLifecycleAvailable();
  installWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function startWebUiServiceAndReadState(): WebUiStateSnapshot {
  assertManagedWebUiServiceLifecycleAvailable();
  startWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function restartWebUiServiceAndReadState(): WebUiStateSnapshot {
  assertManagedWebUiServiceLifecycleAvailable();
  restartWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function stopWebUiServiceAndReadState(): WebUiStateSnapshot {
  assertManagedWebUiServiceLifecycleAvailable();
  stopWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}

export function uninstallWebUiServiceAndReadState(): WebUiStateSnapshot {
  assertManagedWebUiServiceLifecycleAvailable();
  uninstallWebUiService({ repoRoot: WEB_REPO_ROOT });
  return readWebUiState();
}
