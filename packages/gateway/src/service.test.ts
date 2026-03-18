import { resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  cpSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  rmSync: vi.fn(),
  symlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  homedir: vi.fn(),
  getStateRoot: vi.fn(),
  loadDaemonConfig: vi.fn(),
  resolveDaemonPaths: vi.fn(),
  readGatewayConfig: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock('fs', () => ({
  cpSync: mocks.cpSync,
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  readFileSync: mocks.readFileSync,
  rmSync: mocks.rmSync,
  symlinkSync: mocks.symlinkSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock('os', () => ({
  homedir: mocks.homedir,
}));

vi.mock('@personal-agent/core', () => ({
  getStateRoot: mocks.getStateRoot,
}));

vi.mock('@personal-agent/daemon', () => ({
  loadDaemonConfig: mocks.loadDaemonConfig,
  resolveDaemonPaths: mocks.resolveDaemonPaths,
}));

vi.mock('./config.js', () => ({
  readGatewayConfig: mocks.readGatewayConfig,
}));

import {
  getGatewayServiceStatus,
  getManagedDaemonServiceStatus,
  getWebUiServiceStatus,
  installGatewayService,
  installManagedDaemonService,
  installWebUiService,
  restartGatewayService,
  restartGatewayServiceIfInstalled,
  restartManagedDaemonServiceIfInstalled,
  restartWebUiServiceIfInstalled,
  uninstallGatewayService,
  uninstallManagedDaemonService,
  uninstallWebUiService,
} from './service.js';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalGetuid = process.getuid;
const originalEnv = process.env;

const existingPaths = new Set<string>();
const fileContents = new Map<string, string>();

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    value: platform,
    configurable: true,
  });
}

function setInstalled(path: string, installed: boolean): void {
  if (installed) {
    existingPaths.add(path);
  } else {
    existingPaths.delete(path);
  }
}

beforeEach(() => {
  vi.clearAllMocks();

  existingPaths.clear();
  fileContents.clear();

  existingPaths.add(resolve(process.cwd(), 'packages', 'gateway', 'dist', 'index.js'));
  existingPaths.add(resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js'));
  existingPaths.add(resolve(process.cwd(), 'packages', 'web', 'dist'));
  existingPaths.add(resolve(process.cwd(), 'packages', 'web', 'dist-server'));
  existingPaths.add(resolve(process.cwd(), 'packages', 'web', 'dist-server', 'index.js'));
  existingPaths.add(resolve(process.cwd(), 'node_modules'));

  existingPaths.add('/repo/personal-agent/packages/web/dist');
  existingPaths.add('/repo/personal-agent/packages/web/dist-server');
  existingPaths.add('/repo/personal-agent/packages/web/dist-server/index.js');
  existingPaths.add('/repo/personal-agent/node_modules');

  mocks.existsSync.mockImplementation((path: string) => existingPaths.has(String(path)));
  mocks.readFileSync.mockImplementation((path: string) => fileContents.get(String(path)) ?? '');
  mocks.writeFileSync.mockImplementation((path: string, content: string) => {
    const normalizedPath = String(path);
    existingPaths.add(normalizedPath);
    fileContents.set(normalizedPath, String(content));
  });
  mocks.cpSync.mockImplementation((source: string, destination: string) => {
    const normalizedSource = String(source);
    const normalizedDestination = String(destination);
    const snapshot = [...existingPaths];
    existingPaths.add(normalizedDestination);
    for (const entry of snapshot) {
      if (entry === normalizedSource || entry.startsWith(`${normalizedSource}/`)) {
        const copiedPath = entry.replace(normalizedSource, normalizedDestination);
        existingPaths.add(copiedPath);
        const content = fileContents.get(entry);
        if (typeof content === 'string') {
          fileContents.set(copiedPath, content);
        }
      }
    }
  });
  mocks.symlinkSync.mockImplementation((_target: string, path: string) => {
    existingPaths.add(String(path));
  });
  mocks.rmSync.mockImplementation((path: string) => {
    const normalizedPath = String(path);
    for (const entry of [...existingPaths]) {
      if (entry === normalizedPath || entry.startsWith(`${normalizedPath}/`)) {
        existingPaths.delete(entry);
      }
    }
    for (const entry of [...fileContents.keys()]) {
      if (entry === normalizedPath || entry.startsWith(`${normalizedPath}/`)) {
        fileContents.delete(entry);
      }
    }
  });

  mocks.homedir.mockReturnValue('/Users/tester');
  mocks.getStateRoot.mockReturnValue('/state-root');
  mocks.loadDaemonConfig.mockReturnValue({ ipc: { socketPath: '/state-root/daemon.sock' } });
  mocks.resolveDaemonPaths.mockReturnValue({ logFile: '/state-root/daemon/logs/daemon.log' });

  mocks.readGatewayConfig.mockReturnValue({
    telegram: {
      token: 'telegram-token',
      allowlist: ['123'],
      workingDirectory: '/work/telegram',
    },
  });

  mocks.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

  process.env = {
    ...originalEnv,
    PATH: '/usr/bin:/bin',
    PERSONAL_AGENT_STATE_ROOT: '/state-root',
    OP_SERVICE_ACCOUNT_TOKEN: 'op-token',
  };

  (process as { getuid?: () => number }).getuid = () => 501;
});

afterEach(() => {
  process.env = originalEnv;

  if (originalPlatform) {
    Object.defineProperty(process, 'platform', originalPlatform);
  }

  (process as { getuid?: () => number }).getuid = originalGetuid;

  vi.restoreAllMocks();
});

describe('gateway service management', () => {
  it('installs launchd services and writes manifests with environment passthrough', () => {
    setPlatform('darwin');
    process.env.PERSONAL_AGENT_PROFILE = 'assistant';
    process.env.PERSONAL_AGENT_GATEWAY_DEFAULT_MODEL = 'openai/gpt-5.4';

    const info = installGatewayService('telegram');

    expect(info).toMatchObject({
      platform: 'launchd',
      provider: 'telegram',
      identifier: 'io.personal-agent.gateway.telegram',
      manifestPath: '/Users/tester/Library/LaunchAgents/io.personal-agent.gateway.telegram.plist',
      logFile: '/state-root/gateway/logs/telegram.log',
    });
    expect(info.daemonService).toMatchObject({
      identifier: 'io.personal-agent.daemon',
      manifestPath: '/Users/tester/Library/LaunchAgents/io.personal-agent.daemon.plist',
      logFile: '/state-root/daemon/logs/daemon.log',
    });

    const manifestWrite = mocks.writeFileSync.mock.calls.find((call) => String(call[0]).includes('gateway.telegram.plist'));
    expect(manifestWrite).toBeDefined();
    const manifestContent = String(manifestWrite?.[1] ?? '');
    expect(manifestContent).toContain('PERSONAL_AGENT_GATEWAY_PROVIDER');
    expect(manifestContent).toContain('OP_SERVICE_ACCOUNT_TOKEN');
    expect(manifestContent).toContain('/work/telegram');
    expect(manifestContent).not.toContain('PERSONAL_AGENT_PROFILE');
    expect(manifestContent).not.toContain('PERSONAL_AGENT_GATEWAY_DEFAULT_MODEL');

    const executed = mocks.spawnSync.mock.calls.map((call) => `${call[0]} ${(call[1] as string[]).join(' ')}`);
    expect(executed).toContain('launchctl bootstrap gui/501 /Users/tester/Library/LaunchAgents/io.personal-agent.daemon.plist');
    expect(executed).toContain('launchctl bootstrap gui/501 /Users/tester/Library/LaunchAgents/io.personal-agent.gateway.telegram.plist');
  });

  it('reports and restarts launchd web ui service when installed', () => {
    setPlatform('darwin');

    const manifestPath = '/Users/tester/Library/LaunchAgents/io.personal-agent.web-ui.plist';
    setInstalled(manifestPath, true);

    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: 'state = running\npid = 123\n',
      stderr: '',
    });

    const status = getWebUiServiceStatus({ repoRoot: '/repo/personal-agent', port: 3741 });
    expect(status).toMatchObject({ installed: true, running: true, url: 'http://localhost:3741' });

    const restarted = restartWebUiServiceIfInstalled({ repoRoot: '/repo/personal-agent', port: 3741 });
    expect(restarted).toMatchObject({ installed: true, running: true, url: 'http://localhost:3741' });

    const commands = mocks.spawnSync.mock.calls.map((call) => `${call[0]} ${(call[1] as string[]).join(' ')}`);
    expect(commands.some((line) => line.includes('launchctl kickstart -k gui/501/io.personal-agent.web-ui'))).toBe(true);
  });

  it('installs and uninstalls systemd web ui service units on linux', () => {
    setPlatform('linux');

    const installed = installWebUiService({ repoRoot: '/repo/personal-agent', port: 4455 });
    expect(installed).toMatchObject({
      platform: 'systemd',
      identifier: 'personal-agent-web-ui.service',
      manifestPath: '/Users/tester/.config/systemd/user/personal-agent-web-ui.service',
      repoRoot: '/repo/personal-agent',
      port: 4455,
      url: 'http://localhost:4455',
    });

    const manifestWrite = mocks.writeFileSync.mock.calls.find((call) => String(call[0]).includes('personal-agent-web-ui.service'));
    expect(String(manifestWrite?.[1] ?? '')).toContain('Environment=PA_WEB_PORT="4455"');

    const removed = uninstallWebUiService({ repoRoot: '/repo/personal-agent', port: 4455 });
    expect(removed).toMatchObject({
      platform: 'systemd',
      identifier: 'personal-agent-web-ui.service',
    });
  });

  it('passes explicit web UI config path through to web UI service env', () => {
    setPlatform('linux');
    process.env.PERSONAL_AGENT_WEB_CONFIG_FILE = '/tmp/personal-agent-web-ui.json';

    const installed = installWebUiService({ repoRoot: '/repo/personal-agent', port: 4455 });
    expect(installed).toMatchObject({
      platform: 'systemd',
      identifier: 'personal-agent-web-ui.service',
      manifestPath: '/Users/tester/.config/systemd/user/personal-agent-web-ui.service',
      repoRoot: '/repo/personal-agent',
      port: 4455,
      url: 'http://localhost:4455',
    });

    const manifestWrite = mocks.writeFileSync.mock.calls.find((call) => String(call[0]).includes('personal-agent-web-ui.service'));
    expect(String(manifestWrite?.[1] ?? '')).toContain('PERSONAL_AGENT_WEB_CONFIG_FILE="/tmp/personal-agent-web-ui.json"');

    const removed = uninstallWebUiService({ repoRoot: '/repo/personal-agent', port: 4455 });
    expect(removed).toMatchObject({
      platform: 'systemd',
      identifier: 'personal-agent-web-ui.service',
    });
  });

  it('validates provider configuration before install', () => {
    setPlatform('darwin');
    mocks.readGatewayConfig.mockReturnValue({ telegram: { allowlist: ['123'] } });

    expect(() => installGatewayService('telegram')).toThrow(
      'Gateway telegram token missing. Run `pa gateway telegram setup` first.',
    );
  });

  it('accepts telegram setup when allowlist is empty but allowed user IDs are configured', () => {
    setPlatform('darwin');
    mocks.readGatewayConfig.mockReturnValue({
      telegram: {
        token: 'telegram-token',
        allowlist: [],
        allowedUserIds: ['42'],
        workingDirectory: '/work/telegram',
      },
    });

    const info = installGatewayService('telegram');
    expect(info.provider).toBe('telegram');
  });

  it('requires telegram allowlist or allowed user IDs', () => {
    setPlatform('darwin');
    mocks.readGatewayConfig.mockReturnValue({
      telegram: {
        token: 'telegram-token',
        allowlist: [],
        allowedUserIds: [],
        workingDirectory: '/work/telegram',
      },
    });

    expect(() => installGatewayService('telegram')).toThrow(
      'Gateway telegram allowlist or allowed user IDs missing. Run `pa gateway telegram setup` first.',
    );
  });

  it('reports launchd service status from manifest presence and launchctl response', () => {
    setPlatform('darwin');

    const manifestPath = '/Users/tester/Library/LaunchAgents/io.personal-agent.gateway.telegram.plist';
    setInstalled(manifestPath, true);

    mocks.spawnSync.mockReturnValueOnce({ status: 0, stdout: 'state = running\npid = 456\n', stderr: '' });
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: 'not found' });

    const status = getGatewayServiceStatus('telegram');

    expect(status).toMatchObject({
      platform: 'launchd',
      installed: true,
      running: true,
      daemonService: {
        installed: false,
      },
    });
  });

  it('reports launchd gateway service as not running when launchctl says not running', () => {
    setPlatform('darwin');

    const manifestPath = '/Users/tester/Library/LaunchAgents/io.personal-agent.gateway.telegram.plist';
    setInstalled(manifestPath, true);

    mocks.spawnSync.mockReturnValueOnce({ status: 0, stdout: 'state = not running\nlast exit code = 1\n', stderr: '' });
    mocks.spawnSync.mockReturnValueOnce({ status: 0, stdout: 'state = running\npid = 789\n', stderr: '' });

    const status = getGatewayServiceStatus('telegram');

    expect(status).toMatchObject({
      installed: true,
      running: false,
    });
  });

  it('throws when restarting an uninstalled gateway service', () => {
    setPlatform('darwin');

    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'not found' });

    expect(() => restartGatewayService('telegram')).toThrow(
      'Gateway service for telegram is not installed. Run `pa gateway service install telegram` first.',
    );
  });

  it('restarts gateway service when installed and returns refreshed status', () => {
    setPlatform('darwin');

    const manifestPath = '/Users/tester/Library/LaunchAgents/io.personal-agent.gateway.telegram.plist';
    setInstalled(manifestPath, true);

    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: 'state = running\npid = 123\n',
      stderr: '',
    });

    const status = restartGatewayServiceIfInstalled('telegram');

    expect(status).toBeDefined();
    expect(status?.running).toBe(true);

    const commands = mocks.spawnSync.mock.calls.map((call) => `${call[0]} ${(call[1] as string[]).join(' ')}`);
    expect(commands.some((line) => line.includes('launchctl kickstart -k gui/501/io.personal-agent.gateway.telegram'))).toBe(true);
  });

  it('installs and uninstalls systemd service units on linux', () => {
    setPlatform('linux');

    const installed = installGatewayService('telegram');

    expect(installed).toMatchObject({
      platform: 'systemd',
      provider: 'telegram',
      identifier: 'personal-agent-gateway-telegram.service',
      manifestPath: '/Users/tester/.config/systemd/user/personal-agent-gateway-telegram.service',
    });

    const manifestWrite = mocks.writeFileSync.mock.calls.find((call) => String(call[0]).includes('gateway-telegram.service'));
    expect(String(manifestWrite?.[1] ?? '')).toContain('Environment=PERSONAL_AGENT_GATEWAY_PROVIDER');

    const removed = uninstallGatewayService('telegram');
    expect(removed).toMatchObject({
      platform: 'systemd',
      provider: 'telegram',
      identifier: 'personal-agent-gateway-telegram.service',
    });

    const commands = mocks.spawnSync.mock.calls.map((call) => `${call[0]} ${(call[1] as string[]).join(' ')}`);
    expect(commands).toContain('systemctl --user enable --now personal-agent-gateway-telegram.service');
    expect(commands).toContain('systemctl --user disable --now personal-agent-gateway-telegram.service');
  });

  it('supports managed daemon service install/uninstall/status and restart-if-installed', () => {
    setPlatform('linux');

    const installInfo = installManagedDaemonService();
    expect(installInfo).toMatchObject({
      identifier: 'personal-agent-daemon.service',
      manifestPath: '/Users/tester/.config/systemd/user/personal-agent-daemon.service',
    });

    const manifestPath = '/Users/tester/.config/systemd/user/personal-agent-daemon.service';
    setInstalled(manifestPath, true);
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: 'active\n', stderr: '' });

    const status = getManagedDaemonServiceStatus();
    expect(status).toMatchObject({ installed: true, running: true });

    const restarted = restartManagedDaemonServiceIfInstalled();
    expect(restarted).toMatchObject({ installed: true, running: true });

    const uninstallInfo = uninstallManagedDaemonService();
    expect(uninstallInfo).toMatchObject({
      identifier: 'personal-agent-daemon.service',
      manifestPath,
    });
  });

  it('returns undefined when restarting daemon service if manifest is not installed', () => {
    setPlatform('darwin');

    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'missing' });

    const result = restartManagedDaemonServiceIfInstalled();
    expect(result).toBeUndefined();
  });

  it('throws on unsupported platforms', () => {
    setPlatform('win32');

    expect(() => getManagedDaemonServiceStatus()).toThrow(
      'Gateway service management supports macOS (launchd) and Linux (systemd --user) only.',
    );
  });

  it('surfaces command execution failures with actionable command details', () => {
    setPlatform('linux');

    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 1, stdout: '', stderr: 'permission denied' });

    expect(() => installManagedDaemonService()).toThrow(
      'Command failed: systemctl --user enable --now personal-agent-daemon.service\npermission denied',
    );
  });
});
