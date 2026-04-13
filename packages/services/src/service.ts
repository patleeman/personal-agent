import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getStateRoot, resolveChildProcessEnv } from '@personal-agent/core';
import { loadDaemonConfig, resolveDaemonPaths } from '@personal-agent/daemon';
import {
  ensureActiveWebUiRelease,
  getWebUiDeploymentSummary,
  type WebUiDeploymentSummary,
} from './web-ui-deploy.js';

export type ManagedServicePlatform = 'launchd' | 'systemd';

export interface ManagedDaemonServiceInfo {
  identifier: string;
  manifestPath: string;
  logFile?: string;
}

export interface ManagedDaemonServiceStatus extends ManagedDaemonServiceInfo {
  installed: boolean;
  running: boolean;
}

export interface WebUiServiceOptions {
  repoRoot?: string;
  port?: number;
}

export interface WebUiServiceInfo {
  platform: ManagedServicePlatform;
  identifier: string;
  manifestPath: string;
  logFile?: string;
  repoRoot: string;
  port: number;
  url: string;
  deployment?: WebUiDeploymentSummary;
}

export interface WebUiServiceStatus extends WebUiServiceInfo {
  installed: boolean;
  running: boolean;
}

function resolveServicePlatform(): ManagedServicePlatform {
  if (process.platform === 'darwin') {
    return 'launchd';
  }

  if (process.platform === 'linux') {
    return 'systemd';
  }

  throw new Error('Managed service support exists only on macOS (launchd) and Linux (systemd --user).');
}

function resolveDaemonEntryFile(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  const siblingCandidate = resolve(currentDir, '..', '..', 'daemon', 'dist', 'index.js');
  if (existsSync(siblingCandidate)) {
    return siblingCandidate;
  }

  const workspaceCandidate = resolve(process.cwd(), 'packages', 'daemon', 'dist', 'index.js');
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  throw new Error('Could not locate daemon entrypoint (build packages/daemon first)');
}

function formatCommand(command: string, args: string[]): string {
  return `${command} ${args.join(' ')}`.trim();
}

interface CommandOptions {
  allowNonZero?: boolean;
}

