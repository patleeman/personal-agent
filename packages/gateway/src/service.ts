import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { getStateRoot } from '@personal-agent/core';
import { readGatewayConfig } from './config.js';

export type GatewayProvider = 'telegram' | 'discord';

export type GatewayServicePlatform = 'launchd' | 'systemd';

export interface GatewayServiceInfo {
  platform: GatewayServicePlatform;
  provider: GatewayProvider;
  identifier: string;
  manifestPath: string;
  logFile?: string;
}

export interface GatewayServiceStatus extends GatewayServiceInfo {
  installed: boolean;
  running: boolean;
}

function resolveServicePlatform(): GatewayServicePlatform {
  if (process.platform === 'darwin') {
    return 'launchd';
  }

  if (process.platform === 'linux') {
    return 'systemd';
  }

  throw new Error('Gateway service management supports macOS (launchd) and Linux (systemd --user) only.');
}

function resolveGatewayEntryFile(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);

  const localCandidate = resolve(currentDir, 'index.js');
  if (existsSync(localCandidate)) {
    return localCandidate;
  }

  const workspaceCandidate = resolve(process.cwd(), 'packages', 'gateway', 'dist', 'index.js');
  if (existsSync(workspaceCandidate)) {
    return workspaceCandidate;
  }

  throw new Error('Could not locate gateway entrypoint (build packages/gateway first)');
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

function validateProviderSetup(provider: GatewayProvider): string {
  const stored = readGatewayConfig();
  const providerConfig = provider === 'telegram' ? stored.telegram : stored.discord;

  if (!providerConfig?.token) {
    throw new Error(`Gateway ${provider} token missing. Run \`pa gateway ${provider} setup\` first.`);
  }

  if (!providerConfig.allowlist || providerConfig.allowlist.length === 0) {
    throw new Error(`Gateway ${provider} allowlist missing. Run \`pa gateway ${provider} setup\` first.`);
  }

  return providerConfig.workingDirectory ?? homedir();
}

function getGatewayLogFile(provider: GatewayProvider): string {
  return join(getStateRoot(), 'gateway', 'logs', `${provider}.log`);
}

