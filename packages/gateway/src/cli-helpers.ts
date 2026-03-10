import { createInterface } from 'readline';
import { resolve } from 'path';
import {
  getGatewayConfigFilePath,
  readGatewayConfig,
  type GatewayStoredConfig,
  type TelegramStoredConfig,
  writeGatewayConfig,
} from './config.js';
import {
  getGatewayServiceStatus,
  installGatewayService,
  uninstallGatewayService,
  type GatewayProvider,
} from './service.js';
import { parseAllowlist } from './allowlist.js';

const GATEWAY_SERVICE_ACTIONS = ['install', 'uninstall', 'status'] as const;

type GatewayServiceRuntimeAction = (typeof GATEWAY_SERVICE_ACTIONS)[number];
type GatewayServiceCliAction = GatewayServiceRuntimeAction | 'help';

function gatewaySection(title: string): string {
  return title;
}

function gatewaySuccess(message: string): string {
  return `✓ ${message}`;
}

function gatewayNext(command: string): string {
  return `Next: ${command}`;
}

function gatewayKeyValue(key: string, value: string | number): string {
  return `  ${key}: ${value}`;
}

export function isGatewayProvider(value: string | undefined): value is GatewayProvider {
  return value === 'telegram';
}

function isHelpToken(value: string | undefined): boolean {
  return value === 'help' || value === '--help' || value === '-h';
}

function isStartToken(value: string | undefined): boolean {
  return value === 'start';
}

function isSetupToken(value: string | undefined): boolean {
  return value === 'setup';
}

function isServiceToken(value: string | undefined): boolean {
  return value === 'service';
}

function isGatewayServiceRuntimeAction(value: string | undefined): value is GatewayServiceRuntimeAction {
  if (!value) {
    return false;
  }

  return (GATEWAY_SERVICE_ACTIONS as readonly string[]).includes(value);
}

function ensureNoExtraGatewayArgs(args: string[], expectedLength: number, command: string): void {
  if (args.length <= expectedLength) {
    return;
  }

  throw new Error(`Too many arguments for \`${command}\``);
}

export interface ParsedGatewayCliArgs {
  action: 'start' | 'setup' | 'help' | 'service';
  provider?: GatewayProvider;
  serviceAction?: GatewayServiceCliAction;
}

function parseGatewayServiceCliArgs(args: string[]): ParsedGatewayCliArgs {
  const [, rawAction, rawProvider] = args;

  if (!rawAction) {
    return {
      action: 'service',
      serviceAction: 'help',
    };
  }

  if (isHelpToken(rawAction)) {
    if (!rawProvider) {
      ensureNoExtraGatewayArgs(args, 2, 'pa gateway service help');
      return {
        action: 'service',
        serviceAction: 'help',
      };
    }

    if (!isGatewayProvider(rawProvider)) {
      throw new Error(`Unknown gateway provider: ${rawProvider}`);
    }

    ensureNoExtraGatewayArgs(args, 3, `pa gateway service help ${rawProvider}`);
    return {
      action: 'service',
      serviceAction: 'help',
      provider: rawProvider,
    };
  }

  if (!isGatewayServiceRuntimeAction(rawAction)) {
    throw new Error(`Unknown gateway service subcommand: ${rawAction}`);
  }

  if (!rawProvider) {
    ensureNoExtraGatewayArgs(args, 2, `pa gateway service ${rawAction}`);
    return {
      action: 'service',
      serviceAction: rawAction,
      provider: 'telegram',
    };
  }

  if (!isGatewayProvider(rawProvider)) {
    throw new Error(`Unknown gateway provider: ${rawProvider}`);
  }

  ensureNoExtraGatewayArgs(args, 3, `pa gateway service ${rawAction} ${rawProvider}`);

  return {
    action: 'service',
    serviceAction: rawAction,
    provider: rawProvider,
  };
}