function runCommand(command: string, args: string[], options: CommandOptions = {}): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(command, args, { encoding: 'utf-8' });

  if (result.error) {
    throw new Error(`Failed to run \`${formatCommand(command, args)}\`: ${result.error.message}`);
  }

  const status = result.status ?? null;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  if (!options.allowNonZero && (status ?? 1) !== 0) {
    const detail = stderr.trim() || stdout.trim() || `exit code ${status ?? 1}`;
    throw new Error(`Command failed: ${formatCommand(command, args)}\n${detail}`);
  }

  return {
    status,
    stdout,
    stderr,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function quoteSystemdValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function getDaemonLogFile(): string {
  const config = loadDaemonConfig();
  return resolveDaemonPaths(config.ipc.socketPath).logFile;
}

function getWebUiLogFile(): string {
  return join(getStateRoot(), 'web', 'logs', 'web.log');
}

function buildDaemonServiceEnvironment(): Record<string, string> {
  const resolvedEnv = resolveChildProcessEnv();
  const environment: Record<string, string> = {};

  const passthroughKeys = [
    'PATH',
    'PERSONAL_AGENT_STATE_ROOT',
    'PERSONAL_AGENT_CONFIG_FILE',
    'PERSONAL_AGENT_OP_BIN',
    'OP_SERVICE_ACCOUNT_TOKEN',
  ] as const;

  for (const key of passthroughKeys) {
    const value = resolvedEnv[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      environment[key] = value;
    }
  }

  return environment;
}

function buildWebUiServiceEnvironment(
  options: Required<WebUiServiceOptions>,
  release: { distDir: string; revision?: string },
): Record<string, string> {
  const resolvedEnv = resolveChildProcessEnv();
  const environment: Record<string, string> = {
    PERSONAL_AGENT_REPO_ROOT: resolve(options.repoRoot),
    PA_WEB_PORT: String(options.port),
    PA_WEB_DIST: release.distDir,
  };

  if (release.revision) {
    environment.PERSONAL_AGENT_WEB_REVISION = release.revision;
  }

  const passthroughKeys = [
    'PATH',
    'PERSONAL_AGENT_STATE_ROOT',
    'PERSONAL_AGENT_CONFIG_FILE',
    'PERSONAL_AGENT_LOCAL_PROFILE_DIR',
    'PERSONAL_AGENT_DISABLE_DAEMON_EVENTS',
    'PERSONAL_AGENT_OP_BIN',
    'OP_SERVICE_ACCOUNT_TOKEN',
    'XDG_CONFIG_HOME',
    'XDG_STATE_HOME',
  ] as const;

  for (const key of passthroughKeys) {
    const value = resolvedEnv[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      environment[key] = value;
    }
  }

  return environment;
}

interface LaunchdPlistInput {
  label: string;
  nodePath: string;
  entryFile: string;
  workingDirectory: string;
  logFile: string;
  environment: Record<string, string>;
}

function renderLaunchdEnvironment(environment: Record<string, string>): string {
  const entries = Object.entries(environment);
  if (entries.length === 0) {
    return '';
  }

  const lines = [
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
  ];

  for (const [key, value] of entries) {
    lines.push(`    <key>${escapeXml(key)}</key>`);
    lines.push(`    <string>${escapeXml(value)}</string>`);
  }

  lines.push('  </dict>');
  return lines.join('\n');
}

function buildLaunchdPlistContent(input: LaunchdPlistInput): string {
  const environmentBlock = renderLaunchdEnvironment(input.environment);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${escapeXml(input.label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${escapeXml(input.nodePath)}</string>`,
    `    <string>${escapeXml(input.entryFile)}</string>`,
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${escapeXml(input.workingDirectory)}</string>`,
    environmentBlock,
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(input.logFile)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(input.logFile)}</string>`,
    '</dict>',
    '</plist>',
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

function getLaunchdDomain(): string {
  if (typeof process.getuid !== 'function') {
    throw new Error('Unable to determine current user id for launchd service setup.');
  }

  return `gui/${process.getuid()}`;
}

function isLaunchdServiceRunning(status: { status: number | null; stdout: string; stderr: string }): boolean {
  if ((status.status ?? 1) !== 0) {
    return false;
  }

  const output = `${status.stdout}\n${status.stderr}`;
  return /\bstate = running\b/.test(output) || /\bpid = \d+\b/.test(output);
}

function getLaunchdDaemonLabel(): string {
  return 'io.personal-agent.daemon';
}

function getLaunchdWebUiLabel(): string {
  return 'io.personal-agent.web-ui';
}

function getLaunchdPlistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function normalizeWebUiServiceOptions(options: WebUiServiceOptions = {}): Required<WebUiServiceOptions> {
  const repoRoot = resolve(options.repoRoot ?? process.cwd());
  const deployment = getWebUiDeploymentSummary({ repoRoot, stablePort: options.port });

  return {
    repoRoot,
    port: options.port ?? deployment.stablePort,
  };
}

function buildWebUiUrl(port: number): string {
  return `http://localhost:${port}`;
}

function installLaunchdDaemonService(): ManagedDaemonServiceInfo {
  const label = getLaunchdDaemonLabel();
  const manifestPath = getLaunchdPlistPath(label);
  const logFile = getDaemonLogFile();
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;

  const entryFile = resolveDaemonEntryFile();
  const nodePath = process.execPath;
  const environment = buildDaemonServiceEnvironment();

  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });

  const content = buildLaunchdPlistContent({
    label,
    nodePath,
    entryFile,
    workingDirectory: homedir(),
    logFile,
    environment,
  });

  writeFileSync(manifestPath, `${content}\n`);

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });
  runCommand('launchctl', ['bootstrap', domain, manifestPath]);
  runCommand('launchctl', ['kickstart', '-k', serviceTarget], { allowNonZero: true });

  return {
    identifier: label,
    manifestPath,
    logFile,
  };
}

function getLaunchdDaemonServiceStatus(): ManagedDaemonServiceStatus {
  const label = getLaunchdDaemonLabel();
  const manifestPath = getLaunchdPlistPath(label);
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;
  const status = runCommand('launchctl', ['print', serviceTarget], { allowNonZero: true });

  return {
    identifier: label,
    manifestPath,
    logFile: getDaemonLogFile(),
    installed: existsSync(manifestPath),
    running: isLaunchdServiceRunning(status),
  };
}

