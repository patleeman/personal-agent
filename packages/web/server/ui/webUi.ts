import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  getStateRoot,
  readMachineWebUiConfig,
  writeMachineWebUiConfig,
  type MachineWebUiConfigState,
  type WriteMachineWebUiConfigInput,
} from '@personal-agent/core';
import { filterSystemLogTailLines } from '../shared/systemLogTail.js';

interface LogTail {
  path?: string;
  lines: string[];
}

interface DesktopUiServiceSummary {
  platform: string;
  identifier: string;
  manifestPath: string;
  installed: boolean;
  running: boolean;
  logFile?: string;
  repoRoot: string;
  port: number;
  url: string;
  tailscaleServe: boolean;
  tailscaleUrl?: string;
  resumeFallbackPrompt: string;
}

export interface WebUiStateSnapshot {
  warnings: string[];
  service: DesktopUiServiceSummary;
  log: LogTail;
}

const WEB_REPO_ROOT = process.env.PERSONAL_AGENT_REPO_ROOT ?? process.cwd();
const DESKTOP_SHELL_URL = 'personal-agent://app/';
const REMOVED_STANDALONE_WEB_UI_MESSAGE = 'The standalone web UI service has been removed. Use the Personal Agent desktop app.';

export type WebUiConfigState = MachineWebUiConfigState;

export function readWebUiConfig(): WebUiConfigState {
  return readMachineWebUiConfig();
}

export function writeWebUiConfig(input: WriteMachineWebUiConfigInput): WebUiConfigState {
  return writeMachineWebUiConfig(input);
}

export function syncConfiguredWebUiTailscaleServe(_enabled: boolean): void {
  throw new Error(REMOVED_STANDALONE_WEB_UI_MESSAGE);
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

function readDesktopUiServiceSummary(config: WebUiConfigState): DesktopUiServiceSummary {
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
    tailscaleServe: false,
    tailscaleUrl: undefined,
    resumeFallbackPrompt: config.resumeFallbackPrompt,
  };
}

export function readWebUiState(): WebUiStateSnapshot {
  const service = readDesktopUiServiceSummary(readWebUiConfig());

  return {
    warnings: [],
    service,
    log: {
      path: service.logFile,
      lines: readTailLines(service.logFile),
    },
  };
}

export function installWebUiServiceAndReadState(): WebUiStateSnapshot {
  throw new Error(REMOVED_STANDALONE_WEB_UI_MESSAGE);
}

export function startWebUiServiceAndReadState(): WebUiStateSnapshot {
  throw new Error(REMOVED_STANDALONE_WEB_UI_MESSAGE);
}

export function restartWebUiServiceAndReadState(): WebUiStateSnapshot {
  throw new Error(REMOVED_STANDALONE_WEB_UI_MESSAGE);
}

export function stopWebUiServiceAndReadState(): WebUiStateSnapshot {
  throw new Error(REMOVED_STANDALONE_WEB_UI_MESSAGE);
}

export function uninstallWebUiServiceAndReadState(): WebUiStateSnapshot {
  throw new Error(REMOVED_STANDALONE_WEB_UI_MESSAGE);
}