export function parseGatewayCliArgs(args: string[]): ParsedGatewayCliArgs {
  const [first, second] = args;

  if (!first) {
    return {
      action: 'help',
    };
  }

  if (isHelpToken(first)) {
    ensureNoExtraGatewayArgs(args, 1, 'pa gateway help');
    return {
      action: 'help',
    };
  }

  if (isServiceToken(first)) {
    return parseGatewayServiceCliArgs(args);
  }

  if (isStartToken(first) || isSetupToken(first)) {
    const action: ParsedGatewayCliArgs['action'] = isStartToken(first) ? 'start' : 'setup';

    if (!second) {
      return action === 'start'
        ? { action, provider: 'telegram' }
        : { action };
    }

    if (!isGatewayProvider(second)) {
      throw new Error(`Unknown gateway provider: ${second}`);
    }

    ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} ${second}`);

    return {
      action,
      provider: second,
    };
  }

  if (isGatewayProvider(first)) {
    if (!second) {
      return {
        action: 'help',
        provider: first,
      };
    }

    if (isStartToken(second)) {
      ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} start`);
      return {
        action: 'start',
        provider: first,
      };
    }

    if (isSetupToken(second)) {
      ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} setup`);
      return {
        action: 'setup',
        provider: first,
      };
    }

    if (isHelpToken(second)) {
      ensureNoExtraGatewayArgs(args, 2, `pa gateway ${first} help`);
      return {
        action: 'help',
        provider: first,
      };
    }

    throw new Error(`Unknown ${first} subcommand: ${second}`);
  }

  throw new Error(`Unknown gateway subcommand: ${first}`);
}

function createPromptInterface() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = async (question: string): Promise<string> => new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });

  const close = (): void => {
    rl.close();
  };

  return { ask, close };
}

async function promptRequired(ask: (question: string) => Promise<string>, question: string): Promise<string> {
  let value = await ask(question);

  while (value.length === 0) {
    value = await ask(question);
  }

  return value;
}

async function promptWithDefault(
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue: string,
): Promise<string> {
  const value = await ask(`${label} [${defaultValue}]: `);
  return value.length > 0 ? value : defaultValue;
}

function toPositiveInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

async function promptPositiveInteger(
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue?: number,
): Promise<number | undefined> {
  const suffix = defaultValue ? ` [${defaultValue}]` : ' (optional)';
  let value = await ask(`${label}${suffix}: `);

  while (value.length > 0) {
    const parsed = toPositiveInteger(value);
    if (parsed !== undefined) {
      return parsed;
    }

    console.log('Please enter a positive integer or leave blank.');
    value = await ask(`${label}${suffix}: `);
  }

  return defaultValue;
}

async function promptBoolean(
  ask: (question: string) => Promise<string>,
  label: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? ' [Y/n]' : ' [y/N]';
  let value = (await ask(`${label}${suffix}: `)).trim().toLowerCase();

  while (value.length > 0) {
    if (['y', 'yes', 'true', '1', 'on'].includes(value)) {
      return true;
    }

    if (['n', 'no', 'false', '0', 'off'].includes(value)) {
      return false;
    }

    console.log('Please answer yes or no.');
    value = (await ask(`${label}${suffix}: `)).trim().toLowerCase();
  }

  return defaultValue;
}

async function resolveGatewayProviderForSetup(
  _ask: (question: string) => Promise<string>,
  provider?: GatewayProvider,
): Promise<GatewayProvider> {
  return provider ?? 'telegram';
}

export async function runGatewaySetup(provider?: GatewayProvider): Promise<void> {
  const prompt = createPromptInterface();

  try {
    const selectedProvider = await resolveGatewayProviderForSetup(prompt.ask, provider);
    const current = readGatewayConfig();

    const profileDefault = current.profile ?? 'shared';
    const profile = await promptWithDefault(prompt.ask, 'Profile', profileDefault);

    const existingProviderConfig: TelegramStoredConfig | undefined = current.telegram;

    let resolvedToken = existingProviderConfig?.token;

    if (resolvedToken) {
      const tokenInput = await prompt.ask('Bot token [press Enter to keep existing]: ');
      if (tokenInput.length > 0) {
        resolvedToken = tokenInput;
      }
    } else {
      resolvedToken = await promptRequired(prompt.ask, 'Bot token: ');
    }

    if (!resolvedToken) {
      throw new Error('Bot token is required.');
    }

    const allowlistDefault = existingProviderConfig?.allowlist?.join(',') ?? '';
    const allowlistInput = allowlistDefault.length > 0
      ? await promptWithDefault(prompt.ask, 'Allowlist (comma-separated IDs)', allowlistDefault)
      : await prompt.ask('Allowlist (comma-separated IDs) [optional for telegram]: ');

    const allowlist = [...parseAllowlist(allowlistInput)];

    const allowedUserIds = (() => {
      const defaultValue = current.telegram?.allowedUserIds?.join(',') ?? '';
      return defaultValue.length > 0
        ? promptWithDefault(prompt.ask, 'Allowed Telegram user IDs (comma-separated)', defaultValue)
        : prompt.ask('Allowed Telegram user IDs (comma-separated, optional): ');
    })();

    const blockedUserIds = (() => {
      const defaultValue = current.telegram?.blockedUserIds?.join(',') ?? '';
      return defaultValue.length > 0
        ? promptWithDefault(prompt.ask, 'Blocked Telegram user IDs (comma-separated)', defaultValue)
        : prompt.ask('Blocked Telegram user IDs (comma-separated, optional): ');
    })();

    const resolvedAllowedUserIds = [...parseAllowlist(await allowedUserIds)];
    const resolvedBlockedUserIds = [...parseAllowlist(await blockedUserIds)];

    if (allowlist.length === 0 && resolvedAllowedUserIds.length === 0) {
      throw new Error('For Telegram, configure at least one allowlist chat ID or one allowed user ID.');
    }

    const cwdDefault = existingProviderConfig?.workingDirectory ?? process.cwd();
    const workingDirectory = resolve(await promptWithDefault(prompt.ask, 'Working directory', cwdDefault));

    const maxPending = await promptPositiveInteger(
      prompt.ask,
      'Max pending messages per conversation',
      current.telegram?.maxPendingPerChat,
    );

    const toolActivityStream = await promptBoolean(
      prompt.ask,
      'Show temporary tool activity acknowledgement while responses are running',
      current.telegram?.toolActivityStream ?? false,
    );

    const clearRecentMessagesOnNew = await promptBoolean(
      prompt.ask,
      'Best-effort clear recent tracked messages when /new is used',
      current.telegram?.clearRecentMessagesOnNew ?? true,
    );

    const updated: GatewayStoredConfig = {
      ...current,
      profile,
    };

    updated.telegram = {
      ...current.telegram,
      token: resolvedToken,
      allowlist,
      allowedUserIds: resolvedAllowedUserIds.length > 0 ? resolvedAllowedUserIds : undefined,
      blockedUserIds: resolvedBlockedUserIds.length > 0 ? resolvedBlockedUserIds : undefined,
      workingDirectory,
      maxPendingPerChat: maxPending,
      toolActivityStream,
      clearRecentMessagesOnNew,
    };

    writeGatewayConfig(updated);
    console.log(gatewaySuccess(`Saved ${selectedProvider} gateway config`));
    console.log(gatewayKeyValue('Config file', getGatewayConfigFilePath()));
    console.log(gatewayNext(`pa gateway ${selectedProvider} start`));
  } finally {
    prompt.close();
  }
}

export function printGatewayServiceHelp(provider?: GatewayProvider): void {
  const defaultProvider = provider ?? 'telegram';

  console.log(gatewaySection('Gateway service'));
  console.log('');
  console.log('Commands:');
  console.log('  pa gateway service help [provider]         Show gateway service help');
  console.log('  pa gateway service install [provider]      Install and start background service');
  console.log('  pa gateway service status [provider]       Show background service status');
  console.log('  pa gateway service uninstall [provider]    Stop and remove background service');
  console.log('');
  console.log(gatewayKeyValue('Default provider', defaultProvider));
  console.log(gatewayKeyValue('Supported platforms', 'macOS launchd, Linux systemd --user'));
  console.log(gatewayKeyValue('Daemon', 'Install also provisions personal-agentd as a managed user service'));
  console.log('');
  console.log(gatewayNext(`pa gateway service install ${defaultProvider}`));
}

function printGatewayServiceStatus(provider: GatewayProvider): void {
  const status = getGatewayServiceStatus(provider);

  console.log(gatewaySection(`Gateway service · ${provider}`));
  console.log('');
  console.log(gatewayKeyValue('Platform', status.platform));
  console.log(gatewayKeyValue('Service', status.identifier));
  console.log(gatewayKeyValue('Manifest', status.manifestPath));
  console.log(gatewayKeyValue('Installed', status.installed ? 'yes' : 'no'));
  console.log(gatewayKeyValue('Running', status.running ? 'yes' : 'no'));

  if (status.logFile) {
    console.log(gatewayKeyValue('Log file', status.logFile));
  }

  if (status.platform === 'systemd') {
    console.log(gatewayKeyValue('Logs', `journalctl --user -u ${status.identifier} -f`));
  }

  if (status.daemonService) {
    console.log('');
    console.log(gatewaySection('Daemon service'));
    console.log(gatewayKeyValue('Service', status.daemonService.identifier));
    console.log(gatewayKeyValue('Manifest', status.daemonService.manifestPath));
    console.log(gatewayKeyValue('Installed', status.daemonService.installed ? 'yes' : 'no'));
    console.log(gatewayKeyValue('Running', status.daemonService.running ? 'yes' : 'no'));

    if (status.daemonService.logFile) {
      console.log(gatewayKeyValue('Log file', status.daemonService.logFile));
    }

    if (status.platform === 'systemd') {
      console.log(gatewayKeyValue('Logs', `journalctl --user -u ${status.daemonService.identifier} -f`));
    }
  }

  if (!status.installed) {
    console.log(gatewayNext(`pa gateway service install ${provider}`));
  }
}

export function runGatewayServiceAction(action: GatewayServiceRuntimeAction, provider: GatewayProvider): void {
  if (action === 'install') {
    const service = installGatewayService(provider);

    console.log(gatewaySuccess(`Installed ${provider} gateway service`));
    console.log(gatewayKeyValue('Platform', service.platform));
    console.log(gatewayKeyValue('Service', service.identifier));
    console.log(gatewayKeyValue('Manifest', service.manifestPath));

    if (service.logFile) {
      console.log(gatewayKeyValue('Log file', service.logFile));
    }

    if (service.platform === 'systemd') {
      console.log(gatewayKeyValue('Logs', `journalctl --user -u ${service.identifier} -f`));
    }

    if (service.daemonService) {
      console.log('');
      console.log(gatewaySection('Daemon service'));
      console.log(gatewayKeyValue('Service', service.daemonService.identifier));
      console.log(gatewayKeyValue('Manifest', service.daemonService.manifestPath));

      if (service.daemonService.logFile) {
        console.log(gatewayKeyValue('Log file', service.daemonService.logFile));
      }

      if (service.platform === 'systemd') {
        console.log(gatewayKeyValue('Logs', `journalctl --user -u ${service.daemonService.identifier} -f`));
      }
    }

    console.log(gatewayNext(`pa gateway service status ${provider}`));
    return;
  }

  if (action === 'status') {
    printGatewayServiceStatus(provider);
    return;
  }

  const removed = uninstallGatewayService(provider);
  console.log(gatewaySuccess(`Removed ${provider} gateway service`));
  console.log(gatewayKeyValue('Platform', removed.platform));
  console.log(gatewayKeyValue('Service', removed.identifier));
  console.log(gatewayKeyValue('Manifest', removed.manifestPath));

  if (removed.logFile) {
    console.log(gatewayKeyValue('Log file', removed.logFile));
  }

  console.log(gatewayNext(`pa gateway service install ${provider}`));
}

export function printGatewayHelp(provider?: GatewayProvider): void {
  if (provider === 'telegram') {
    console.log(gatewaySection('Gateway · Telegram'));
    console.log('');
    console.log('Commands:');
    console.log('  pa gateway telegram setup                 Interactive setup for Telegram gateway');
    console.log('  pa gateway telegram start                 Start Telegram bridge in foreground');
    console.log('  pa gateway telegram help                  Show Telegram gateway help');
    console.log('  pa gateway service install telegram       Install Telegram background service');
    console.log('  pa gateway service status telegram        Show Telegram service status');
    console.log('  pa gateway service uninstall telegram     Remove Telegram background service');
    console.log('');
    console.log('Config keys (written by setup):');
    console.log('  TELEGRAM_BOT_TOKEN');
    console.log('  PERSONAL_AGENT_TELEGRAM_ALLOWLIST (optional when room-approval flow is enabled)');
    console.log('  PERSONAL_AGENT_TELEGRAM_ALLOWED_USER_IDS (recommended, comma-separated Telegram user IDs)');
    console.log('  PERSONAL_AGENT_TELEGRAM_BLOCKED_USER_IDS (optional, comma-separated Telegram user IDs)');
    console.log('  PERSONAL_AGENT_PROFILE (optional, default: shared)');
    console.log('  PERSONAL_AGENT_TELEGRAM_CWD (optional, default: current working directory)');
    console.log('  PERSONAL_AGENT_TELEGRAM_MAX_PENDING_PER_CHAT (optional, default: 20)');
    console.log('  PERSONAL_AGENT_TELEGRAM_TOOL_ACTIVITY_STREAM (optional, default: false)');
    console.log('  PERSONAL_AGENT_TELEGRAM_CLEAR_RECENT_MESSAGES_ON_NEW (optional, default: true)');
    console.log('');
    console.log(gatewayNext('pa gateway telegram setup'));
    return;
  }

  console.log(gatewaySection('Gateway commands'));
  console.log('');
  console.log('Commands:');
  console.log('  pa gateway help                                          Show gateway help');
  console.log('  pa gateway setup [provider]                              Interactive setup walkthrough');
  console.log('  pa gateway start [provider]                              Start provider (default: telegram)');
  console.log('  pa gateway service [install|status|uninstall|help] [...] Manage background service');
  console.log('  pa gateway telegram [setup|start|help]                   Telegram gateway commands');
  console.log('');
  console.log(`Config file: ${getGatewayConfigFilePath()}`);
  console.log('');
  console.log('Environment overrides (optional):');
  console.log('  PERSONAL_AGENT_PROFILE');
  console.log('  PERSONAL_AGENT_PI_TIMEOUT_MS');
}