function uninstallLaunchdDaemonService(): ManagedDaemonServiceInfo {
  const label = getLaunchdDaemonLabel();
  const manifestPath = getLaunchdPlistPath(label);
  const domain = getLaunchdDomain();

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });

  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  return {
    identifier: label,
    manifestPath,
    logFile: getDaemonLogFile(),
  };
}

function installLaunchdWebUiService(options: WebUiServiceOptions = {}): WebUiServiceInfo {
  const normalizedOptions = normalizeWebUiServiceOptions(options);
  const deployment = getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port });
  const release = deployment.activeRelease ?? ensureActiveWebUiRelease({
    repoRoot: normalizedOptions.repoRoot,
    stablePort: normalizedOptions.port,
  });
  const label = getLaunchdWebUiLabel();
  const manifestPath = getLaunchdPlistPath(label);
  const logFile = getWebUiLogFile();
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;

  const nodePath = process.execPath;
  const environment = buildWebUiServiceEnvironment(normalizedOptions, release);

  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });

  const content = buildLaunchdPlistContent({
    label,
    nodePath,
    entryFile: release.serverEntryFile,
    workingDirectory: normalizedOptions.repoRoot,
    logFile,
    environment,
  });

  writeFileSync(manifestPath, `${content}\n`);

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });
  runCommand('launchctl', ['bootstrap', domain, manifestPath]);
  runCommand('launchctl', ['kickstart', '-k', serviceTarget], { allowNonZero: true });

  return {
    platform: 'launchd',
    identifier: label,
    manifestPath,
    logFile,
    repoRoot: normalizedOptions.repoRoot,
    port: normalizedOptions.port,
    url: buildWebUiUrl(normalizedOptions.port),
    deployment: getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port }),
  };
}

function getLaunchdWebUiServiceStatus(options: WebUiServiceOptions = {}): WebUiServiceStatus {
  const normalizedOptions = normalizeWebUiServiceOptions(options);
  const label = getLaunchdWebUiLabel();
  const manifestPath = getLaunchdPlistPath(label);
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;
  const status = runCommand('launchctl', ['print', serviceTarget], { allowNonZero: true });

  return {
    platform: 'launchd',
    identifier: label,
    manifestPath,
    logFile: getWebUiLogFile(),
    repoRoot: normalizedOptions.repoRoot,
    port: normalizedOptions.port,
    url: buildWebUiUrl(normalizedOptions.port),
    deployment: getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port }),
    installed: existsSync(manifestPath),
    running: isLaunchdServiceRunning(status),
  };
}

function uninstallLaunchdWebUiService(options: WebUiServiceOptions = {}): WebUiServiceInfo {
  const normalizedOptions = normalizeWebUiServiceOptions(options);
  const label = getLaunchdWebUiLabel();
  const manifestPath = getLaunchdPlistPath(label);
  const domain = getLaunchdDomain();

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });

  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  return {
    platform: 'launchd',
    identifier: label,
    manifestPath,
    logFile: getWebUiLogFile(),
    repoRoot: normalizedOptions.repoRoot,
    port: normalizedOptions.port,
    url: buildWebUiUrl(normalizedOptions.port),
    deployment: getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port }),
  };
}

interface SystemdDaemonUnitInput {
  nodePath: string;
  entryFile: string;
  environment: Record<string, string>;
}

interface SystemdWebUiUnitInput {
  nodePath: string;
  entryFile: string;
  workingDirectory: string;
  environment: Record<string, string>;
}

function getSystemdDaemonUnitName(): string {
  return 'personal-agent-daemon.service';
}

function getSystemdWebUiUnitName(): string {
  return 'personal-agent-web-ui.service';
}

function buildSystemdDaemonUnitContent(input: SystemdDaemonUnitInput): string {
  const environmentLines = Object.entries(input.environment)
    .map(([key, value]) => `Environment=${key}=${quoteSystemdValue(value)}`)
    .join('\n');

  const lines = [
    '[Unit]',
    'Description=Personal Agent daemon',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${quoteSystemdValue(input.nodePath)} ${quoteSystemdValue(input.entryFile)}`,
    `WorkingDirectory=${quoteSystemdValue(homedir())}`,
    environmentLines,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
  ];

  return lines
    .filter((line) => line.length > 0)
    .join('\n');
}

function buildSystemdWebUiUnitContent(input: SystemdWebUiUnitInput): string {
  const environmentLines = Object.entries(input.environment)
    .map(([key, value]) => `Environment=${key}=${quoteSystemdValue(value)}`)
    .join('\n');

  const lines = [
    '[Unit]',
    'Description=Personal Agent web UI',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${quoteSystemdValue(input.nodePath)} ${quoteSystemdValue(input.entryFile)}`,
    `WorkingDirectory=${quoteSystemdValue(input.workingDirectory)}`,
    environmentLines,
    'Restart=always',
    'RestartSec=5',
    '',
    '[Install]',
    'WantedBy=default.target',
  ];

  return lines
    .filter((line) => line.length > 0)
    .join('\n');
}