function buildServiceEnvironment(provider: GatewayProvider): Record<string, string> {
  const environment: Record<string, string> = {
    PERSONAL_AGENT_GATEWAY_PROVIDER: provider,
  };

  const passthroughKeys = [
    'PATH',
    'PERSONAL_AGENT_STATE_ROOT',
    'PERSONAL_AGENT_GATEWAY_CONFIG_FILE',
    'PERSONAL_AGENT_PROFILE',
    'PERSONAL_AGENT_PI_TIMEOUT_MS',
    'PERSONAL_AGENT_PI_MAX_OUTPUT_BYTES',
  ] as const;

  for (const key of passthroughKeys) {
    const value = process.env[key];
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

function getLaunchdLabel(provider: GatewayProvider): string {
  return `io.personal-agent.gateway.${provider}`;
}

function getLaunchdPlistPath(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

interface SystemdUnitInput {
  provider: GatewayProvider;
  nodePath: string;
  entryFile: string;
  workingDirectory: string;
  environment: Record<string, string>;
}

function buildSystemdUnitContent(input: SystemdUnitInput): string {
  const environmentLines = Object.entries(input.environment)
    .map(([key, value]) => `Environment=${key}=${quoteSystemdValue(value)}`)
    .join('\n');

  const lines = [
    '[Unit]',
    `Description=Personal Agent gateway (${input.provider})`,
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

function getSystemdUnitName(provider: GatewayProvider): string {
  return `personal-agent-gateway-${provider}.service`;
}

function getSystemdUnitPath(unitName: string): string {
  return join(homedir(), '.config', 'systemd', 'user', unitName);
}

function installLaunchdGatewayService(provider: GatewayProvider): GatewayServiceInfo {
  const label = getLaunchdLabel(provider);
  const manifestPath = getLaunchdPlistPath(label);
  const logFile = getGatewayLogFile(provider);
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;

  const workingDirectory = validateProviderSetup(provider);
  const entryFile = resolveGatewayEntryFile();
  const nodePath = process.execPath;
  const environment = buildServiceEnvironment(provider);

  mkdirSync(dirname(manifestPath), { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });

  const content = buildLaunchdPlistContent({
    label,
    nodePath,
    entryFile,
    workingDirectory,
    logFile,
    environment,
  });

  writeFileSync(manifestPath, `${content}\n`);

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });
  runCommand('launchctl', ['bootstrap', domain, manifestPath]);
  runCommand('launchctl', ['kickstart', '-k', serviceTarget], { allowNonZero: true });

  return {
    platform: 'launchd',
    provider,
    identifier: label,
    manifestPath,
    logFile,
  };
}

function uninstallLaunchdGatewayService(provider: GatewayProvider): GatewayServiceInfo {
  const label = getLaunchdLabel(provider);
  const manifestPath = getLaunchdPlistPath(label);
  const domain = getLaunchdDomain();

  runCommand('launchctl', ['bootout', domain, manifestPath], { allowNonZero: true });

  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  return {
    platform: 'launchd',
    provider,
    identifier: label,
    manifestPath,
    logFile: getGatewayLogFile(provider),
  };
}

function getLaunchdGatewayServiceStatus(provider: GatewayProvider): GatewayServiceStatus {
  const label = getLaunchdLabel(provider);
  const manifestPath = getLaunchdPlistPath(label);
  const domain = getLaunchdDomain();
  const serviceTarget = `${domain}/${label}`;
  const status = runCommand('launchctl', ['print', serviceTarget], { allowNonZero: true });

  return {
    platform: 'launchd',
    provider,
    identifier: label,
    manifestPath,
    logFile: getGatewayLogFile(provider),
    installed: existsSync(manifestPath),
    running: (status.status ?? 1) === 0,
  };
}

function installSystemdGatewayService(provider: GatewayProvider): GatewayServiceInfo {
  const unitName = getSystemdUnitName(provider);
  const manifestPath = getSystemdUnitPath(unitName);

  const workingDirectory = validateProviderSetup(provider);
  const entryFile = resolveGatewayEntryFile();
  const nodePath = process.execPath;
  const environment = buildServiceEnvironment(provider);

  mkdirSync(dirname(manifestPath), { recursive: true });

  const content = buildSystemdUnitContent({
    provider,
    nodePath,
    entryFile,
    workingDirectory,
    environment,
  });

  writeFileSync(manifestPath, `${content}\n`);

  runCommand('systemctl', ['--user', 'daemon-reload']);
  runCommand('systemctl', ['--user', 'enable', '--now', unitName]);

  return {
    platform: 'systemd',
    provider,
    identifier: unitName,
    manifestPath,
  };
}

function uninstallSystemdGatewayService(provider: GatewayProvider): GatewayServiceInfo {
  const unitName = getSystemdUnitName(provider);
  const manifestPath = getSystemdUnitPath(unitName);

  runCommand('systemctl', ['--user', 'disable', '--now', unitName], { allowNonZero: true });

  if (existsSync(manifestPath)) {
    rmSync(manifestPath, { force: true });
  }

  runCommand('systemctl', ['--user', 'daemon-reload']);

  return {
    platform: 'systemd',
    provider,
    identifier: unitName,
    manifestPath,
  };
}

function getSystemdGatewayServiceStatus(provider: GatewayProvider): GatewayServiceStatus {
  const unitName = getSystemdUnitName(provider);
  const manifestPath = getSystemdUnitPath(unitName);

  const status = runCommand('systemctl', ['--user', 'is-active', unitName], { allowNonZero: true });
  const activeState = status.stdout.trim().toLowerCase();

  return {
    platform: 'systemd',
    provider,
    identifier: unitName,
    manifestPath,
    installed: existsSync(manifestPath),
    running: (status.status ?? 1) === 0 && activeState === 'active',
  };
}

export function installGatewayService(provider: GatewayProvider): GatewayServiceInfo {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return installLaunchdGatewayService(provider);
  }

  return installSystemdGatewayService(provider);
}

export function uninstallGatewayService(provider: GatewayProvider): GatewayServiceInfo {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return uninstallLaunchdGatewayService(provider);
  }

  return uninstallSystemdGatewayService(provider);
}

export function getGatewayServiceStatus(provider: GatewayProvider): GatewayServiceStatus {
  const platform = resolveServicePlatform();

  if (platform === 'launchd') {
    return getLaunchdGatewayServiceStatus(provider);
  }

  return getSystemdGatewayServiceStatus(provider);
}
