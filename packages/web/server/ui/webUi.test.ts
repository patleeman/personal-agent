import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_WEB_UI_PORT } from '@personal-agent/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  filterSystemLogTailLinesMock,
  getWebUiDeploymentSummaryMock,
  getWebUiServiceStatusMock,
  installWebUiServiceMock,
  resolveWebUiTailscaleUrlMock,
  restartWebUiServiceMock,
  startWebUiServiceMock,
  stopWebUiServiceMock,
  syncWebUiTailscaleServeMock,
  uninstallWebUiServiceMock,
} = vi.hoisted(() => ({
  filterSystemLogTailLinesMock: vi.fn(),
  getWebUiDeploymentSummaryMock: vi.fn(),
  getWebUiServiceStatusMock: vi.fn(),
  installWebUiServiceMock: vi.fn(),
  resolveWebUiTailscaleUrlMock: vi.fn(),
  restartWebUiServiceMock: vi.fn(),
  startWebUiServiceMock: vi.fn(),
  stopWebUiServiceMock: vi.fn(),
  syncWebUiTailscaleServeMock: vi.fn(),
  uninstallWebUiServiceMock: vi.fn(),
}));

vi.mock('@personal-agent/services', () => ({
  getWebUiDeploymentSummary: getWebUiDeploymentSummaryMock,
  getWebUiServiceStatus: getWebUiServiceStatusMock,
  installWebUiService: installWebUiServiceMock,
  resolveWebUiTailscaleUrl: resolveWebUiTailscaleUrlMock,
  restartWebUiService: restartWebUiServiceMock,
  startWebUiService: startWebUiServiceMock,
  stopWebUiService: stopWebUiServiceMock,
  syncWebUiTailscaleServe: syncWebUiTailscaleServeMock,
  uninstallWebUiService: uninstallWebUiServiceMock,
}));

vi.mock('../shared/systemLogTail.js', () => ({
  filterSystemLogTailLines: filterSystemLogTailLinesMock,
}));

import {
  installWebUiServiceAndReadState,
  readWebUiConfig,
  readWebUiState,
  restartWebUiServiceAndReadState,
  startWebUiServiceAndReadState,
  stopWebUiServiceAndReadState,
  syncConfiguredWebUiTailscaleServe,
  uninstallWebUiServiceAndReadState,
  writeWebUiConfig,
} from './webUi.js';

const DEFAULT_RESUME_FALLBACK_PROMPT = 'Continue from where you left off.';
const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function configureTempWebUiConfig(): string {
  const configDir = createTempDir('pa-web-ui-config-');
  process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = join(configDir, 'web.json');
  return configDir;
}

function createStatus(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'darwin',
    identifier: 'personal-agent-web-ui',
    manifestPath: '/Library/LaunchAgents/personal-agent-web-ui.plist',
    installed: true,
    running: true,
    repoRoot: '/repo',
    port: DEFAULT_WEB_UI_PORT,
    url: `http://127.0.0.1:${DEFAULT_WEB_UI_PORT}`,
    ...overrides,
  };
}