function getSystemdUnitPath(unitName: string): string {
  return join(homedir(), '.config', 'systemd', 'user', unitName);
}

function installSystemdDaemonService(): ManagedDaemonServiceInfo {
  const unitName = getSystemdDaemonUnitName();
  const manifestPath = getSystemdUnitPath(unitName);
  const entryFile = resolveDaemonEntryFile();
  const nodePath = process.execPath;
  const environment = buildDaemonServiceEnvironment();

  mkdirSync(dirname(manifestPath), { recursive: true });

  const content = buildSystemdDaemonUnitContent({
    nodePath,
    entryFile,
    environment,
  });

  writeFileSync(manifestPath, `${content}\n`);

  runCommand('systemctl', ['--user', 'daemon-reload']);
  runCommand('systemctl', ['--user', 'enable', '--now', unitName]);

  return {
    identifier: unitName,
    manifestPath,
  };
}

function getSystemdDaemonServiceStatus(): ManagedDaemonServiceStatus {
  const unitName = getSystemdDaemonUnitName();
  const manifestPath = getSystemdUnitPath(unitName);
  const status = runCommand('systemctl', ['--user', 'is-active', unitName], { allowNonZero: true });
  const activeState = status.stdout.trim().toLowerCase();

  return {
    identifier: unitName,
    manifestPath,
    installed: existsSync(manifestPath),
    running: (status.status ?? 1) === 0 && activeState === 'active',
  };
}

function uninstallSystemdDaemonService(): ManagedDaemonServiceInfo {
  const unitName = getSystemdDaemonUnitName();
  const manifestPath = getSystemdUnitPath(unitName);

  runCommand('systemctl', ['--user', 'disable', '--now', unitName], { allowNonZero: true });

  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  runCommand('systemctl', ['--user', 'daemon-reload']);

  return {
    identifier: unitName,
    manifestPath,
  };
}

function installSystemdWebUiService(options: WebUiServiceOptions = {}): WebUiServiceInfo {
  const normalizedOptions = normalizeWebUiServiceOptions(options);
  const deployment = getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port });
  const release = deployment.activeRelease ?? ensureActiveWebUiRelease({
    repoRoot: normalizedOptions.repoRoot,
    stablePort: normalizedOptions.port,
  });
  const unitName = getSystemdWebUiUnitName();
  const manifestPath = getSystemdUnitPath(unitName);
  const nodePath = process.execPath;
  const environment = buildWebUiServiceEnvironment(normalizedOptions, release);

  mkdirSync(dirname(manifestPath), { recursive: true });

  const content = buildSystemdWebUiUnitContent({
    nodePath,
    entryFile: release.serverEntryFile,
    workingDirectory: normalizedOptions.repoRoot,
    environment,
  });

  writeFileSync(manifestPath, `${content}\n`);

  runCommand('systemctl', ['--user', 'daemon-reload']);
  runCommand('systemctl', ['--user', 'enable', '--now', unitName]);

  return {
    platform: 'systemd',
    identifier: unitName,
    manifestPath,
    repoRoot: normalizedOptions.repoRoot,
    port: normalizedOptions.port,
    url: buildWebUiUrl(normalizedOptions.port),
    deployment: getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port }),
  };
}

function getSystemdWebUiServiceStatus(options: WebUiServiceOptions = {}): WebUiServiceStatus {
  const normalizedOptions = normalizeWebUiServiceOptions(options);
  const unitName = getSystemdWebUiUnitName();
  const manifestPath = getSystemdUnitPath(unitName);
  const status = runCommand('systemctl', ['--user', 'is-active', unitName], { allowNonZero: true });
  const activeState = status.stdout.trim().toLowerCase();

  return {
    platform: 'systemd',
    identifier: unitName,
    manifestPath,
    repoRoot: normalizedOptions.repoRoot,
    port: normalizedOptions.port,
    url: buildWebUiUrl(normalizedOptions.port),
    deployment: getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port }),
    installed: existsSync(manifestPath),
    running: (status.status ?? 1) === 0 && activeState === 'active',
  };
}

function uninstallSystemdWebUiService(options: WebUiServiceOptions = {}): WebUiServiceInfo {
  const normalizedOptions = normalizeWebUiServiceOptions(options);
  const unitName = getSystemdWebUiUnitName();
  const manifestPath = getSystemdUnitPath(unitName);

  runCommand('systemctl', ['--user', 'disable', '--now', unitName], { allowNonZero: true });

  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  runCommand('systemctl', ['--user', 'daemon-reload']);

  return {
    platform: 'systemd',
    identifier: unitName,
    manifestPath,
    repoRoot: normalizedOptions.repoRoot,
    port: normalizedOptions.port,
    url: buildWebUiUrl(normalizedOptions.port),
    deployment: getWebUiDeploymentSummary({ repoRoot: normalizedOptions.repoRoot, stablePort: normalizedOptions.port }),
  };
}

function startLaunchdService(label: string, manifestPath: string): void {
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;

  runCommand('launchctl', ['bootstrap', domain, manifestPath]);
  runCommand('launchctl', ['kickstart', '-k', serviceTarget], { allowNonZero: true });
}

function stopLaunchdService(manifestPath: string): void {
  const domain = getLaunchdDomain();

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });
}

function restartLaunchdService(label: string, manifestPath: string): void {
  stopLaunchdService(manifestPath);
  startLaunchdService(label, manifestPath);
}

function startSystemdService(unitName: string): void {
  runCommand('systemctl', ['--user', 'daemon-reload']);
  runCommand('systemctl', ['--user', 'start', unitName]);
}

function stopSystemdService(unitName: string): void {
  runCommand('systemctl', ['--user', 'stop', unitName]);
}

function restartSystemdService(unitName: string): void {
  runCommand('systemctl', ['--user', 'daemon-reload']);
  runCommand('systemctl', ['--user', 'restart', unitName]);
}

function restartLaunchdDaemonService(): void {
  const label = getLaunchdDaemonLabel();
  const manifestPath = getLaunchdPlistPath(label);
  restartLaunchdService(label, manifestPath);
}

function restartSystemdDaemonService(): void {
  const unitName = getSystemdDaemonUnitName();
  restartSystemdService(unitName);
}

function startLaunchdDaemonService(): void {
  const label = getLaunchdDaemonLabel();
  const manifestPath = getLaunchdPlistPath(label);
  startLaunchdService(label, manifestPath);
}

function stopLaunchdDaemonService(): void {
  const manifestPath = getLaunchdPlistPath(getLaunchdDaemonLabel());
  stopLaunchdService(manifestPath);
}

function startSystemdDaemonService(): void {
  const unitName = getSystemdDaemonUnitName();
  startSystemdService(unitName);
}

function stopSystemdDaemonService(): void {
  const unitName = getSystemdDaemonUnitName();
  stopSystemdService(unitName);
}

function restartLaunchdWebUiService(): void {
  const label = getLaunchdWebUiLabel();
  const manifestPath = getLaunchdPlistPath(label);
  restartLaunchdService(label, manifestPath);
}

function restartSystemdWebUiService(): void {
  const unitName = getSystemdWebUiUnitName();
  restartSystemdService(unitName);
}

function startLaunchdWebUiService(): void {
  const label = getLaunchdWebUiLabel();
  const manifestPath = getLaunchdPlistPath(label);
  startLaunchdService(label, manifestPath);
}

function stopLaunchdWebUiService(): void {
  const manifestPath = getLaunchdPlistPath(getLaunchdWebUiLabel());
  stopLaunchdService(manifestPath);
}

function startSystemdWebUiService(): void {
  const unitName = getSystemdWebUiUnitName();
  startSystemdService(unitName);
}

function stopSystemdWebUiService(): void {
  const unitName = getSystemdWebUiUnitName();
  stopSystemdService(unitName);
}

export function installManagedDaemonService(): ManagedDaemonServiceInfo {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return installLaunchdDaemonService();
  }

  return installSystemdDaemonService();
}