describe('web UI config', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PA_WEB_COMPANION_PORT;
    delete process.env.PERSONAL_AGENT_WEB_TAILSCALE_SERVE;

    filterSystemLogTailLinesMock.mockReset();
    getWebUiDeploymentSummaryMock.mockReset();
    getWebUiServiceStatusMock.mockReset();
    installWebUiServiceMock.mockReset();
    resolveWebUiTailscaleUrlMock.mockReset();
    restartWebUiServiceMock.mockReset();
    startWebUiServiceMock.mockReset();
    stopWebUiServiceMock.mockReset();
    syncWebUiTailscaleServeMock.mockReset();
    uninstallWebUiServiceMock.mockReset();

    filterSystemLogTailLinesMock.mockImplementation((lines: string[]) => lines);
    resolveWebUiTailscaleUrlMock.mockReturnValue(undefined);
    getWebUiDeploymentSummaryMock.mockReturnValue(undefined);
    getWebUiServiceStatusMock.mockReturnValue(createStatus());
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('uses the default companion port and resume fallback prompt when no config file exists', () => {
    configureTempWebUiConfig();

    const config = readWebUiConfig();
    expect(config.companionPort).toBe(3742);
    expect(config.resumeFallbackPrompt).toBe(DEFAULT_RESUME_FALLBACK_PROMPT);
  });

  it('persists a custom companion port and resume fallback prompt', () => {
    configureTempWebUiConfig();

    writeWebUiConfig({ companionPort: 4800, resumeFallbackPrompt: '  Pick up from the last successful step.  ' });

    const config = readWebUiConfig();
    expect(config.companionPort).toBe(4800);
    expect(config.resumeFallbackPrompt).toBe('Pick up from the last successful step.');
  });

  it('normalizes blank resume fallback prompts back to default', () => {
    configureTempWebUiConfig();

    writeWebUiConfig({ resumeFallbackPrompt: '' });

    const config = readWebUiConfig();
    expect(config.resumeFallbackPrompt).toBe(DEFAULT_RESUME_FALLBACK_PROMPT);
  });

  it('reads service state with filtered logs and deployment metadata', () => {
    const configDir = configureTempWebUiConfig();
    const logFile = join(configDir, 'web-ui.log');
    writeFileSync(logFile, 'alpha\nskip\n beta  \n');
    writeWebUiConfig({
      port: 4100,
      companionPort: 4800,
      useTailscaleServe: true,
      resumeFallbackPrompt: 'Resume from the last good step.',
    });

    filterSystemLogTailLinesMock.mockImplementationOnce((lines: string[]) => lines.filter((line) => line !== 'skip').map((line) => `filtered:${line}`));
    resolveWebUiTailscaleUrlMock.mockReturnValueOnce('https://tailnet.test/ui');
    getWebUiServiceStatusMock.mockReturnValueOnce(createStatus({
      running: false,
      logFile,
      port: 4100,
      url: 'http://127.0.0.1:4100',
      deployment: {
        stablePort: 4101,
        activeRelease: {
          distDir: '/releases/current/dist',
          serverDir: '/releases/current/server',
          serverEntryFile: '/releases/current/server/index.js',
          sourceRepoRoot: '/repo',
          revision: 'abc123',
        },
      },
    }));

    expect(readWebUiState()).toEqual({
      warnings: ['Web UI service is installed but not running.'],
      service: {
        platform: 'darwin',
        identifier: 'personal-agent-web-ui',
        manifestPath: '/Library/LaunchAgents/personal-agent-web-ui.plist',
        installed: true,
        running: false,
        logFile,
        repoRoot: '/repo',
        port: 4100,
        url: 'http://127.0.0.1:4100',
        companionPort: 4800,
        companionUrl: 'http://127.0.0.1:4800',
        tailscaleServe: true,
        tailscaleUrl: 'https://tailnet.test/ui',
        resumeFallbackPrompt: 'Resume from the last good step.',
        deployment: {
          stablePort: 4101,
          activeRelease: {
            distDir: '/releases/current/dist',
            serverDir: '/releases/current/server',
            serverEntryFile: '/releases/current/server/index.js',
            sourceRepoRoot: '/repo',
            revision: 'abc123',
          },
        },
      },
      log: {
        path: logFile,
        lines: ['filtered:alpha', 'filtered: beta'],
      },
    });
    expect(filterSystemLogTailLinesMock).toHaveBeenCalledWith(['alpha', 'skip', ' beta']);
  });

  it('falls back to default service state when inspection fails', () => {
    configureTempWebUiConfig();
    writeWebUiConfig({
      companionPort: 4900,
      useTailscaleServe: true,
      resumeFallbackPrompt: 'Resume from the last step.',
    });
    getWebUiServiceStatusMock.mockImplementationOnce(() => {
      throw new Error('status unavailable');
    });

    expect(readWebUiState()).toEqual({
      warnings: [
        'Could not inspect web UI service status: status unavailable',
        'Tailscale Serve is enabled, but a Tailnet URL could not be resolved from `tailscale status --json`. Ensure Tailscale is running and authenticated on this machine.',
      ],
      service: {
        platform: process.platform,
        identifier: 'personal-agent-web-ui',
        manifestPath: '',
        installed: false,
        running: false,
        repoRoot: process.cwd(),
        port: DEFAULT_WEB_UI_PORT,
        url: `http://127.0.0.1:${DEFAULT_WEB_UI_PORT}`,
        companionPort: 4900,
        companionUrl: 'http://127.0.0.1:4900',
        tailscaleServe: true,
        tailscaleUrl: undefined,
        resumeFallbackPrompt: 'Resume from the last step.',
        error: 'status unavailable',
      },
      log: {
        path: undefined,
        lines: [],
      },
    });
  });

  it('warns when the service is not installed and skips empty logs', () => {
    const configDir = configureTempWebUiConfig();
    const logFile = join(configDir, 'empty.log');
    writeFileSync(logFile, '');
    getWebUiServiceStatusMock.mockReturnValueOnce(createStatus({
      installed: false,
      running: false,
      logFile,
    }));

    expect(readWebUiState()).toEqual(expect.objectContaining({
      warnings: ['Web UI service is not installed. Install it from this page or run `pa ui service install`.'],
      log: {
        path: logFile,
        lines: [],
      },
    }));
    expect(filterSystemLogTailLinesMock).not.toHaveBeenCalled();
  });

  it('ignores unreadable log files', () => {
    const logDirectory = createTempDir('pa-web-ui-log-dir-');
    getWebUiServiceStatusMock.mockReturnValueOnce(createStatus({ logFile: logDirectory }));

    expect(readWebUiState()).toEqual(expect.objectContaining({
      warnings: [],
      log: {
        path: logDirectory,
        lines: [],
      },
    }));
    expect(filterSystemLogTailLinesMock).not.toHaveBeenCalled();
  });

  it('reports the packaged shell instead of a loopback web service in desktop runtime mode', () => {
    process.env.PERSONAL_AGENT_DESKTOP_RUNTIME = '1';
    process.env.PERSONAL_AGENT_STATE_ROOT = createTempDir('pa-desktop-state-');
    configureTempWebUiConfig();
    writeWebUiConfig({
      companionPort: 4900,
      useTailscaleServe: true,
      resumeFallbackPrompt: 'Resume inside desktop.',
    });

    expect(readWebUiState()).toEqual(expect.objectContaining({
      warnings: ['The packaged desktop shell does not expose the companion or full web UI over Tailnet HTTPS. Run a managed web UI separately if you need remote browser or companion access.'],
      service: expect.objectContaining({
        platform: 'desktop',
        identifier: 'desktop-app-shell',
        manifestPath: 'desktop app bundle',
        port: 0,
        url: 'personal-agent://app/',
        companionUrl: 'personal-agent://app/',
        tailscaleServe: true,
      }),
      log: expect.objectContaining({
        path: expect.stringMatching(/desktop\/logs\/main\.log$/),
      }),
    }));
  });

  it('syncs configured tailscale settings and wraps service lifecycle operations', () => {
    configureTempWebUiConfig();
    writeWebUiConfig({ port: 4200, companionPort: 4950 });
    getWebUiServiceStatusMock.mockReturnValue(createStatus({ port: 4200, url: 'http://127.0.0.1:4200' }));

    syncConfiguredWebUiTailscaleServe(true);
    expect(syncWebUiTailscaleServeMock).toHaveBeenCalledWith({
      enabled: true,
      port: 4200,
      companionPort: 4950,
    });

    expect(installWebUiServiceAndReadState()).toEqual(expect.objectContaining({
      service: expect.objectContaining({ port: 4200, companionPort: 4950 }),
    }));
    expect(startWebUiServiceAndReadState()).toEqual(expect.objectContaining({
      service: expect.objectContaining({ port: 4200 }),
    }));
    expect(restartWebUiServiceAndReadState()).toEqual(expect.objectContaining({
      service: expect.objectContaining({ port: 4200 }),
    }));
    expect(stopWebUiServiceAndReadState()).toEqual(expect.objectContaining({
      service: expect.objectContaining({ port: 4200 }),
    }));
    expect(uninstallWebUiServiceAndReadState()).toEqual(expect.objectContaining({
      service: expect.objectContaining({ port: 4200 }),
    }));

    expect(installWebUiServiceMock).toHaveBeenCalledTimes(1);
    expect(startWebUiServiceMock).toHaveBeenCalledTimes(1);
    expect(restartWebUiServiceMock).toHaveBeenCalledTimes(1);
    expect(stopWebUiServiceMock).toHaveBeenCalledTimes(1);
    expect(uninstallWebUiServiceMock).toHaveBeenCalledTimes(1);
  });
});