export function uninstallManagedDaemonService(): ManagedDaemonServiceInfo {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return uninstallLaunchdDaemonService();
  }

  return uninstallSystemdDaemonService();
}

export function getManagedDaemonServiceStatus(): ManagedDaemonServiceStatus {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return getLaunchdDaemonServiceStatus();
  }

  return getSystemdDaemonServiceStatus();
}

export function startManagedDaemonService(): ManagedDaemonServiceStatus {
  const status = getManagedDaemonServiceStatus();

  if (!status.installed) {
    throw new Error('Managed daemon service is not installed. Run `pa daemon service install` first.');
  }

  if (status.running) {
    return status;
  }

  const platform = resolveServicePlatform();
  if (platform === 'launchd') {
    startLaunchdDaemonService();
  } else {
    startSystemdDaemonService();
  }

  return getManagedDaemonServiceStatus();
}

export function stopManagedDaemonService(): ManagedDaemonServiceStatus {
  const status = getManagedDaemonServiceStatus();

  if (!status.installed) {
    throw new Error('Managed daemon service is not installed. Run `pa daemon service install` first.');
  }

  if (!status.running) {
    return status;
  }

  const platform = resolveServicePlatform();
  if (platform === 'launchd') {
    stopLaunchdDaemonService();
  } else {
    stopSystemdDaemonService();
  }

  return getManagedDaemonServiceStatus();
}

export function installWebUiService(options: WebUiServiceOptions = {}): WebUiServiceInfo {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return installLaunchdWebUiService(options);
  }

  return installSystemdWebUiService(options);
}

export function uninstallWebUiService(options: WebUiServiceOptions = {}): WebUiServiceInfo {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return uninstallLaunchdWebUiService(options);
  }

  return uninstallSystemdWebUiService(options);
}

export function getWebUiServiceStatus(options: WebUiServiceOptions = {}): WebUiServiceStatus {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return getLaunchdWebUiServiceStatus(options);
  }

  return getSystemdWebUiServiceStatus(options);
}

export function startWebUiService(options: WebUiServiceOptions = {}): WebUiServiceStatus {
  const status = getWebUiServiceStatus(options);

  if (!status.installed) {
    throw new Error('Managed web UI service is not installed. Run `pa ui service install` first.');
  }

  if (status.running) {
    return status;
  }

  if (status.platform === 'launchd') {
    startLaunchdWebUiService();
  } else {
    startSystemdWebUiService();
  }

  return getWebUiServiceStatus(options);
}

export function stopWebUiService(options: WebUiServiceOptions = {}): WebUiServiceStatus {
  const status = getWebUiServiceStatus(options);

  if (!status.installed) {
    throw new Error('Managed web UI service is not installed. Run `pa ui service install` first.');
  }

  if (!status.running) {
    return status;
  }

  if (status.platform === 'launchd') {
    stopLaunchdWebUiService();
  } else {
    stopSystemdWebUiService();
  }

  return getWebUiServiceStatus(options);
}

export function restartWebUiService(options: WebUiServiceOptions = {}): WebUiServiceStatus {
  const status = getWebUiServiceStatus(options);

  if (!status.installed) {
    throw new Error('Managed web UI service is not installed. Run `pa ui service install` first.');
  }

  if (status.platform === 'launchd') {
    restartLaunchdWebUiService();
  } else {
    restartSystemdWebUiService();
  }

  return getWebUiServiceStatus(options);
}

export function restartWebUiServiceIfInstalled(options: WebUiServiceOptions = {}): WebUiServiceStatus | undefined {
  const status = getWebUiServiceStatus(options);

  if (!status.installed) {
    return undefined;
  }

  if (status.platform === 'launchd') {
    restartLaunchdWebUiService();
  } else {
    restartSystemdWebUiService();
  }

  return getWebUiServiceStatus(options);
}

export function restartManagedDaemonServiceIfInstalled(): ManagedDaemonServiceStatus | undefined {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    const status = getLaunchdDaemonServiceStatus();

    if (!status.installed) {
      return undefined;
    }

    restartLaunchdDaemonService();
    return getLaunchdDaemonServiceStatus();
  }

  const status = getSystemdDaemonServiceStatus();

  if (!status.installed) {
    return undefined;
  }

  restartSystemdDaemonService();
  return getSystemdDaemonServiceStatus();
}
